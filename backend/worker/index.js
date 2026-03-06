require('dotenv').config();
const { spawn } = require('child_process');

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const WORKER_ID = process.env.WORKER_ID || `worker-${Math.random().toString(36).slice(2, 8)}`;
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '3000', 10);
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '10000', 10);
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';

// Example: chrome, edge, firefox, brave
const COOKIES_BROWSER = process.env.WORKER_COOKIES_BROWSER || 'chrome';
// Optional profile path for chromium-based browsers.
const COOKIES_PROFILE = process.env.WORKER_COOKIES_PROFILE || '';
const WORKER_CAPABILITIES = process.env.WORKER_CAPABILITIES || '';

if (!WORKER_TOKEN) {
  console.error('[Cookie Worker] Missing WORKER_TOKEN env var. Exiting.');
  process.exit(1);
}

function log(message) {
  console.log(`[Cookie Worker] ${new Date().toISOString()} ${message}`);
}

function logError(message, err) {
  if (err) {
    console.error(`[Cookie Worker] ${new Date().toISOString()} ${message}`, err);
    return;
  }
  console.error(`[Cookie Worker] ${new Date().toISOString()} ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCapabilities() {
  const parsed = WORKER_CAPABILITIES
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const defaults = [`youtube_${String(COOKIES_BROWSER).trim().toLowerCase()}`];
  return [...new Set([...defaults, ...parsed])];
}

async function api(path, options = {}) {
  const url = `${BACKEND_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-worker-token': WORKER_TOKEN,
    ...(options.headers || {}),
  };

  const method = options.method || 'GET';
  const start = Date.now();
  log(`API ${method} ${path} -> ${url}`);

  const response = await fetch(url, { ...options, headers });
  log(`API ${method} ${path} <- ${response.status} (${Date.now() - start}ms)`);
  return response;
}

async function heartbeat() {
  const capabilities = getCapabilities();
  const response = await api('/api/media/worker/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      workerId: WORKER_ID,
      meta: {
        host: process.env.COMPUTERNAME || null,
        browser: COOKIES_BROWSER,
        capabilities,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Heartbeat failed (${response.status}): ${text}`);
  }
}

function runYtDlp(url) {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '-f',
    'ba/b',
    '-g',
  ];

  if (COOKIES_PROFILE) {
    args.push('--cookies-from-browser', `${COOKIES_BROWSER}:${COOKIES_PROFILE}`);
  } else {
    args.push('--cookies-from-browser', COOKIES_BROWSER);
  }

  args.push(url);

  return new Promise((resolve, reject) => {
    log(`yt-dlp start url=${url}`);
    log(`yt-dlp args=${[YTDLP_BIN, ...args].join(' ')}`);
    const child = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stderrBytes = 0;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBytes += Buffer.byteLength(text, 'utf8');
      stderr += text;
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        logError(`yt-dlp failed code=${code} stderrBytes=${stderrBytes}`);
        return reject(new Error(`yt-dlp exited with code ${code}: ${stderr.trim() || 'unknown error'}`));
      }

      const lines = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const audioUrl = lines[lines.length - 1];

      if (!audioUrl) {
        logError(`yt-dlp returned no audio URL stderrBytes=${stderrBytes}`);
        return reject(new Error('yt-dlp did not return an audio URL'));
      }

      log(`yt-dlp success audioUrl=${audioUrl} stderrBytes=${stderrBytes}`);
      resolve({
        audioUrl,
        fetchedAt: new Date().toISOString(),
      });
    });
  });
}

async function pollOnce() {
  const res = await api(`/api/media/worker/jobs/next?workerId=${encodeURIComponent(WORKER_ID)}`);

  if (res.status === 204) return null;

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Polling failed (${res.status}): ${text}`);
  }

  const body = await res.json();
  return body.job || null;
}

async function submitResult(jobId, payload) {
  log(`Submit result job=${jobId} success=${payload?.success === true}`);
  const res = await api(`/api/media/worker/jobs/${encodeURIComponent(jobId)}/result`, {
    method: 'POST',
    body: JSON.stringify({
      workerId: WORKER_ID,
      ...payload,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Submit failed (${res.status}): ${text}`);
  }
}

async function processJob(job) {
  const videoId = job.payload?.videoId;
  const url = job.payload?.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);

  if (!url) {
    logError(`Job ${job.id} missing URL in payload`);
    await submitResult(job.id, {
      success: false,
      error: 'Missing URL in job payload',
    });
    return;
  }

  try {
    const start = Date.now();
    log(`Job ${job.id} start video=${videoId || 'unknown'} url=${url}`);
    const extracted = await runYtDlp(url);
    await submitResult(job.id, {
      success: true,
      result: {
        ...extracted,
        workerId: WORKER_ID,
      },
    });
    log(`Job ${job.id} complete in ${Date.now() - start}ms`);
  } catch (err) {
    logError(`Job ${job.id} failed`, err.message);
    await submitResult(job.id, {
      success: false,
      error: err.message,
    });
  }
}

async function start() {
  log(`Starting ${WORKER_ID}, backend=${BACKEND_URL}, browser=${COOKIES_BROWSER}, capabilities=${getCapabilities().join(',')}`);

  setInterval(async () => {
    try {
      await heartbeat();
    } catch (err) {
      logError('Heartbeat error', err.message);
    }
  }, HEARTBEAT_INTERVAL_MS).unref();

  while (true) {
    try {
      await heartbeat();
      const job = await pollOnce();
      if (job) {
        log(`Processing job ${job.id} for video ${job.payload?.videoId || 'unknown'}`);
        await processJob(job);
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      logError('Loop error', err.message);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

start().catch((err) => {
  logError('Fatal error', err.message);
  process.exit(1);
});
