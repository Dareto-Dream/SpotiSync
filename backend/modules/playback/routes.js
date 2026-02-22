const express = require('express');
const ytdl = require('ytdl-core');
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

async function getAudioFormat(videoId) {
  const info = await ytdl.getInfo(videoId);
  const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
  if (!format) throw new Error('No audio format available');
  const totalBytes = parseInt(format.contentLength || '0', 10);
  const mimeType = (format.mimeType || 'audio/webm').split(';')[0];
  return { info, format, totalBytes, mimeType };
}

router.get('/stream/:videoId', requireStreamAuth, async (req, res) => {
  const { videoId } = req.params;
  const range = req.headers.range;

  try {
    const { info, format, totalBytes, mimeType } = await getAudioFormat(videoId);

    // Range requests for seek/resume support
    if (range && totalBytes) {
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

      const stream = ytdl.downloadFromInfo(info, {
        format,
        range: { start, end },
        highWaterMark: 1 << 20, // 1MB buffer for smoother backpressure
      });
      stream.on('error', (err) => {
        console.error('[Stream] ytdl error (range):', err.message);
        if (!res.headersSent) res.status(500).end();
        else res.destroy(err);
      });
      return stream.pipe(res);
    }

    // Full stream
    if (totalBytes) res.setHeader('Content-Length', totalBytes);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=300');

    const stream = ytdl.downloadFromInfo(info, {
      format,
      highWaterMark: 1 << 20,
    });
    stream.on('error', (err) => {
      console.error('[Stream] ytdl error:', err.message);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    });
    stream.pipe(res);
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
