require('dotenv').config();
const http = require('http');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const WORKER_ID = process.env.WORKER_ID || `worker-${Math.random().toString(36).slice(2, 8)}`;
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '3000', 10);
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '10000', 10);
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const STREAM_HOST = process.env.WORKER_STREAM_HOST || '0.0.0.0';
const STREAM_PORT = parseInt(process.env.WORKER_STREAM_PORT || '4011', 10);
const STREAM_PATH_PREFIX = process.env.WORKER_STREAM_PATH_PREFIX || '/stream';
const STREAM_TTL_MS = parseInt(process.env.WORKER_STREAM_TTL_MS || String(2 * 60 * 1000), 10);
const ENABLE_FFMPEG_TRANSCODE = String(process.env.WORKER_ENABLE_FFMPEG_TRANSCODE || 'false').toLowerCase() === 'true';
const FFMPEG_ARGS = process.env.WORKER_FFMPEG_ARGS || '-hide_banner -loglevel error -i pipe:0 -vn -f opus -acodec libopus -ar 48000 -ac 2 pipe:1';
const WORKER_PUBLIC_BASE_URL = (process.env.WORKER_PUBLIC_BASE_URL || `http://localhost:${STREAM_PORT}`).replace(/\/$/, '');

// Example: chrome, edge, firefox, brave
const COOKIES_BROWSER = process.env.WORKER_COOKIES_BROWSER || 'chrome';
// Optional profile path for chromium-based browsers.
const COOKIES_PROFILE = process.env.WORKER_COOKIES_PROFILE || '';
const WORKER_CAPABILITIES = process.env.WORKER_CAPABILITIES || '';
const streamSessions = new Map(); // token -> { token, url, videoId, jobId, expiresAt }

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

function tokenizeArgs(value) {
  if (!value || !String(value).trim()) return [];
  return String(value)
    .match(/"[^"]*"|'[^']*'|[^\s]+/g)
    .map((part) => part.replace(/^["']|["']$/g, ''));
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

function buildYtDlpStreamArgs(url) {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes',
    'node',
    '--extractor-args',
    'youtube:player_client=web',
    '-f',
    'ba/b',
    '-o',
    '-',
  ];

  if (COOKIES_PROFILE) {
    args.push('--cookies-from-browser', `${COOKIES_BROWSER}:${COOKIES_PROFILE}`);
  } else {
    args.push('--cookies-from-browser', COOKIES_BROWSER);
  }

  args.push(url);
  return args;
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of streamSessions) {
    if (session.expiresAt <= now) {
      streamSessions.delete(token);
    }
  }
}

function createStreamSession(job) {
  const videoId = job.payload?.videoId;
  const url = job.payload?.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);

  if (!url) {
    throw new Error('Missing URL in job payload');
  }

  const token = randomUUID();
  const expiresAt = Date.now() + STREAM_TTL_MS;
  const streamPath = `${STREAM_PATH_PREFIX.replace(/\/$/, '')}/${encodeURIComponent(token)}`;
  const endpoint = `${WORKER_PUBLIC_BASE_URL}${streamPath}`;

  streamSessions.set(token, {
    token,
    url,
    videoId: videoId || null,
    jobId: job.id,
    expiresAt,
  });

  return {
    streamEndpoint: endpoint,
    streamToken: token,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function handleStreamRequest(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || `localhost:${STREAM_PORT}`}`);
  const pathPrefix = STREAM_PATH_PREFIX.replace(/\/$/, '');
  const expectedPrefix = `${pathPrefix}/`;
  if (!parsedUrl.pathname.startsWith(expectedPrefix)) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  const token = decodeURIComponent(parsedUrl.pathname.slice(expectedPrefix.length)).trim();
  if (!token) {
    return sendJson(res, 400, { error: 'Missing stream token' });
  }

  const session = streamSessions.get(token);
  if (!session) {
    return sendJson(res, 404, { error: 'Invalid or expired stream token' });
  }

  if (session.expiresAt <= Date.now()) {
    streamSessions.delete(token);
    return sendJson(res, 410, { error: 'Stream token expired' });
  }

  // One-time stream sessions keep token reuse and race conditions predictable.
  streamSessions.delete(token);

  const ytDlpArgs = buildYtDlpStreamArgs(session.url);
  const ytDlp = spawn(YTDLP_BIN, ytDlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  const ffmpeg = ENABLE_FFMPEG_TRANSCODE
    ? spawn(FFMPEG_BIN, tokenizeArgs(FFMPEG_ARGS), { stdio: ['pipe', 'pipe', 'pipe'] })
    : null;

  const start = Date.now();
  let finished = false;
  let ytDlpStderr = '';
  let ffmpegStderr = '';

  const endWithError = (statusCode, message, err) => {
    if (finished) return;
    finished = true;
    if (err) {
      logError(`Stream error token=${token} job=${session.jobId} message=${message}`, err.message || err);
    } else {
      logError(`Stream error token=${token} job=${session.jobId} message=${message}`);
    }

    if (!res.headersSent) {
      sendJson(res, statusCode, { error: message });
    } else {
      res.destroy();
    }
  };

  const completeOk = () => {
    if (finished) return;
    finished = true;
    log(`Stream complete token=${token} job=${session.jobId} ms=${Date.now() - start}`);
  };

  const abortChildren = () => {
    ytDlp.kill('SIGTERM');
    if (ffmpeg) ffmpeg.kill('SIGTERM');
  };

  req.on('aborted', abortChildren);
  req.on('close', () => {
    if (!res.writableEnded) abortChildren();
  });

  ytDlp.on('error', (err) => endWithError(500, 'Failed to start yt-dlp process', err));
  ytDlp.stderr.on('data', (chunk) => {
    ytDlpStderr += chunk.toString();
  });

  if (ffmpeg) {
    ffmpeg.on('error', (err) => endWithError(500, 'Failed to start ffmpeg process', err));
    ffmpeg.stderr.on('data', (chunk) => {
      ffmpegStderr += chunk.toString();
    });
  }

  res.statusCode = 200;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Content-Type', ENABLE_FFMPEG_TRANSCODE ? 'audio/opus' : 'application/octet-stream');

  if (ffmpeg) {
    ytDlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);
    ffmpeg.stdout.on('end', completeOk);
  } else {
    ytDlp.stdout.pipe(res);
    ytDlp.stdout.on('end', completeOk);
  }

  ytDlp.on('close', (code) => {
    if (code !== 0) {
      return endWithError(502, `yt-dlp failed with code ${code}`);
    }
    if (!ffmpeg) return;
    ffmpeg.stdin.end();
  });

  if (ffmpeg) {
    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        return endWithError(502, `ffmpeg failed with code ${code}`);
      }
      completeOk();
    });
  }

  res.on('error', (err) => {
    logError(`HTTP stream response error token=${token} job=${session.jobId}`, err.message);
    abortChildren();
  });

  res.on('close', () => {
    log(
      `Stream closed token=${token} job=${session.jobId} ms=${Date.now() - start} ytStderrBytes=${Buffer.byteLength(ytDlpStderr, 'utf8')} ffmpegStderrBytes=${Buffer.byteLength(ffmpegStderr, 'utf8')}`
    );
  });
}

function startStreamServer() {
  const server = http.createServer((req, res) => {
    try {
      handleStreamRequest(req, res);
    } catch (err) {
      logError('Unexpected stream handler error', err.message);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal stream error' });
      } else {
        res.destroy();
      }
    }
  });

  server.listen(STREAM_PORT, STREAM_HOST, () => {
    log(`Stream server listening on ${STREAM_HOST}:${STREAM_PORT} publicBase=${WORKER_PUBLIC_BASE_URL}`);
  });

  server.on('error', (err) => {
    logError('Stream server failed', err.message);
    process.exit(1);
  });
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
  try {
    const start = Date.now();
    log(`Job ${job.id} start video=${job.payload?.videoId || 'unknown'}`);
    const streamInfo = createStreamSession(job);
    await submitResult(job.id, {
      success: true,
      result: {
        ...streamInfo,
        streamMode: ENABLE_FFMPEG_TRANSCODE ? 'yt-dlp+ffmpeg' : 'yt-dlp',
        contentType: ENABLE_FFMPEG_TRANSCODE ? 'audio/opus' : 'application/octet-stream',
        workerId: WORKER_ID,
        fetchedAt: new Date().toISOString(),
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
  log(
    `Starting ${WORKER_ID}, backend=${BACKEND_URL}, browser=${COOKIES_BROWSER}, capabilities=${getCapabilities().join(',')}, streamBase=${WORKER_PUBLIC_BASE_URL}`
  );
  startStreamServer();

  setInterval(() => {
    cleanupExpiredSessions();
  }, Math.max(15000, Math.floor(STREAM_TTL_MS / 2))).unref();

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
