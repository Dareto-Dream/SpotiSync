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

if (!WORKER_TOKEN) {
  console.error('[Cookie Worker] Missing WORKER_TOKEN env var. Exiting.');
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(path, options = {}) {
  const url = `${BACKEND_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-worker-token': WORKER_TOKEN,
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });
  return response;
}

async function heartbeat() {
  const response = await api('/api/media/worker/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      workerId: WORKER_ID,
      meta: {
        host: process.env.COMPUTERNAME || null,
        browser: COOKIES_BROWSER,
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
    'bestaudio[ext=m4a]/bestaudio/best',
    '-g',
  ];

  if (COOKIES_PROFILE) {
    args.push('--cookies-from-browser', `${COOKIES_BROWSER}:${COOKIES_PROFILE}`);
  } else {
    args.push('--cookies-from-browser', COOKIES_BROWSER);
  }

  args.push(url);

  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp exited with code ${code}: ${stderr.trim() || 'unknown error'}`));
      }

      const audioUrl = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)[0];

      if (!audioUrl) {
        return reject(new Error('yt-dlp did not return an audio URL'));
      }

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
    await submitResult(job.id, {
      success: false,
      error: 'Missing URL in job payload',
    });
    return;
  }

  try {
    const extracted = await runYtDlp(url);
    await submitResult(job.id, {
      success: true,
      result: {
        ...extracted,
        workerId: WORKER_ID,
      },
    });
  } catch (err) {
    await submitResult(job.id, {
      success: false,
      error: err.message,
    });
  }
}

async function start() {
  console.log(`[Cookie Worker] Starting ${WORKER_ID}, backend=${BACKEND_URL}, browser=${COOKIES_BROWSER}`);

  setInterval(async () => {
    try {
      await heartbeat();
    } catch (err) {
      console.error('[Cookie Worker] Heartbeat error:', err.message);
    }
  }, HEARTBEAT_INTERVAL_MS).unref();

  while (true) {
    try {
      await heartbeat();
      const job = await pollOnce();
      if (job) {
        console.log(`[Cookie Worker] Processing job ${job.id} for video ${job.payload?.videoId || 'unknown'}`);
        await processJob(job);
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      console.error('[Cookie Worker] Loop error:', err.message);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

start().catch((err) => {
  console.error('[Cookie Worker] Fatal error:', err.message);
  process.exit(1);
});
