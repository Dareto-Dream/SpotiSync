import { useRef, useEffect, useCallback } from 'react';

const WS_URL = import.meta.env.VITE_WS_URL || import.meta.env.VITE_API_URL || 'ws://localhost:4000';

function resolveWebSocketUrl() {
  const raw = String(WS_URL || '').trim();
  if (!raw) return 'ws://localhost:4000/ws';

  const ensureWsPath = (base) => (base.endsWith('/ws') ? base : `${base}/ws`);

  try {
    const url = new URL(raw);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (!['ws:', 'wss:'].includes(url.protocol)) {
      return 'ws://localhost:4000/ws';
    }

    url.pathname = url.pathname.replace(/\/+$/, '');
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/ws';
    } else if (!url.pathname.endsWith('/ws')) {
      url.pathname = `${url.pathname}/ws`;
    }

    return url.toString().replace(/\/$/, '');
  } catch {
    const normalized = raw.replace(/\/+$/, '').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return ensureWsPath(normalized || 'ws://localhost:4000');
  }
}

export function useWebSocket({ onMessage, onOpen, onClose, onAuthFailure }) {
  const wsRef = useRef(null);
  const listenersRef = useRef({ onMessage, onOpen, onClose, onAuthFailure });
  const reconnectTimerRef = useRef(null);
  const shouldReconnectRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const tokenRef = useRef(null);

  // Keep listeners current
  useEffect(() => {
    listenersRef.current = { onMessage, onOpen, onClose, onAuthFailure };
  });

  const connect = useCallback((token) => {
    tokenRef.current = token;
    if (!token) {
      console.warn('[WS] Missing token, abort connect');
      return null;
    }

    // Guard: avoid duplicate connections
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return wsRef.current;
    }

    shouldReconnectRef.current = true;
    const wsUrl = resolveWebSocketUrl();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected:', wsUrl);
      reconnectAttemptsRef.current = 0;
      ws.send(JSON.stringify({ event: 'auth', data: { token: tokenRef.current } }));
      listenersRef.current.onOpen?.();
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg?.event === 'auth_required' && tokenRef.current) {
          ws.send(JSON.stringify({ event: 'auth', data: { token: tokenRef.current } }));
        }
        listenersRef.current.onMessage?.(msg);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    ws.onclose = (e) => {
      console.log('[WS] Closed', e.code, e.reason);
      listenersRef.current.onClose?.(e);

      // Stop reconnecting on auth failures
      if (e.code === 4001 || e.code === 4401) {
        shouldReconnectRef.current = false;
        listenersRef.current.onAuthFailure?.();
        return;
      }

      // Reconnect with backoff (unless deliberately closed)
      if (shouldReconnectRef.current) {
        const delay = Math.min(30000, 1000 * 2 ** reconnectAttemptsRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          connect(tokenRef.current);
        }, delay);
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
