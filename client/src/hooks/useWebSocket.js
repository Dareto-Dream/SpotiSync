import { useEffect, useState, useRef, useCallback } from 'react';

const useWebSocket = (user) => {
  const [ws, setWs] = useState(null);
  const [connected, setConnected] = useState(false);
  const [roomState, setRoomState] = useState(null);
  const [error, setError] = useState(null);
  
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const messageHandlersRef = useRef(new Map());

  const WS_URL = process.env.REACT_APP_WS_URL || 
    (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + 
    (window.location.hostname === 'localhost' ? 'localhost:3001' : window.location.host);

  useEffect(() => {
    if (!user) return;

    const connect = () => {
      const websocket = new WebSocket(WS_URL);
      
      websocket.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
        setError(null);
        
        // Authenticate
        websocket.send(JSON.stringify({
          type: 'auth',
          payload: {
            userId: user.userId,
            displayName: user.displayName
          }
        }));
      };

      websocket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      };

      websocket.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError('Connection error');
      };

      websocket.onclose = () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        wsRef.current = null;
        setWs(null);
        
        // Attempt reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('Attempting to reconnect...');
          connect();
        }, 3000);
      };

      wsRef.current = websocket;
      setWs(websocket);
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [user, WS_URL]);

  const handleMessage = (message) => {
    const { type, payload } = message;
    
    // Call registered handlers
    const handlers = messageHandlersRef.current.get(type);
    if (handlers) {
      handlers.forEach(handler => handler(payload));
    }
    
    // Default handling
    switch (type) {
      case 'room_created':
      case 'room_joined':
        setRoomState({
          roomId: payload.roomId,
          hostId: payload.hostId,
          members: payload.members,
          playbackState: payload.playbackState
        });
        break;
        
      case 'member_joined':
      case 'member_left':
        setRoomState(prev => prev ? {
          ...prev,
          members: payload.members
        } : null);
        break;
        
      case 'playback_update':
        setRoomState(prev => prev ? {
          ...prev,
          playbackState: payload
        } : null);
        break;
        
      case 'room_closed':
        setRoomState(null);
        setError(payload.reason || 'Room closed');
        break;
        
      case 'error':
        setError(payload.error);
        break;
        
      default:
        break;
    }
  };

  const send = useCallback((type, payload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }, []);

  const createRoom = useCallback(() => {
    return send('create_room', {});
  }, [send]);

  const joinRoom = useCallback((roomId) => {
    return send('join_room', { roomId });
  }, [send]);

  const leaveRoom = useCallback(() => {
    return send('leave_room', {});
  }, [send]);

  const updatePlaybackState = useCallback((state) => {
    return send('playback_state', state);
  }, [send]);

  const notifyDeviceReady = useCallback((deviceId) => {
    return send('device_ready', { deviceId });
  }, [send]);

  const on = useCallback((type, handler) => {
    if (!messageHandlersRef.current.has(type)) {
      messageHandlersRef.current.set(type, new Set());
    }
    messageHandlersRef.current.get(type).add(handler);
    
    return () => {
      const handlers = messageHandlersRef.current.get(type);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }, []);

  return {
    connected,
    roomState,
    error,
    createRoom,
    joinRoom,
    leaveRoom,
    updatePlaybackState,
    notifyDeviceReady,
    on
  };
};

export default useWebSocket;
