const { randomUUID } = require('crypto');

const PROXY_TTL_MS = parseInt(process.env.MEDIA_STREAM_PROXY_TTL_MS || String(2 * 60 * 1000), 10);
const READY_TIMEOUT_MS = parseInt(process.env.MEDIA_STREAM_PROXY_READY_TIMEOUT_MS || '10000', 10);
const WORKER_AUTH_TOKEN = process.env.COOKIE_WORKER_AUTH_TOKEN || '';

const sessions = new Map(); // token -> { expiresAt, ws, contentType, waiters: [] }
const activeResponses = new Map(); // token -> res

function parseExpiresAt(expiresAt) {
  if (!expiresAt) return Date.now() + PROXY_TTL_MS;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) ? ts : (Date.now() + PROXY_TTL_MS);
}

function cleanupExpired() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
      activeResponses.delete(token);
    }
  }
}

setInterval(cleanupExpired, 30000).unref();

function createProxyToken(expiresAt) {
  const token = randomUUID();
  const exp = parseExpiresAt(expiresAt);
  sessions.set(token, { expiresAt: exp, ws: null, contentType: null, waiters: [] });
  return { token, expiresAt: new Date(exp).toISOString() };
}

function getSession(token) {
  return sessions.get(token) || null;
}

function discardToken(token) {
  sessions.delete(token);
  activeResponses.delete(token);
}

function waitForReady(token, timeoutMs = READY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const session = sessions.get(token);
    if (!session) return resolve(null);
    if (session.ws) return resolve(session);

    const timer = setTimeout(() => resolve(null), timeoutMs);
    session.waiters.push((s) => {
      clearTimeout(timer);
      resolve(s);
    });
  });
}

function notifyWaiters(session) {
  if (!session || !session.waiters.length) return;
  const list = session.waiters.slice();
  session.waiters.length = 0;
  for (const fn of list) fn(session);
}

function endActive(token, statusCode = 502, message = 'Stream ended') {
  const res = activeResponses.get(token);
  activeResponses.delete(token);
  if (!res || res.writableEnded) return;
  if (!res.headersSent) res.statusCode = statusCode;
  try { res.end(message); } catch {}
}

function handleWorkerMessage(ws, data, isBinary) {
  if (isBinary) {
    const token = ws._proxyToken;
    if (!token) return;
    const res = activeResponses.get(token);
    if (res && !res.writableEnded) {
      res.write(data);
    }
    return;
  }

  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    return;
  }

  const { event, data: payload } = msg || {};

  if (event === 'auth') {
    const token = payload?.token || '';
    if (!WORKER_AUTH_TOKEN || token !== WORKER_AUTH_TOKEN) {
      ws.send(JSON.stringify({ event: 'error', data: { message: 'Unauthorized' } }));
      return ws.close(4001, 'Unauthorized');
    }
    ws._authed = true;
    ws._workerId = payload?.workerId || null;
    ws.send(JSON.stringify({ event: 'authed', data: { ok: true } }));
    return;
  }

  if (!ws._authed) {
    ws.send(JSON.stringify({ event: 'error', data: { message: 'Authenticate first' } }));
    return;
  }

  if (event === 'stream_ready') {
    const proxyToken = String(payload?.proxyToken || '').trim();
    if (!proxyToken) return;
    const session = sessions.get(proxyToken);
    if (!session) {
      ws.send(JSON.stringify({ event: 'error', data: { message: 'Unknown proxy token' } }));
      return;
    }
    session.ws = ws;
    session.contentType = payload?.contentType || null;
    ws._proxyToken = proxyToken;
    notifyWaiters(session);
    return;
  }

  if (event === 'stream_end') {
    const proxyToken = ws._proxyToken;
    if (proxyToken) {
      endActive(proxyToken, 200, '');
      sessions.delete(proxyToken);
    }
    try { ws.close(1000, 'Done'); } catch {}
    return;
  }

  if (event === 'stream_error') {
    const proxyToken = ws._proxyToken;
    if (proxyToken) {
      endActive(proxyToken, 502, payload?.message || 'Stream error');
      sessions.delete(proxyToken);
    }
    try { ws.close(1011, 'Stream error'); } catch {}
  }
}

function setupWorkerStream(wss) {
  wss.on('connection', (ws) => {
    ws._authed = false;
    ws._workerId = null;
    ws._proxyToken = null;
    ws.binaryType = 'nodebuffer';

    ws.on('message', (data, isBinary) => handleWorkerMessage(ws, data, isBinary));

    ws.on('close', () => {
      const token = ws._proxyToken;
      if (token) {
        endActive(token, 502, 'Worker disconnected');
        sessions.delete(token);
      }
    });

    ws.on('error', () => {});
  });
}

async function handleStreamRequest(req, res) {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing stream token' });

  const session = sessions.get(token);
  if (!session) return res.status(404).json({ error: 'Invalid or expired stream token' });

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return res.status(410).json({ error: 'Stream token expired' });
  }

  if (activeResponses.has(token)) {
    return res.status(409).json({ error: 'Stream already in progress' });
  }

  const ready = session.ws ? session : await waitForReady(token);
  if (!ready || !ready.ws || ready.ws.readyState !== 1) {
    return res.status(504).json({ error: 'Worker stream not ready' });
  }

  activeResponses.set(token, res);

  res.statusCode = 200;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');
  if (ready.contentType) res.setHeader('Content-Type', ready.contentType);
  res.flushHeaders(); // send headers immediately so clients don't timeout waiting for first audio byte

  req.on('close', () => {
    activeResponses.delete(token);
    if (ready.ws && ready.ws.readyState === 1) {
      ready.ws.send(JSON.stringify({ event: 'stream_cancel', data: { proxyToken: token } }));
    }
    sessions.delete(token);
  });

  try {
    ready.ws.send(JSON.stringify({ event: 'stream_start', data: { proxyToken: token } }));
  } catch {
    activeResponses.delete(token);
    sessions.delete(token);
    if (!res.headersSent) res.status(502).json({ error: 'Failed to start worker stream' });
    else res.end();
  }
}

module.exports = {
  createProxyToken,
  getSession,
  discardToken,
  setupWorkerStream,
  handleStreamRequest,
};
