import React, { createContext, useContext, useReducer, useRef, useCallback, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAuth } from './AuthContext';

const RoomContext = createContext(null);

const INITIAL = {
  room: null,
  isHost: false,
  members: [],
  playback: null,
  queue: [],
  autoplaySuggestions: [],
  votes: null,
  feedback: null,
  connected: false,
  error: null,
  wsReady: false,
};

function reducer(state, action) {
  switch (action.type) {
    case 'ROOM_STATE':
      return {
        ...state,
        room: action.payload.room,
        isHost: action.payload.isHost,
        members: action.payload.members || [],
        playback: action.payload.playback,
        queue: action.payload.playback?.queue || [],
        feedback: null,
        connected: true,
        error: null,
      };
    case 'MEMBER_JOINED':
      return { ...state, members: [...state.members.filter(m => m.id !== action.payload.user.id), { id: action.payload.user.id, username: action.payload.user.username }] };
    case 'MEMBER_LEFT':
      return { ...state, members: state.members.filter(m => m.id !== action.payload.user.id) };
    case 'PLAYBACK_STATE':
    case 'PLAYBACK_SEEK':
    case 'NOW_PLAYING':
      return {
        ...state,
        playback: action.payload,
        queue: action.payload?.queue || state.queue,
      };
    case 'QUEUE_UPDATED':
      return { ...state, queue: action.payload.queue || [] };
    case 'AUTOPLAY_SUGGESTIONS':
      return { ...state, autoplaySuggestions: action.payload.suggestions || [] };
    case 'VOTE_UPDATE':
      return { ...state, votes: action.payload };
    case 'FEEDBACK_UPDATE':
      return { ...state, feedback: action.payload };
    case 'SETTINGS_UPDATED':
      return { ...state, room: state.room ? { ...state.room, settings: action.payload.settings } : state.room };
    case 'ROOM_CLOSED':
      return { ...INITIAL, error: action.payload.reason || 'Room closed' };
    case 'WS_READY':
      return { ...state, wsReady: true };
    case 'WS_CLOSED':
      return { ...state, wsReady: false, connected: false };
    case 'ERROR':
      return { ...state, error: action.payload };
    case 'CLEAR':
      return { ...INITIAL };
    default:
      return state;
  }
}

export function RoomProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const { logout } = useAuth();
  const pendingCodeRef = useRef(null);
  const heartbeatRef = useRef(null);
  const sendRef = useRef(null); // ref so handleMessage can call send before it's declared

  const handleMessage = useCallback((msg) => {
    const { event, data } = msg;
    switch (event) {
      case 'connected':
        dispatch({ type: 'WS_READY' });
        // Auto-join if we have a pending code
        if (pendingCodeRef.current) {
          sendRef.current?.('join_room', { code: pendingCodeRef.current });
        }
        break;
      case 'room_state':
        dispatch({ type: 'ROOM_STATE', payload: data });
        break;
      case 'member_joined':
        dispatch({ type: 'MEMBER_JOINED', payload: data });
        break;
      case 'member_left':
        dispatch({ type: 'MEMBER_LEFT', payload: data });
        break;
      case 'playback_state':
      case 'playback_seek':
        dispatch({ type: 'PLAYBACK_STATE', payload: data });
        break;
      case 'now_playing':
        dispatch({ type: 'NOW_PLAYING', payload: data });
        break;
      case 'queue_updated':
        dispatch({ type: 'QUEUE_UPDATED', payload: data });
        break;
      case 'autoplay_suggestions':
        dispatch({ type: 'AUTOPLAY_SUGGESTIONS', payload: data });
        break;
      case 'vote_update':
      case 'vote_passed':
        dispatch({ type: 'VOTE_UPDATE', payload: data });
        break;
      case 'autoplay_feedback_update':
        dispatch({ type: 'FEEDBACK_UPDATE', payload: data });
        break;
      case 'settings_updated':
        dispatch({ type: 'SETTINGS_UPDATED', payload: data });
        break;
      case 'room_closed':
        dispatch({ type: 'ROOM_CLOSED', payload: data });
        stopHeartbeat();
        break;
      case 'error':
        dispatch({ type: 'ERROR', payload: data.message });
        break;
      default:
        break;
    }
  }, []);

  const handleClose = useCallback(() => {
    dispatch({ type: 'WS_CLOSED' });
    stopHeartbeat();
  }, []);

  const handleAuthFailure = useCallback(() => {
    dispatch({ type: 'ERROR', payload: 'Session expired. Please log in again.' });
    stopHeartbeat();
    logout();
  }, [logout]);

  const { connect, disconnect, send } = useWebSocket({
    onMessage: handleMessage,
    onOpen: () => {},
    onClose: handleClose,
    onAuthFailure: handleAuthFailure,
  });

  // Keep sendRef current so handleMessage and heartbeat can use it
  useEffect(() => { sendRef.current = send; });

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => {
      sendRef.current?.('host_heartbeat', {});
    }, parseInt(import.meta.env.VITE_HEARTBEAT_INTERVAL || '10000'));
  }

  function stopHeartbeat() {
    clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
  }

  const joinRoom = useCallback((code) => {
    pendingCodeRef.current = code;
    const token = localStorage.getItem('jam_token');
    if (!token) return;
    connect(token);
  }, [connect]);

  const leaveRoom = useCallback(() => {
    sendRef.current?.('leave_room', {});
    stopHeartbeat();
    disconnect();
    dispatch({ type: 'CLEAR' });
  }, [disconnect]);

  // When we become host, start heartbeat
  useEffect(() => {
    if (state.isHost && state.connected) {
      startHeartbeat();
    }
    return () => {
      if (!state.isHost) stopHeartbeat();
    };
  }, [state.isHost, state.connected]);

  // Handle page visibility for resync
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && state.connected) {
        sendRef.current?.('playback_position_report', { clientTime: Date.now() });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [state.connected, send]);

  const value = {
    ...state,
    joinRoom,
    leaveRoom,
    send,
    dispatch,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoom() {
  return useContext(RoomContext);
}
