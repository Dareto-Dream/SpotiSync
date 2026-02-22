const express = require('express');
const ytdl = require('@distube/ytdl-core');
const ytdlp = require('youtube-dl-exec');
const { verifyWsToken } = require('../auth/middleware');

const router = express.Router();

/**
 * Accepts either Authorization: Bearer <token> header or ?token=<jwt> query.
 * The query param path is needed because <audio> tags cannot set auth headers.
 */
function requireStreamAuth(req, res, next) {
  const header = req.headers.authorization;
  const tokenFromHeader = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = tokenFromHeader || req.query.token;

  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  const user = verifyWsToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = user;
  next();
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const https = require('node:https');
const http = require('node:http');
const { PassThrough } = require('node:stream');

function pickAudioFormats(info) {
  const audioOnly = info.formats
    .filter(f => f.hasAudio && !f.hasVideo)
    // Prefer webm/opus (lower bw) then m4a/aac as fallback
    .sort((a, b) => {
      const brA = Number(a.bitrate || a.audioBitrate || 0);
      const brB = Number(b.bitrate || b.audioBitrate || 0);
      return brB - brA;
    });
  return audioOnly;
}

async function getAudioFormats(videoId) {
  try {
    const info = await ytdl.getInfo(videoId);
    let formats = pickAudioFormats(info);
    // Filter out formats missing direct URLs (happens when decipher fails)
    formats = formats.filter(f => f.url);
    if (!formats.length) throw new Error('No audio format available from ytdl-core');
    return { info, formats };
  } catch (err) {
    console.warn('[Stream] ytdl-core failed, falling back to yt-dlp:', err.message);
    return await getAudioFormatsViaYtDlp(videoId);
  }
}

async function getAudioFormatsViaYtDlp(videoId) {
  const json = await ytdlp(
    `https://www.youtube.com/watch?v=${videoId}`,
    {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      addHeader: ['User-Agent: ' + UA, 'Accept-Language: en-US,en;q=0.9'],
      format: 'bestaudio/best',
      referer: 'https://www.youtube.com/',
    }
  );

  const streams = Array.isArray(json.formats) ? json.formats : [];
  const audioFormats = streams
    .filter(f => f.acodec && f.acodec !== 'none')
    .map(f => ({
      url: f.url,
      mimeType: f.mime_type || 'audio/webm',
      contentLength: f.filesize || f.filesize_approx || 0,
      hasAudio: true,
      hasVideo: false,
      bitrate: f.tbr || f.abr || 0,
    }))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  if (!audioFormats.length) throw new Error('No audio format available');

  return {
    info: { player_response: {} },
    formats: audioFormats,
  };
}

function ytdlReadableFromUrl(url, { start, end, headers = {} } = {}) {
  const stream = new PassThrough();
  const u = new URL(url);
  const client = u.protocol === 'https:' ? https : http;
  const req = client.get({
    hostname: u.hostname,
    path: u.pathname + u.search,
    protocol: u.protocol,
    headers: {
      ...headers,
      Range: typeof start === 'number' && typeof end === 'number'
        ? `bytes=${start}-${end}`
        : undefined,
    },
  }, (res) => {
    if (res.statusCode && res.statusCode >= 400) {
      stream.destroy(new Error(`Upstream responded ${res.statusCode}`));
      req.destroy();
      return;
    }
    res.pipe(stream);
  });
  req.on('error', (err) => stream.destroy(err));
  stream.on('close', () => req.destroy());
  return stream;
}

router.get('/stream/:videoId', requireStreamAuth, async (req, res) => {
  const { videoId } = req.params;
  const range = req.headers.range;

  try {
    const { info, formats } = await getAudioFormats(videoId);

    let attempt = 0;

    async function tryPipe() {
      const format = formats[attempt];
      if (!format) throw new Error('No playable format (all attempts failed)');

      const totalBytes = parseInt(format.contentLength || format.clen || '0', 10);
      const mimeType = (format.mimeType || format.mime_type || 'audio/webm').split(';')[0];
      const commonOpts = {
        format,
        highWaterMark: 1 << 20,
        requestOptions: { headers: { 'User-Agent': UA, 'accept-language': 'en-US,en;q=0.9' } },
      };

      // Range requests for seek/resume support
    if (range && totalBytes && totalBytes > 0) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
        const start = Number(startStr) || 0;
        const end = endStr ? Number(endStr) : totalBytes - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${totalBytes}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=300',
        });

      const stream = format.url
        ? ytdlReadableFromUrl(format.url, { start, end, headers: commonOpts.requestOptions.headers })
        : ytdl.downloadFromInfo(info, { ...commonOpts, range: { start, end } });
        stream.on('error', onError);
        return stream.pipe(res);
      }

      // Full stream
      if (totalBytes) res.setHeader('Content-Length', totalBytes);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=300');

      const stream = format.url
        ? ytdlReadableFromUrl(format.url, { headers: commonOpts.requestOptions.headers })
        : ytdl.downloadFromInfo(info, commonOpts);
      stream.on('error', onError);
      stream.on('response', (r) => {
        if (r.statusCode && r.statusCode >= 400) {
          stream.destroy(new Error(`Upstream responded ${r.statusCode}`));
        }
      });
      stream.pipe(res);
    }

    function onError(err) {
      attempt += 1;
      console.warn(`[Stream] Format attempt ${attempt} failed:`, err.message);
      if (res.headersSent) return res.destroy(err);
      if (attempt < formats.length) {
        tryPipe();
      } else {
        res.status(502).json({ error: 'Audio unavailable' });
      }
    }

    await tryPipe();
  } catch (err) {
    console.error('[Stream] Failed to proxy audio:', err.message);
    if (!res.headersSent) {
      const status = /Not found/i.test(err.message) ? 404 : 500;
      res.status(status).json({ error: 'Audio unavailable' });
    } else {
      res.destroy(err);
    }
  }
});

module.exports = router;
