import { useRef, useEffect, useCallback } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:4000';

export function useWebSocket({ onMessage, onOpen, onClose }) {
  const wsRef = useRef(null);
  const listenersRef = useRef({ onMessage, onOpen, onClose });
  const reconnectTimerRef = useRef(null);
  const shouldReconnectRef = useRef(false);

  // Keep listeners current
  useEffect(() => {
    listenersRef.current = { onMessage, onOpen, onClose };
  });

  const connect = useCallback((token) => {
    if (wsRef.current && wsRef.current.readyState <= 1) {
      wsRef.current.close();
    }

    shouldReconnectRef.current = true;
    const url = `${WS_URL}/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected');
      listenersRef.current.onOpen?.();
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        listenersRef.current.onMessage?.(msg);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    ws.onclose = (e) => {
      console.log('[WS] Closed', e.code, e.reason);
      listenersRef.current.onClose?.(e);

      // Reconnect with backoff (unless deliberately closed)
      if (shouldReconnectRef.current && e.code !== 4001) {
        reconnectTimerRef.current = setTimeout(() => {
          console.log('[WS] Reconnecting...');
          connect(token);
        }, 3000);
      }
    };

    ws.onerror = (e) => {
      console.error('[WS] Error', e);
    };

    return ws;
  }, []);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    clearTimeout(reconnectTimerRef.current);
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnect');
      wsRef.current = null;
    }
  }, []);

  const send = useCallback((event, data = {}) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) {
      console.warn('[WS] Not connected, drop:', event);
      return false;
    }
    ws.send(JSON.stringify({ event, data }));
    return true;
  }, []);

  useEffect(() => {
    return () => {
      shouldReconnectRef.current = false;
      clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close(1000, 'Unmount');
    };
  }, []);

  return { connect, disconnect, send };
}
