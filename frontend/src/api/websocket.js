const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';

class WebSocketClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
    this.isIntentionallyClosed = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${WS_URL}/ws`);
        this.isIntentionallyClosed = false;

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          
          if (!this.isIntentionallyClosed) {
            this.reconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.trigger('connection_failed');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(() => {
        // Will retry in reconnect logic
      });
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  disconnect() {
    this.isIntentionallyClosed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch (error) {
      console.error('Failed to send message:', error);
      return false;
    }
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
  }

  off(event, handler) {
    if (!this.handlers.has(event)) {
      return;
    }
    const handlers = this.handlers.get(event);
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  handleMessage(message) {
    const { type, payload } = message;
    this.trigger(type, payload);
  }

  trigger(event, data) {
    if (!this.handlers.has(event)) {
      return;
    }
    
    const handlers = this.handlers.get(event);
    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in ${event} handler:`, error);
      }
    });
  }

  // Convenience methods
  joinRoom(roomCode, userId, displayName, isHost = false) {
    return this.send('join_room', { roomCode, userId, displayName, isHost });
  }

  leaveRoom() {
    return this.send('leave_room', {});
  }

  sendHeartbeat() {
    return this.send('heartbeat', {});
  }

  searchTracks(query) {
    return this.send('search_tracks', { query });
  }

  addToQueue(track) {
    return this.send('add_to_queue', { track });
  }

  removeFromQueue(queueItemId) {
    return this.send('remove_from_queue', { queueItemId });
  }

  controlPlayback(action, deviceId, trackUri = null, positionMs = 0) {
    return this.send('playback_control', {
      action,
      deviceId,
      trackUri,
      positionMs
    });
  }

  syncPlayback(state) {
    return this.send('sync_playback', { state });
  }

  transferDevice(deviceId) {
    return this.send('transfer_device', { deviceId });
  }

  requestToken() {
    return this.send('request_token', {});
  }
}

export default new WebSocketClient();
