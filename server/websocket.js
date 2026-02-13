const WebSocket = require('ws');
const roomManager = require('./roomManager');
const spotifyAuth = require('./spotifyAuth');

class WebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ server });
    this.clients = new Map(); // userId -> WebSocket
    this.userRooms = new Map(); // userId -> roomId
    this.heartbeatIntervals = new Map(); // roomId -> interval
    
    this.wss.on('connection', (ws) => {
      console.log('New WebSocket connection');
      
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('WebSocket message error:', error);
          this.sendError(ws, 'Invalid message format');
        }
      });
      
      ws.on('close', () => {
        this.handleDisconnect(ws);
      });
      
      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
    });
    
    console.log('WebSocket server initialized');
  }

  async handleMessage(ws, message) {
    const { type, payload } = message;
    
    switch (type) {
      case 'auth':
        await this.handleAuth(ws, payload);
        break;
        
      case 'create_room':
        await this.handleCreateRoom(ws, payload);
        break;
        
      case 'join_room':
        await this.handleJoinRoom(ws, payload);
        break;
        
      case 'leave_room':
        await this.handleLeaveRoom(ws, payload);
        break;
        
      case 'playback_state':
        await this.handlePlaybackState(ws, payload);
        break;
        
      case 'device_ready':
        await this.handleDeviceReady(ws, payload);
        break;
        
      default:
        console.log('Unknown message type:', type);
    }
  }

  async handleAuth(ws, payload) {
    const { userId, displayName } = payload;
    
    if (!userId) {
      this.sendError(ws, 'Missing userId');
      return;
    }
    
    ws.userId = userId;
    ws.displayName = displayName || userId;
    this.clients.set(userId, ws);
    
    this.send(ws, {
      type: 'auth_success',
      payload: { userId }
    });
    
    console.log(`User authenticated: ${userId}`);
  }

  async handleCreateRoom(ws, payload) {
    const userId = ws.userId;
    
    if (!userId) {
      this.sendError(ws, 'Not authenticated');
      return;
    }
    
    try {
      const { roomId, hostId } = await roomManager.createRoom(userId, ws.displayName);
      
      this.userRooms.set(userId, roomId);
      ws.roomId = roomId;
      ws.isHost = true;
      
      // Start heartbeat for this room
      this.startHeartbeat(roomId);
      
      this.send(ws, {
        type: 'room_created',
        payload: {
          roomId,
          hostId,
          members: await roomManager.getRoomMembers(roomId)
        }
      });
      
    } catch (error) {
      this.sendError(ws, 'Failed to create room');
    }
  }

  async handleJoinRoom(ws, payload) {
    const userId = ws.userId;
    const { roomId } = payload;
    
    if (!userId) {
      this.sendError(ws, 'Not authenticated');
      return;
    }
    
    if (!roomId) {
      this.sendError(ws, 'Missing roomId');
      return;
    }
    
    try {
      const { hostId } = await roomManager.joinRoom(roomId, userId, ws.displayName);
      
      this.userRooms.set(userId, roomId);
      ws.roomId = roomId;
      ws.isHost = false;
      
      // Send success to joiner
      const members = await roomManager.getRoomMembers(roomId);
      const playbackState = await roomManager.getPlaybackState(roomId);
      
      this.send(ws, {
        type: 'room_joined',
        payload: {
          roomId,
          hostId,
          members,
          playbackState
        }
      });
      
      // Notify all room members
      await this.broadcastToRoom(roomId, {
        type: 'member_joined',
        payload: {
          userId,
          displayName: ws.displayName,
          members
        }
      });
      
    } catch (error) {
      if (error.message === 'ROOM_NOT_FOUND') {
        this.sendError(ws, 'Room not found');
      } else if (error.message === 'ROOM_CLOSED') {
        this.sendError(ws, 'Room is closed');
      } else {
        this.sendError(ws, 'Failed to join room');
      }
    }
  }

  async handleLeaveRoom(ws, payload) {
    const userId = ws.userId;
    const roomId = ws.roomId;
    
    if (!userId || !roomId) {
      return;
    }
    
    try {
      const { wasHost } = await roomManager.leaveRoom(roomId, userId);
      
      if (wasHost) {
        // Notify all members that room is closed
        await this.broadcastToRoom(roomId, {
          type: 'room_closed',
          payload: { reason: 'Host disconnected' }
        }, userId);
        
        // Stop heartbeat
        this.stopHeartbeat(roomId);
        
        // Clear all users from this room
        for (const [uid, rid] of this.userRooms.entries()) {
          if (rid === roomId) {
            this.userRooms.delete(uid);
            const client = this.clients.get(uid);
            if (client) {
              client.roomId = null;
              client.isHost = false;
            }
          }
        }
      } else {
        // Regular member left
        const members = await roomManager.getRoomMembers(roomId);
        await this.broadcastToRoom(roomId, {
          type: 'member_left',
          payload: { userId, members }
        });
      }
      
      this.userRooms.delete(userId);
      ws.roomId = null;
      ws.isHost = false;
      
      this.send(ws, {
        type: 'left_room',
        payload: { roomId }
      });
      
    } catch (error) {
      console.error('Failed to leave room:', error);
    }
  }

  async handlePlaybackState(ws, payload) {
    const roomId = ws.roomId;
    
    if (!roomId || !ws.isHost) {
      return; // Only host can update playback state
    }
    
    // Update in database
    await roomManager.updatePlaybackState(roomId, payload);
    
    // Broadcast to all members
    await this.broadcastToRoom(roomId, {
      type: 'playback_update',
      payload
    }, ws.userId);
  }

  async handleDeviceReady(ws, payload) {
    const userId = ws.userId;
    const { deviceId } = payload;
    
    if (!userId || !deviceId) {
      return;
    }
    
    // Transfer playback to this device
    try {
      await spotifyAuth.transferPlayback(userId, deviceId);
      
      this.send(ws, {
        type: 'playback_transferred',
        payload: { deviceId }
      });
    } catch (error) {
      console.error('Failed to transfer playback:', error);
      this.sendError(ws, 'Failed to transfer playback');
    }
  }

  handleDisconnect(ws) {
    const userId = ws.userId;
    
    if (!userId) {
      return;
    }
    
    console.log(`User disconnected: ${userId}`);
    
    const roomId = this.userRooms.get(userId);
    
    if (roomId && ws.isHost) {
      // Host disconnected, close room
      this.handleLeaveRoom(ws, {}).catch(console.error);
    } else if (roomId) {
      // Regular member disconnected
      this.handleLeaveRoom(ws, {}).catch(console.error);
    }
    
    this.clients.delete(userId);
  }

  startHeartbeat(roomId) {
    // Clear existing interval if any
    this.stopHeartbeat(roomId);
    
    // Update heartbeat every 30 seconds
    const interval = setInterval(async () => {
      const success = await roomManager.updateHeartbeat(roomId);
      if (!success) {
        this.stopHeartbeat(roomId);
      }
    }, 30000);
    
    this.heartbeatIntervals.set(roomId, interval);
  }

  stopHeartbeat(roomId) {
    const interval = this.heartbeatIntervals.get(roomId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(roomId);
    }
  }

  async broadcastToRoom(roomId, message, excludeUserId = null) {
    const members = await roomManager.getRoomMembers(roomId);
    
    for (const member of members) {
      if (member.user_id !== excludeUserId) {
        const client = this.clients.get(member.user_id);
        if (client && client.readyState === WebSocket.OPEN) {
          this.send(client, message);
        }
      }
    }
  }

  send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  sendError(ws, error) {
    this.send(ws, {
      type: 'error',
      payload: { error }
    });
  }
}

module.exports = WebSocketServer;
