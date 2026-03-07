const { randomUUID } = require('crypto');

const jobs = new Map(); // jobId -> job
const waiters = new Map(); // jobId -> [resolve]
const workers = new Map(); // workerId -> { lastSeenAt, meta }

const JOB_TIMEOUT_MS = parseInt(process.env.MEDIA_WORKER_JOB_TIMEOUT_MS || '15000', 10);
const WORKER_TTL_MS = parseInt(process.env.MEDIA_WORKER_TTL_MS || '20000', 10);
const MAX_JOB_AGE_MS = parseInt(process.env.MEDIA_MAX_JOB_AGE_MS || String(5 * 60 * 1000), 10);
const WORKER_CLAIM_WAIT_MS = parseInt(process.env.MEDIA_WORKER_CLAIM_WAIT_MS || '12000', 10);

function normalizeCapability(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized.length ? normalized : null;
}

function normalizeCapabilities(value) {
  if (!value) return [];
  const list = Array.isArray(value)
    ? value
    : String(value)
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

  return [...new Set(list.map(normalizeCapability).filter(Boolean))];
}

function normalizeWorkerMeta(meta = {}) {
  const normalized = { ...meta };
  normalized.capabilities = normalizeCapabilities(meta.capabilities);
  return normalized;
}

function workerHasCapability(worker, capability) {
  if (!capability) return true;
  if (!worker) return false;
  const caps = normalizeCapabilities(worker.meta?.capabilities);
  return caps.includes(capability);
}

function normalizeRequiredCapability(value) {
  const normalized = normalizeCapability(value);
  if (!normalized) return null;
  if (normalized.startsWith('youtube_')) return normalized;
  return `youtube_${normalized}`;
}

function touchWorker(workerId, meta = null) {
  const previous = workers.get(workerId);
  const nextMeta = meta ? normalizeWorkerMeta(meta) : (previous?.meta || {});
  workers.set(workerId, {
    workerId,
    meta: nextMeta,
    lastSeenAt: Date.now(),
  });
}

function getActiveWorkers(requiredCapability = null) {
  const now = Date.now();
  const active = [];
  for (const [workerId, worker] of workers) {
    if (now - worker.lastSeenAt <= WORKER_TTL_MS && workerHasCapability(worker, requiredCapability)) {
      active.push(workerId);
    }
  }
  return active;
}

function createJob(payload, preferredWorkers = [], options = {}) {
  const requiredCapability = normalizeRequiredCapability(options.requiredCapability);
  const activeWorkers = getActiveWorkers(requiredCapability);
  const workersToTry = preferredWorkers.length > 0
    ? preferredWorkers.filter((id) => activeWorkers.includes(id))
    : activeWorkers;

  const id = randomUUID();
  const job = {
    id,
    payload,
    status: 'pending', // pending | assigned | succeeded | failed | fallback
    attempts: [],
    workerOrder: [...workersToTry],
    requiredCapability,
    assignedWorkerId: null,
    assignedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    result: null,
    finalReason: null,
  };

  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function getNextJobForWorker(workerId) {
  touchWorker(workerId);
  const now = Date.now();
  const worker = workers.get(workerId);

  for (const job of jobs.values()) {
    if (job.status !== 'pending') continue;
    if (!job.workerOrder.includes(workerId)) continue;
    if (!workerHasCapability(worker, job.requiredCapability)) continue;

    const alreadyTried = job.attempts.some((a) => a.workerId === workerId);
    if (alreadyTried) continue;

    job.status = 'assigned';
    job.assignedWorkerId = workerId;
    job.assignedAt = now;
    job.updatedAt = now;
    return job;
  }

  return null;
}

function appendAttempt(job, attempt) {
  job.attempts.push({
    workerId: attempt.workerId,
    success: !!attempt.success,
    reason: attempt.reason || null,
    at: Date.now(),
  });
}

function submitJobResult(jobId, workerId, success, payload, error) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false, code: 'NOT_FOUND' };

  if (job.status !== 'assigned' || job.assignedWorkerId !== workerId) {
    return { ok: false, code: 'NOT_ASSIGNED' };
  }

  appendAttempt(job, {
    workerId,
    success,
    reason: success ? null : (error || 'Worker returned failure without message'),
  });

  if (success) {
    job.status = 'succeeded';
    job.result = payload || null;
    job.updatedAt = Date.now();
    notifyWaiters(job);
    return { ok: true };
  }

  job.status = 'pending';
  job.assignedWorkerId = null;
  job.assignedAt = null;
  job.updatedAt = Date.now();
  notifyWaiters(job);
  return { ok: true };
}

function markAssignedTimeout(job, reason) {
  if (job.status !== 'assigned') return;
  appendAttempt(job, {
    workerId: job.assignedWorkerId,
    success: false,
    reason,
  });
  job.status = 'pending';
  job.assignedWorkerId = null;
  job.assignedAt = null;
  job.updatedAt = Date.now();
  notifyWaiters(job);
}

function waitForSignal(jobId, timeoutMs = JOB_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const wrapped = (job) => {
      clearTimeout(timer);
      resolve(job);
    };

    if (!waiters.has(jobId)) waiters.set(jobId, []);
    waiters.get(jobId).push(wrapped);
  });
}

function notifyWaiters(job) {
  const listeners = waiters.get(job.id) || [];
  if (listeners.length === 0) return;
  waiters.delete(job.id);
  for (const fn of listeners) fn(job);
}

function getRemainingWorkers(job) {
  const attempted = new Set(job.attempts.map((a) => a.workerId));
  return job.workerOrder.filter((workerId) => !attempted.has(workerId));
}

function summarizeAttempts(job) {
  if (!job.attempts.length) return 'no attempts';
  return job.attempts
    .map((a) => `${a.workerId}:${a.success ? 'ok' : 'fail'}${a.reason ? `(${a.reason})` : ''}`)
    .join(', ');
}

async function runJobWithFailover(job) {
  if (!job.workerOrder.length) {
    job.status = 'fallback';
    job.finalReason = 'No active cookie workers available';
    return { mode: 'fallback', reason: job.finalReason, attempts: [] };
  }

  while (true) {
    const refreshed = jobs.get(job.id);
    if (!refreshed) {
      return { mode: 'fallback', reason: 'Job disappeared from memory', attempts: [] };
    }

    if (refreshed.status === 'succeeded') {
      return {
        mode: 'worker',
        result: refreshed.result,
        attempts: refreshed.attempts,
      };
    }

    if (refreshed.status === 'assigned') {
      const elapsed = Date.now() - refreshed.assignedAt;
      const waitMs = Math.max(1000, JOB_TIMEOUT_MS - elapsed);
      const signaled = await waitForSignal(refreshed.id, waitMs);
      const current = signaled || jobs.get(refreshed.id);

      if (!current) {
        return { mode: 'fallback', reason: 'Job state lost while assigned', attempts: refreshed.attempts };
      }

      if (current.status === 'assigned' && (Date.now() - current.assignedAt) >= JOB_TIMEOUT_MS) {
        markAssignedTimeout(current, `Timed out after ${JOB_TIMEOUT_MS}ms`);
      }

      continue;
    }

    if (refreshed.status === 'pending') {
      const remaining = getRemainingWorkers(refreshed);
      if (remaining.length === 0) {
        refreshed.status = 'fallback';
        refreshed.finalReason = 'All cookie workers failed';
        return {
          mode: 'fallback',
          reason: `${refreshed.finalReason}. Attempts: ${summarizeAttempts(refreshed)}`,
          attempts: refreshed.attempts,
        };
      }

      // Wait for one of the remaining workers to poll and claim the job.
      // The default is intentionally longer than the worker poll interval to avoid
      // false-negative synthetic failures on temporarily slow networks.
      const signaled = await waitForSignal(refreshed.id, WORKER_CLAIM_WAIT_MS);
      if (!signaled) {
        // If no worker claimed the job during this window, synthesize failure for one worker slot
        // so coordinator can continue cycling through worker order deterministically.
        const nextWorker = remaining[0];
        appendAttempt(refreshed, {
          workerId: nextWorker,
          success: false,
          reason: 'Worker did not poll for job in time',
        });
        refreshed.updatedAt = Date.now();
      }

      continue;
    }

    if (refreshed.status === 'fallback' || refreshed.status === 'failed') {
      return {
        mode: 'fallback',
        reason: refreshed.finalReason || 'Cookie worker extraction failed',
        attempts: refreshed.attempts,
      };
    }
  }
}

function cleanup() {
  const now = Date.now();

  for (const [workerId, worker] of workers) {
    if (now - worker.lastSeenAt > WORKER_TTL_MS * 2) {
      workers.delete(workerId);
    }
  }

  for (const [jobId, job] of jobs) {
    if (now - job.createdAt > MAX_JOB_AGE_MS) {
      jobs.delete(jobId);
      waiters.delete(jobId);
    }
  }
}

setInterval(cleanup, 30000).unref();

module.exports = {
  touchWorker,
  getActiveWorkers,
  normalizeRequiredCapability,
  createJob,
  getJob,
  getNextJobForWorker,
  submitJobResult,
  runJobWithFailover,
  summarizeAttempts,
};
