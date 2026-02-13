import { Router } from 'express';
import { sessionStore } from '../store/sessions.js';

const router = Router();

// POST /api/sessions — host creates a new session
router.post('/', (req, res) => {
  const { accessToken, refreshToken, expiresIn } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'accessToken required' });

  const session = sessionStore.create(accessToken);
  if (refreshToken) {
    sessionStore.update(session.id, {
      hostRefreshToken: refreshToken,
      hostTokenExpiry: Date.now() + (expiresIn || 3600) * 1000,
    });
  }

  res.json({
    sessionId: session.id,
    joinCode: session.joinCode,
  });
});

// GET /api/sessions/join/:code — participant looks up session by join code
router.get('/join/:code', (req, res) => {
  const session = sessionStore.getByJoinCode(req.params.code);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    sessionId: session.id,
    joinCode: session.joinCode,
    participantCount: session.participants.length,
    queueLength: session.queue.length,
    nowPlaying: session.nowPlaying,
  });
});

// GET /api/sessions/:id — get session state
router.get('/:id', (req, res) => {
  const session = sessionStore.getById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    sessionId: session.id,
    joinCode: session.joinCode,
    queue: session.queue,
    nowPlaying: session.nowPlaying,
    participants: session.participants.map(p => ({ name: p.name, joinedAt: p.joinedAt })),
  });
});

// DELETE /api/sessions/:id — host ends session
router.delete('/:id', (req, res) => {
  const session = sessionStore.getById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const io = req.app.get('io');
  io.to(session.id).emit('session:ended');
  sessionStore.delete(req.params.id);
  res.json({ ok: true });
});

export default router;
