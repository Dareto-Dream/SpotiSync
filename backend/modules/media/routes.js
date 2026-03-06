const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const coordinator = require('./jobCoordinator');
const { randomUUID } = require('crypto');

const proxySessions = new Map(); // token -> { endpoint, expiresAt }
const PROXY_TTL_MS = parseInt(process.env.MEDIA_STREAM_PROXY_TTL_MS || String(2 * 60 * 1000), 10);

function parseExpiresAt(expiresAt) {
  if (!expiresAt) return Date.now() + PROXY_TTL_MS;
  const ts = Date.parse(expiresAt);
  return Number.isFinite(ts) ? ts : (Date.now() + PROXY_TTL_MS);
}

function createProxySession(streamEndpoint, expiresAt) {
  const token = randomUUID();
  const exp = parseExpiresAt(expiresAt);
  proxySessions.set(token, { endpoint: streamEndpoint, expiresAt: exp });
  return { token, expiresAt: new Date(exp).toISOString() };
}

function cleanupProxySessions() {
  const now = Date.now();
  for (const [token, session] of proxySessions) {
    if (session.expiresAt <= now) proxySessions.delete(token);
  }
}

setInterval(cleanupProxySessions, 30000).unref();

function requireWorkerAuth(req, res, next) {
  const expected = process.env.COOKIE_WORKER_AUTH_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'Worker auth is not configured on backend.' });
  }

  const token = req.headers['x-worker-token'];
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized worker' });
  }

  next();
}

function toLegacyResponse(videoId, reason, attempts = []) {
  return {
    source: 'legacy',
    videoId,
    streamUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    reason,
    attempts,
  };
}

router.get('/resolve/:videoId', requireAuth, async (req, res) => {
  const { videoId } = req.params;
  const requiredCookieMethod = String(req.query.cookieMethod || req.query.cookie_method || '').trim();
  const requiredCapability = coordinator.normalizeRequiredCapability(requiredCookieMethod);

  if (!videoId || videoId.length < 6) {
    return res.status(400).json({ error: 'Invalid videoId' });
  }

  const activeWorkers = coordinator.getActiveWorkers(requiredCapability);
  const job = coordinator.createJob({
    type: 'extract_audio',
    videoId,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    requestedBy: req.user.sub,
    requiredCookieMethod: requiredCapability,
  }, activeWorkers, { requiredCapability });

  const outcome = await coordinator.runJobWithFailover(job);

  if (outcome.mode === 'worker') {
    const streamEndpoint = outcome.result?.streamEndpoint || null;
    const streamToken = outcome.result?.streamToken || null;
    const expiresAt = outcome.result?.expiresAt || null;

    const proxy = streamEndpoint ? createProxySession(streamEndpoint, expiresAt) : null;
    const proxyUrl = proxy ? `${req.protocol}://${req.get('host')}/api/media/stream/${encodeURIComponent(proxy.token)}` : null;

    return res.json({
      source: 'worker',
      videoId,
      streamEndpoint,
      streamToken,
      expiresAt,
      streamProxyUrl: proxyUrl,
      streamProxyToken: proxy ? proxy.token : null,
      streamProxyExpiresAt: proxy ? proxy.expiresAt : null,
      contentType: outcome.result?.contentType || null,
      streamMode: outcome.result?.streamMode || null,
      workerId: outcome.result?.workerId || null,
      fetchedAt: outcome.result?.fetchedAt || null,
      attempts: outcome.attempts,
    });
  }

  console.warn(`[Media Proxy] Falling back to legacy source for video ${videoId}. Reason: ${outcome.reason}`);
  return res.json(toLegacyResponse(videoId, outcome.reason, outcome.attempts));
});

// Backend stream proxy: clients fetch from backend, backend fetches from worker stream endpoint.
router.get('/stream/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing stream token' });

  const session = proxySessions.get(token);
  if (!session) return res.status(404).json({ error: 'Invalid or expired stream token' });

  if (session.expiresAt <= Date.now()) {
    proxySessions.delete(token);
    return res.status(410).json({ error: 'Stream token expired' });
  }

  // One-time use to avoid token reuse/races.
  proxySessions.delete(token);

  try {
    const upstream = await fetch(session.endpoint);
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status || 502).json({ error: text || 'Upstream stream failed' });
    }

    res.statusCode = 200;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);

    upstream.body.on('error', () => {
      if (!res.headersSent) res.status(502);
      res.destroy();
    });

    upstream.body.pipe(res);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Upstream stream error' });
  }
});

// Worker API: heartbeat
router.post('/worker/heartbeat', requireWorkerAuth, (req, res) => {
  const { workerId, meta } = req.body || {};
  if (!workerId) return res.status(400).json({ error: 'workerId is required' });
  coordinator.touchWorker(workerId, meta);
  res.json({ ok: true, activeWorkers: coordinator.getActiveWorkers().length });
});

// Worker API: poll next job
router.get('/worker/jobs/next', requireWorkerAuth, (req, res) => {
  const workerId = String(req.query.workerId || '').trim();
  if (!workerId) return res.status(400).json({ error: 'workerId is required' });

  const job = coordinator.getNextJobForWorker(workerId);
  if (!job) return res.status(204).send();

  res.json({
    job: {
      id: job.id,
      payload: job.payload,
      createdAt: job.createdAt,
    },
  });
});

// Worker API: submit job result
router.post('/worker/jobs/:jobId/result', requireWorkerAuth, (req, res) => {
  const { jobId } = req.params;
  const { workerId, success, result, error } = req.body || {};
  if (!workerId) return res.status(400).json({ error: 'workerId is required' });

  coordinator.touchWorker(workerId);
  const submit = coordinator.submitJobResult(jobId, workerId, !!success, result, error);
  if (!submit.ok) {
    if (submit.code === 'NOT_FOUND') return res.status(404).json({ error: 'job not found' });
    if (submit.code === 'NOT_ASSIGNED') return res.status(409).json({ error: 'job not assigned to this worker' });
    return res.status(400).json({ error: 'invalid submission' });
  }

  res.json({ ok: true });
});

module.exports = router;
