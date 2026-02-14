import { Router } from 'express';

const router = Router();

// POST /api/sessions
router.post('/', async (req, res) => {
  const { accessToken, refreshToken, expiresIn } = req.body;
  
  console.log('[Routes/Sessions] POST / - Create session:', {
    hasAccessToken: !!accessToken,
    tokenPreview: accessToken?.substring(0, 20) + '...',
    hasRefreshToken: !!refreshToken,
    expiresIn,
    timestamp: new Date().toISOString()
  });

  if (!accessToken) {
    console.error('[Routes/Sessions] Missing accessToken');
    return res.status(400).json({ error: 'accessToken required' });
  }

  try {
    const sessionStore = req.app.get('sessionStore');
    console.log('[Routes/Sessions] Creating session in database...');
    
    const session = await sessionStore.create(accessToken);
    console.log('[Routes/Sessions] ✅ Session created:', {
      sessionId: session.id,
      joinCode: session.joinCode
    });
    
    if (refreshToken) {
      const expiry = Date.now() + (expiresIn || 3600) * 1000;
      console.log('[Routes/Sessions] Updating session with refresh token...', {
        expiresAt: new Date(expiry).toISOString()
      });
      
      await sessionStore.update(session.id, {
        hostRefreshToken: refreshToken,
        hostTokenExpiry: expiry,
      });
      
      console.log('[Routes/Sessions] ✅ Refresh token stored');
    }

    res.json({
      sessionId: session.id,
      joinCode: session.joinCode,
    });
  } catch (err) {
    console.error('[Routes/Sessions] ❌ Create session error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// GET /api/sessions/join/:code
router.get('/join/:code', async (req, res) => {
  const { code } = req.params;
  
  console.log('[Routes/Sessions] GET /join/:code:', {
    code,
    timestamp: new Date().toISOString()
  });

  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.getByJoinCode(code);
    
    if (!session) {
      console.error('[Routes/Sessions] Session not found for code:', code);
      return res.status(404).json({ error: 'Session not found' });
    }

    console.log('[Routes/Sessions] ✅ Session found:', {
      sessionId: session.id,
      joinCode: session.joinCode,
      participants: session.participants.length,
      queueLength: session.queue.length
    });

    res.json({
      sessionId: session.id,
      joinCode: session.joinCode,
      participantCount: session.participants.length,
      queueLength: session.queue.length,
      nowPlaying: session.nowPlaying,
    });
  } catch (err) {
    console.error('[Routes/Sessions] ❌ Join session error:', err);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// GET /api/sessions/:id
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  
  console.log('[Routes/Sessions] GET /:id:', {
    sessionId: id,
    timestamp: new Date().toISOString()
  });

  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.getById(id);
    
    if (!session) {
      console.error('[Routes/Sessions] Session not found:', id);
      return res.status(404).json({ error: 'Session not found' });
    }

    console.log('[Routes/Sessions] ✅ Session retrieved:', {
      sessionId: session.id,
      joinCode: session.joinCode,
      queueLength: session.queue.length,
      participants: session.participants.length
    });

    res.json({
      sessionId: session.id,
      joinCode: session.joinCode,
      queue: session.queue,
      nowPlaying: session.nowPlaying,
      participants: session.participants.map(p => ({ name: p.name, joinedAt: p.joinedAt })),
    });
  } catch (err) {
    console.error('[Routes/Sessions] ❌ Get session error:', err);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// DELETE /api/sessions/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  console.log('[Routes/Sessions] DELETE /:id:', {
    sessionId: id,
    timestamp: new Date().toISOString()
  });

  try {
    const sessionStore = req.app.get('sessionStore');
    const session = await sessionStore.getById(id);
    
    if (!session) {
      console.error('[Routes/Sessions] Session not found:', id);
      return res.status(404).json({ error: 'Session not found' });
    }

    const io = req.app.get('io');
    console.log('[Routes/Sessions] Notifying participants of session end...');
    io.to(session.id).emit('session:ended', { reason: 'Host ended the session' });
    
    console.log('[Routes/Sessions] Deleting session from database...');
    await sessionStore.delete(id);
    
    console.log('[Routes/Sessions] ✅ Session deleted:', id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Routes/Sessions] ❌ Delete session error:', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;
