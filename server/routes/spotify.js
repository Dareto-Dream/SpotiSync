import { Router } from 'express';
import { spotifyGet, getValidToken } from '../utils/spotify.js';

const router = Router();

// GET /api/spotify/search
router.get('/search', async (req, res) => {
  const { q, sessionId, type = 'track', limit = 20 } = req.query;
  
  console.log('[Routes/Spotify] GET /search:', {
    q,
    sessionId,
    type,
    limit,
    timestamp: new Date().toISOString()
  });

  if (!q || !sessionId) {
    console.error('[Routes/Spotify] Missing required params');
    return res.status(400).json({ error: 'q and sessionId required' });
  }

  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.getById(sessionId);
    
    if (!session) {
      console.error('[Routes/Spotify] Session not found:', sessionId);
      return res.status(404).json({ error: 'Session not found' });
    }

    console.log('[Routes/Spotify] Session found, getting token...');
    const token = await getValidToken(session, sessionStore);
    
    console.log('[Routes/Spotify] Calling Spotify search API...');
    const response = await spotifyGet(
      `/v1/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`,
      token
    );

    const data = await response.json();
    console.log('[Routes/Spotify] ✅ Search results:', {
      trackCount: data.tracks?.items?.length
    });
    
    res.json(data);
  } catch (err) {
    console.error('[Routes/Spotify] Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/spotify/me
router.get('/me', async (req, res) => {
  const { sessionId } = req.query;
  
  console.log('[Routes/Spotify] GET /me:', { sessionId });

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.getById(sessionId);
    
    if (!session) {
      console.error('[Routes/Spotify] Session not found');
      return res.status(404).json({ error: 'Session not found' });
    }

    const token = await getValidToken(session, sessionStore);
    const response = await spotifyGet('/v1/me', token);
    const data = await response.json();
    
    console.log('[Routes/Spotify] ✅ User profile:', {
      id: data.id,
      displayName: data.display_name,
      product: data.product
    });
    
    res.json(data);
  } catch (err) {
    console.error('[Routes/Spotify] /me error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/spotify/devices
router.get('/devices', async (req, res) => {
  const { sessionId } = req.query;
  
  console.log('[Routes/Spotify] GET /devices:', { sessionId });

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.getById(sessionId);
    
    if (!session) {
      console.error('[Routes/Spotify] Session not found');
      return res.status(404).json({ error: 'Session not found' });
    }

    const token = await getValidToken(session, sessionStore);
    const response = await spotifyGet('/v1/me/player/devices', token);
    const data = await response.json();
    
    console.log('[Routes/Spotify] ✅ Devices:', {
      count: data.devices?.length,
      devices: data.devices?.map(d => ({ id: d.id, name: d.name, type: d.type, is_active: d.is_active }))
    });
    
    res.json(data);
  } catch (err) {
    console.error('[Routes/Spotify] /devices error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/spotify/player
router.get('/player', async (req, res) => {
  const { sessionId } = req.query;
  
  console.log('[Routes/Spotify] GET /player:', { sessionId });

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.getById(sessionId);
    
    if (!session) {
      console.error('[Routes/Spotify] Session not found');
      return res.status(404).json({ error: 'Session not found' });
    }

    const token = await getValidToken(session, sessionStore);
    const response = await spotifyGet('/v1/me/player', token);
    
    if (response.status === 204) {
      console.log('[Routes/Spotify] No active playback (204)');
      return res.json(null);
    }
    
    const data = await response.json();
    console.log('[Routes/Spotify] ✅ Player state:', {
      isPlaying: data.is_playing,
      device: data.device?.name,
      track: data.item?.name
    });
    
    res.json(data);
  } catch (err) {
    console.error('[Routes/Spotify] /player error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
