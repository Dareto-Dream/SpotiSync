import { Router } from 'express';

const router = Router();

// POST /api/sessions — host creates a new session
router.post('/', async (req, res) => {
  const { accessToken, refreshToken, expiresIn } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' });

  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.create(accessToken);
    
    if (refreshToken) {
      await sessionStore.update(session.id, {
        hostRefreshToken: refreshToken,
        hostTokenExpiry: Date.now() + (expiresIn || 3600) * 1000,
      });
    }

    res.json({
      sessionId: session.id,
      joinCode: session.joinCode,
    });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /api/sessions/join/:code — participant looks up session by join code
router.get('/join/:code', async (req, res) => {
  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.getByJoinCode(req.params.code);
    
    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.json({
      sessionId: session.id,
      joinCode: session.joinCode,
      participantCount: session.participants.length,
      queueLength: session.queue.length,
      nowPlaying: session.nowPlaying,
    });
  } catch (err) {
    console.error('Join session error:', err);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// GET /api/sessions/:id — get session state
router.get('/:id', async (req, res) => {
  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.getById(req.params.id);
    
    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.json({
      sessionId: session.id,
      joinCode: session.joinCode,
      queue: session.queue,
      nowPlaying: session.nowPlaying,
      participants: session.participants.map(p => ({ name: p.name, joinedAt: p.joinedAt })),
    });
  } catch (err) {
    console.error('Get session error:', err);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// DELETE /api/sessions/:id — host ends session
router.delete('/:id', async (req, res) => {
  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.getById(req.params.id);
    
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const io = req.app.get('io');
    io.to(session.id).emit('session:ended', { reason: 'Host ended the session' });
    
    await sessionStore.delete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete session error:', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;
