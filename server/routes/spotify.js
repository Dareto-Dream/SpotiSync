import { Router } from 'express';
import { sessionStore } from '../store/sessions.js';
import { spotifyGet, getValidToken } from '../utils/spotify.js';

const router = Router();

// GET /api/spotify/search?q=...&sessionId=...
router.get('/search', async (req, res) => {
  const { q, sessionId, type = 'track', limit = 20 } = req.query;
  if (!q || !sessionId) return res.status(400).json({ error: 'q and sessionId required' });

  const session = sessionStore.getById(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const token = await getValidToken(session, sessionStore);
    const data = await spotifyGet(
      `/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`,
      token
    );
    res.json(data);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/spotify/me?sessionId=... — get host profile
router.get('/me', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = sessionStore.getById(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const token = await getValidToken(session, sessionStore);
    const data = await spotifyGet('/me', token);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/spotify/devices?sessionId=...
router.get('/devices', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = sessionStore.getById(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const token = await getValidToken(session, sessionStore);
    const data = await spotifyGet('/me/player/devices', token);
    res.json(data);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/spotify/player?sessionId=... — current playback state
router.get('/player', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  const session = sessionStore.getById(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  try {
    const token = await getValidToken(session, sessionStore);
    const data = await spotifyGet('/me/player', token);
    res.json(data);
  } catch (err) {
    if (err.status === 204 || err.message?.includes('No active device')) {
      return res.json(null);
    }
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
