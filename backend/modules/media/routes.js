const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const coordinator = require('./jobCoordinator');

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

  if (!videoId || videoId.length < 6) {
    return res.status(400).json({ error: 'Invalid videoId' });
  }

  const activeWorkers = coordinator.getActiveWorkers();
  const job = coordinator.createJob({
    type: 'extract_audio',
    videoId,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    requestedBy: req.user.sub,
  }, activeWorkers);

  const outcome = await coordinator.runJobWithFailover(job);

  if (outcome.mode === 'worker') {
    return res.json({
      source: 'worker',
      videoId,
      ...outcome.result,
      attempts: outcome.attempts,
    });
  }

  console.warn(`[Media Proxy] Falling back to legacy source for video ${videoId}. Reason: ${outcome.reason}`);
  return res.json(toLegacyResponse(videoId, outcome.reason, outcome.attempts));
});

// Worker API: heartbeat
router.post('/worker/heartbeat', requireWorkerAuth, (req, res) => {
  const { workerId, meta } = req.body || {};
  if (!workerId) return res.status(400).json({ error: 'workerId is required' });
  coordinator.touchWorker(workerId, meta || {});
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
