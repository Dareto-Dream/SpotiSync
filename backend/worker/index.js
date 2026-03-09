require('dotenv').config();
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const WORKER_ID = process.env.WORKER_ID || `worker-${Math.random().toString(36).slice(2, 8)}`;
const WORKER_TOKEN = process.env.WORKER_TOKEN || '';
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '3000', 10);
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.WORKER_HEARTBEAT_INTERVAL_MS || '10000', 10);
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const ENABLE_FFMPEG_TRANSCODE = String(process.env.WORKER_ENABLE_FFMPEG_TRANSCODE || 'false').toLowerCase() === 'true';
const FFMPEG_ARGS = process.env.WORKER_FFMPEG_ARGS || '-hide_banner -loglevel error -i pipe:0 -vn -f opus -acodec libopus -ar 48000 -ac 2 pipe:1';
const WORKER_WS_URL = process.env.WORKER_WS_URL || toWorkerWsUrl(BACKEND_URL);

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

function toWorkerWsUrl(httpUrl) {
  if (httpUrl.startsWith('https://')) return httpUrl.replace(/^https:/, 'wss:') + '/ws-worker';
  if (httpUrl.startsWith('http://')) return httpUrl.replace(/^http:/, 'ws:') + '/ws-worker';
  return `ws://${httpUrl.replace(/\/$/, '')}/ws-worker`;
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
    '--extractor-args',
    'youtube:player_client=tv_embedded',
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

function getStreamContentType() {
  return ENABLE_FFMPEG_TRANSCODE ? 'audio/opus' : 'application/octet-stream';
}

function openWorkerSocket() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WORKER_WS_URL);
    ws.binaryType = 'nodebuffer';
    let authed = false;

    const fail = (err) => {
      try { ws.close(); } catch {}
      reject(err);
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({ event: 'auth', data: { token: WORKER_TOKEN, workerId: WORKER_ID } }));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.event === 'authed') {
        authed = true;
        resolve(ws);
      }
      if (msg.event === 'error' && !authed) {
        fail(new Error(msg?.data?.message || 'Worker WS auth failed'));
      }
    });

    ws.on('error', (err) => {
      if (!authed) fail(err);
    });
  });
}

async function waitForStreamStart(ws, proxyToken) {
  return new Promise((resolve, reject) => {
    const onMessage = (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.event === 'stream_start' && msg?.data?.proxyToken === proxyToken) {
        cleanup();
        resolve(true);
      }
      if (msg.event === 'stream_cancel' && msg?.data?.proxyToken === proxyToken) {
        cleanup();
        resolve(false);
      }
    };

    const onClose = () => {
      cleanup();
      reject(new Error('Worker WS closed before stream start'));
    };

    const cleanup = () => {
      ws.off('message', onMessage);
      ws.off('close', onClose);
    };

    ws.on('message', onMessage);
    ws.on('close', onClose);
  });
}

function pumpStreamToWs(readable, ws, proxyToken) {
  return new Promise((resolve, reject) => {
    const MAX_BUFFER = 8 * 1024 * 1024;
    let paused = false;
    let bytesSent = 0;

    const maybeResume = () => {
      if (!paused) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount < MAX_BUFFER / 2) {
        paused = false;
        readable.resume();
      }
    };

    const bufferCheck = setInterval(maybeResume, 200).unref();

    const onData = (chunk) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      bytesSent += chunk.length;
      ws.send(chunk, { binary: true }, (err) => {
        if (err) reject(err);
      });
      if (ws.bufferedAmount > MAX_BUFFER && !paused) {
        paused = true;
        readable.pause();
      }
    };

    const onEnd = () => {
      clearInterval(bufferCheck);
      resolve(bytesSent);
    };

    const onError = (err) => {
      clearInterval(bufferCheck);
      reject(err);
    };

    readable.on('data', onData);
    readable.on('end', onEnd);
    readable.on('error', onError);

    ws.on('close', () => {
      clearInterval(bufferCheck);
      readable.destroy();
    });
  });
}

async function streamJobViaWebSocket(job) {
  const proxyToken = job.payload?.streamProxyToken;
  if (!proxyToken) throw new Error('Missing streamProxyToken in job payload');

  const videoId = job.payload?.videoId;
  const url = job.payload?.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
  if (!url) throw new Error('Missing URL in job payload');

  const ws = await openWorkerSocket();
  const contentType = getStreamContentType();

  ws.send(JSON.stringify({
    event: 'stream_ready',
    data: { proxyToken, contentType },
  }));
  log(`Sent stream_ready proxyToken=${proxyToken}`);

  await submitResult(job.id, {
    success: true,
    result: {
      streamProxyToken: proxyToken,
      streamMode: ENABLE_FFMPEG_TRANSCODE ? 'yt-dlp+ffmpeg' : 'yt-dlp',
      contentType,
      workerId: WORKER_ID,
      fetchedAt: new Date().toISOString(),
    },
  });

  log(`Waiting for stream_start proxyToken=${proxyToken}`);
  const shouldStart = await waitForStreamStart(ws, proxyToken);
  log(`waitForStreamStart result=${shouldStart} proxyToken=${proxyToken}`);
  if (!shouldStart) {
    try { ws.close(1000, 'Cancelled'); } catch {}
    return;
  }

  const ytDlpArgs = buildYtDlpStreamArgs(url);
  log(`Spawning yt-dlp args=${JSON.stringify(ytDlpArgs)}`);
  const ytDlp = spawn(YTDLP_BIN, ytDlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  const ffmpeg = ENABLE_FFMPEG_TRANSCODE
    ? spawn(FFMPEG_BIN, tokenizeArgs(FFMPEG_ARGS), { stdio: ['pipe', 'pipe', 'pipe'] })
    : null;

  const abortChildren = () => {
    ytDlp.kill('SIGTERM');
    if (ffmpeg) ffmpeg.kill('SIGTERM');
  };

  // Capture yt-dlp stderr so failures are visible in logs
  let ytDlpStderr = '';
  ytDlp.stderr.on('data', (chunk) => { ytDlpStderr += chunk.toString(); });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.event === 'stream_cancel' && msg?.data?.proxyToken === proxyToken) {
      abortChildren();
      try { ws.close(1000, 'Cancelled'); } catch {}
    }
  });

  ytDlp.on('error', (err) => {
    ws.send(JSON.stringify({ event: 'stream_error', data: { proxyToken, message: err.message } }));
    abortChildren();
  });

  const source = ffmpeg ? ffmpeg.stdout : ytDlp.stdout;
  if (ffmpeg) ytDlp.stdout.pipe(ffmpeg.stdin);

  try {
    const bytesStreamed = await pumpStreamToWs(source, ws, proxyToken);
    log(`pumpStreamToWs finished proxyToken=${proxyToken} bytesStreamed=${bytesStreamed}`);
    if (ytDlpStderr.trim()) {
      logError(`yt-dlp stderr:\n${ytDlpStderr.trim()}`);
    }
    if (bytesStreamed === 0) {
      const reason = ytDlpStderr.trim().split('\n').pop() || 'yt-dlp produced no output';
      ws.send(JSON.stringify({ event: 'stream_error', data: { proxyToken, message: `yt-dlp produced no audio: ${reason}` } }));
    } else {
      ws.send(JSON.stringify({ event: 'stream_end', data: { proxyToken } }));
    }
  } catch (err) {
    ws.send(JSON.stringify({ event: 'stream_error', data: { proxyToken, message: err.message } }));
  } finally {
    abortChildren();
    try { ws.close(1000, 'Done'); } catch {}
  }
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
    await streamJobViaWebSocket(job);
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
    `Starting ${WORKER_ID}, backend=${BACKEND_URL}, browser=${COOKIES_BROWSER}, capabilities=${getCapabilities().join(',')}, workerWs=${WORKER_WS_URL}`
  );

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
