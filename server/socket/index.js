import { sessionStore } from '../store/sessions.js';
import { spotifyPut, spotifyPost, getValidToken } from '../utils/spotify.js';

export function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Join a session room
    socket.on('session:join', ({ sessionId, name, isHost }) => {
      const session = sessionStore.getById(sessionId);
      if (!session) {
        socket.emit('error', { message: 'Session not found' });
        return;
      }

      socket.join(sessionId);
      socket.data.sessionId = sessionId;
      socket.data.isHost = isHost || false;
      socket.data.name = name || 'Anonymous';

      sessionStore.addParticipant(sessionId, socket.id, name || 'Anonymous');

      // Send current state to the joiner
      socket.emit('session:state', {
        queue: session.queue,
        nowPlaying: session.nowPlaying,
        participants: session.participants.map(p => ({ name: p.name, joinedAt: p.joinedAt })),
      });

      // Notify everyone
      io.to(sessionId).emit('session:participants', {
        participants: session.participants.map(p => ({ name: p.name, joinedAt: p.joinedAt })),
      });

      console.log(`${name} joined session ${session.joinCode}`);
    });

    // Add track to queue
    socket.on('queue:add', ({ sessionId, track }) => {
      const session = sessionStore.addToQueue(sessionId, track);
      if (!session) return;

      io.to(sessionId).emit('queue:updated', { queue: session.queue });
      console.log(`Track added to queue: ${track.name}`);
    });

    // Remove track from queue (host only)
    socket.on('queue:remove', ({ sessionId, queueId }) => {
      if (!socket.data.isHost) {
        socket.emit('error', { message: 'Only the host can remove tracks' });
        return;
      }
      const session = sessionStore.removeFromQueue(sessionId, queueId);
      if (!session) return;

      io.to(sessionId).emit('queue:updated', { queue: session.queue });
    });

    // Host: play a specific track or resume
    socket.on('playback:play', async ({ sessionId, uri, deviceId }) => {
      if (!socket.data.isHost) {
        socket.emit('error', { message: 'Only the host can control playback' });
        return;
      }

      const session = sessionStore.getById(sessionId);
      if (!session) return;

      try {
        const token = await getValidToken(session, sessionStore);
        const endpoint = deviceId
          ? `/me/player/play?device_id=${deviceId}`
          : '/me/player/play';

        const body = uri ? { uris: [uri] } : undefined;
        await spotifyPut(endpoint, token, body);

        // Update now playing
        if (uri) {
          const track = session.queue.find(t => t.uri === uri);
          if (track) {
            sessionStore.update(sessionId, { nowPlaying: track });
          }
        }

        io.to(sessionId).emit('playback:state', {
          isPlaying: true,
          nowPlaying: session.nowPlaying,
        });
      } catch (err) {
        console.error('Play error:', err.message);
        socket.emit('error', { message: err.message });
      }
    });

    // Host: play next from queue
    socket.on('playback:next', async ({ sessionId, deviceId }) => {
      if (!socket.data.isHost) return;

      const session = sessionStore.getById(sessionId);
      if (!session) return;

      const nextTrack = sessionStore.popQueue(sessionId);
      if (!nextTrack) {
        socket.emit('error', { message: 'Queue is empty' });
        return;
      }

      try {
        const token = await getValidToken(session, sessionStore);
        const endpoint = deviceId
          ? `/me/player/play?device_id=${deviceId}`
          : '/me/player/play';

        await spotifyPut(endpoint, token, { uris: [nextTrack.uri] });
        sessionStore.update(sessionId, { nowPlaying: nextTrack });

        io.to(sessionId).emit('playback:state', {
          isPlaying: true,
          nowPlaying: nextTrack,
        });
        io.to(sessionId).emit('queue:updated', { queue: session.queue });
      } catch (err) {
        console.error('Next error:', err.message);
        socket.emit('error', { message: err.message });
      }
    });

    // Host: pause
    socket.on('playback:pause', async ({ sessionId }) => {
      if (!socket.data.isHost) return;

      const session = sessionStore.getById(sessionId);
      if (!session) return;

      try {
        const token = await getValidToken(session, sessionStore);
        await spotifyPut('/me/player/pause', token);

        io.to(sessionId).emit('playback:state', {
          isPlaying: false,
          nowPlaying: session.nowPlaying,
        });
      } catch (err) {
        console.error('Pause error:', err.message);
        socket.emit('error', { message: err.message });
      }
    });

    // Host: set device
    socket.on('playback:setDevice', async ({ sessionId, deviceId }) => {
      if (!socket.data.isHost) return;

      const session = sessionStore.getById(sessionId);
      if (!session) return;

      try {
        const token = await getValidToken(session, sessionStore);
        await spotifyPut('/me/player', token, { device_ids: [deviceId], play: false });
        sessionStore.update(sessionId, { hostDeviceId: deviceId });

        socket.emit('playback:deviceSet', { deviceId });
      } catch (err) {
        console.error('Set device error:', err.message);
        socket.emit('error', { message: err.message });
      }
    });

    // Host: update token (after refresh on client side)
    socket.on('auth:updateToken', ({ sessionId, accessToken, expiresIn }) => {
      if (!socket.data.isHost) return;
      sessionStore.update(sessionId, {
        hostToken: accessToken,
        hostTokenExpiry: Date.now() + (expiresIn || 3600) * 1000,
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      const { sessionId } = socket.data;
      if (sessionId) {
        const session = sessionStore.removeParticipant(sessionId, socket.id);
        if (session) {
          io.to(sessionId).emit('session:participants', {
            participants: session.participants.map(p => ({ name: p.name, joinedAt: p.joinedAt })),
          });
        }
      }
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
}
