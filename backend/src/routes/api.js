import express from 'express';
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getValidAccessToken,
  getUserProfile
} from '../modules/auth.js';
import {
  createRoom,
  getRoomByCode,
  joinRoom,
  getRoomMembers
} from '../modules/room.js';
import {
  getQueue,
  addToQueue,
  removeFromQueue,
  searchTracks
} from '../modules/playback.js';

const router = express.Router();

// Auth routes
router.get('/auth/login', (req, res) => {
  const state = req.query.state || 'default';
  const authUrl = getAuthorizationUrl(state);
  res.json({ authUrl });
});

router.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${process.env.FRONTEND_URL}?error=${error}`);
  }

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}?error=no_code`);
  }

  try {
    const result = await exchangeCodeForTokens(code);
    
    // Redirect to frontend with user info
    const params = new URLSearchParams({
      userId: result.userId,
      displayName: result.profile.display_name || result.userId,
      state: state || 'default'
    });

    res.redirect(`${process.env.FRONTEND_URL}/callback?${params.toString()}`);
  } catch (error) {
    console.error('Callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL}?error=auth_failed`);
  }
});

router.get('/auth/refresh', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  try {
    const accessToken = await getValidAccessToken(userId);
    res.json({ accessToken });
  } catch (error) {
    console.error('Refresh error:', error);
    res.status(401).json({ error: 'Failed to refresh token' });
  }
});

router.get('/auth/profile', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  try {
    const accessToken = await getValidAccessToken(userId);
    const profile = await getUserProfile(accessToken);
    res.json(profile);
  } catch (error) {
    console.error('Profile error:', error);
    res.status(401).json({ error: 'Failed to get profile' });
  }
});

// Room routes
router.post('/rooms/create', async (req, res) => {
  const { hostId, displayName } = req.body;

  if (!hostId || !displayName) {
    return res.status(400).json({ error: 'hostId and displayName required' });
  }

  try {
    const room = await createRoom(hostId, displayName);
    res.json(room);
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

router.get('/rooms/:roomCode', async (req, res) => {
  const { roomCode } = req.params;

  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const members = await getRoomMembers(roomCode);
    const queue = await getQueue(roomCode);

    res.json({ room, members, queue });
  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({ error: 'Failed to get room' });
  }
});

router.post('/rooms/:roomCode/join', async (req, res) => {
  const { roomCode } = req.params;
  const { userId, displayName } = req.body;

  if (!userId || !displayName) {
    return res.status(400).json({ error: 'userId and displayName required' });
  }

  try {
    const result = await joinRoom(roomCode, userId, displayName);
    res.json(result);
  } catch (error) {
    console.error('Join room error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Queue routes
router.get('/rooms/:roomCode/queue', async (req, res) => {
  const { roomCode } = req.params;

  try {
    const queue = await getQueue(roomCode);
    res.json({ queue });
  } catch (error) {
    console.error('Get queue error:', error);
    res.status(500).json({ error: 'Failed to get queue' });
  }
});

router.post('/rooms/:roomCode/queue', async (req, res) => {
  const { roomCode } = req.params;
  const { track, addedBy } = req.body;

  if (!track || !addedBy) {
    return res.status(400).json({ error: 'track and addedBy required' });
  }

  try {
    const queue = await addToQueue(roomCode, track, addedBy);
    res.json({ queue });
  } catch (error) {
    console.error('Add to queue error:', error);
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

router.delete('/rooms/:roomCode/queue/:queueItemId', async (req, res) => {
  const { roomCode, queueItemId } = req.params;

  try {
    const queue = await removeFromQueue(roomCode, parseInt(queueItemId));
    res.json({ queue });
  } catch (error) {
    console.error('Remove from queue error:', error);
    res.status(500).json({ error: 'Failed to remove from queue' });
  }
});

// Search routes
router.get('/search', async (req, res) => {
  const { q, userId } = req.query;

  if (!q || !userId) {
    return res.status(400).json({ error: 'q and userId required' });
  }

  try {
    const accessToken = await getValidAccessToken(userId);
    const results = await searchTracks(accessToken, q);
    res.json({ results });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search' });
  }
});

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;
