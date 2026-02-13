import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(window.location.origin, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, []);

  const connect = () => {
    if (socketRef.current && !socketRef.current.connected) {
      socketRef.current.connect();
    }
  };

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected, connect }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
