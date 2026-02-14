import { nanoid } from 'nanoid';

// In-memory store — replace with Redis/DB for production
const sessions = new Map();

function generateJoinCode() {
  // 6-char uppercase alphanumeric
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export const sessionStore = {
  create(hostToken) {
    const id = nanoid(12);
    const joinCode = generateJoinCode();
    const session = {
      id,
      joinCode,
      hostToken,          // Spotify access token of the host
      hostRefreshToken: null,
      hostTokenExpiry: null,
      hostDeviceId: null,
      queue: [],           // Array of track objects
      nowPlaying: null,
      participants: [],    // Array of { socketId, name }
      createdAt: Date.now(),
    };
    sessions.set(id, session);
    return session;
  },

  getById(id) {
    return sessions.get(id) || null;
  },

  getByJoinCode(code) {
    for (const session of sessions.values()) {
      if (session.joinCode === code.toUpperCase()) return session;
    }
    return null;
  },

  update(id, patch) {
    const session = sessions.get(id);
    if (!session) return null;
    Object.assign(session, patch);
    return session;
  },

  addParticipant(sessionId, socketId, name) {
    const session = sessions.get(sessionId);
    if (!session) return null;
    // Don't add duplicates
    if (!session.participants.find(p => p.socketId === socketId)) {
      session.participants.push({ socketId, name, joinedAt: Date.now() });
    }
    return session;
  },

  removeParticipant(sessionId, socketId) {
    const session = sessions.get(sessionId);
    if (!session) return null;
    session.participants = session.participants.filter(p => p.socketId !== socketId);
    return session;
  },

  addToQueue(sessionId, track) {
    const session = sessions.get(sessionId);
    if (!session) return null;
    session.queue.push({ ...track, addedAt: Date.now(), queueId: nanoid(8) });
    return session;
  },

  removeFromQueue(sessionId, queueId) {
    const session = sessions.get(sessionId);
    if (!session) return null;
    session.queue = session.queue.filter(t => t.queueId !== queueId);
    return session;
  },

  popQueue(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.queue.length === 0) return null;
    return session.queue.shift();
  },

  delete(id) {
    sessions.delete(id);
  },

  // Clean up stale sessions (older than 4 hours)
  cleanup() {
    const MAX_AGE = 4 * 60 * 60 * 1000;
    for (const [id, session] of sessions) {
      if (Date.now() - session.createdAt > MAX_AGE) sessions.delete(id);
    }
  }
};

// Run cleanup every 30 minutes
setInterval(() => sessionStore.cleanup(), 30 * 60 * 1000);
