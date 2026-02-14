import { spotifyPut, spotifyPost, getValidToken } from '../utils/spotify.js';

// Track which socket is the host for each room
const roomHosts = new Map(); // roomId -> socketId

export function setupSocket(io, sessionStore) {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    let heartbeatInterval = null;

    // Join a session room
    socket.on('session:join', async ({ sessionId, name, isHost }) => {
      try {
        const session = await sessionStore.getById(sessionId);
        if (!session) {
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        socket.join(sessionId);
        socket.data.sessionId = sessionId;
        socket.data.isHost = isHost || false;
        socket.data.name = name || 'Anonymous';

        await sessionStore.addParticipant(sessionId, socket.id, name || 'Anonymous');

        // If this is the host, track it and start heartbeat
        if (isHost) {
          roomHosts.set(sessionId, socket.id);
          
          // Update heartbeat every 5 seconds
          heartbeatInterval = setInterval(async () => {
            try {
              await sessionStore.updateHeartbeat(sessionId);
            } catch (err) {
              console.error('Heartbeat update error:', err);
            }
          }, 5000);
        }

        // Send current state to the joiner
        const updatedSession = await sessionStore.getById(sessionId);
        socket.emit('session:state', {
          queue: updatedSession.queue,
          nowPlaying: updatedSession.nowPlaying,
          participants: updatedSession.participants.map(p => ({ 
            name: p.name, 
            joinedAt: p.joinedAt 
          })),
        });

        // Notify everyone
        io.to(sessionId).emit('session:participants', {
          participants: updatedSession.participants.map(p => ({ 
            name: p.name, 
            joinedAt: p.joinedAt 
          })),
        });

        console.log(`${name} ${isHost ? '(HOST)' : ''} joined session ${session.joinCode}`);
      } catch (err) {
        console.error('Session join error:', err);
        socket.emit('error', { message: 'Failed to join session' });
      }
    });

    // Add track to queue
    socket.on('queue:add', async ({ sessionId, track }) => {
      try {
        const session = await sessionStore.addToQueue(sessionId, track);
        if (!session) return;

        io.to(sessionId).emit('queue:updated', { queue: session.queue });
        console.log(`Track added to queue: ${track.name}`);
      } catch (err) {
        console.error('Queue add error:', err);
        socket.emit('error', { message: 'Failed to add track to queue' });
      }
    });

    // Remove track from queue (host only)
    socket.on('queue:remove', async ({ sessionId, queueId }) => {
      if (!socket.data.isHost) {
        socket.emit('error', { message: 'Only the host can remove tracks' });
        return;
      }
      try {
        const session = await sessionStore.removeFromQueue(sessionId, queueId);
        if (!session) return;

        io.to(sessionId).emit('queue:updated', { queue: session.queue });
      } catch (err) {
        console.error('Queue remove error:', err);
        socket.emit('error', { message: 'Failed to remove track' });
      }
    });

    // Host: transfer playback to Web SDK device
    socket.on('playback:transferDevice', async ({ sessionId, deviceId }) => {
      if (!socket.data.isHost) {
        socket.emit('error', { message: 'Only the host can transfer playback' });
        return;
      }

      try {
        const session = await sessionStore.getById(sessionId);
        if (!session) return;

        const token = await getValidToken(session, sessionStore);
        await spotifyPut('/me/player', token, { device_ids: [deviceId], play: false });
        await sessionStore.update(sessionId, { hostDeviceId: deviceId });

        console.log(`Playback transferred to device: ${deviceId}`);
        socket.emit('playback:deviceTransferred', { deviceId });
      } catch (err) {
        console.error('Transfer device error:', err);
        socket.emit('error', { message: 'Failed to transfer playback' });
      }
    });

    // Host: play a specific track or resume
    socket.on('playback:play', async ({ sessionId, uri, deviceId }) => {
      if (!socket.data.isHost) {
        socket.emit('error', { message: 'Only the host can control playback' });
        return;
      }

      try {
        const session = await sessionStore.getById(sessionId);
        if (!session) return;

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
            await sessionStore.update(sessionId, { nowPlaying: track });
          }
        }

        const updatedSession = await sessionStore.getById(sessionId);
        io.to(sessionId).emit('playback:state', {
          isPlaying: true,
          nowPlaying: updatedSession.nowPlaying,
        });
      } catch (err) {
        console.error('Play error:', err);
        socket.emit('error', { message: err.message });
      }
    });

    // Host: play next from queue
    socket.on('playback:next', async ({ sessionId, deviceId }) => {
      if (!socket.data.isHost) return;

      try {
        const session = await sessionStore.getById(sessionId);
        if (!session) return;

        const nextTrack = await sessionStore.popQueue(sessionId);
        if (!nextTrack) {
          socket.emit('error', { message: 'Queue is empty' });
          return;
        }

        const token = await getValidToken(session, sessionStore);
        const endpoint = deviceId
          ? `/me/player/play?device_id=${deviceId}`
          : '/me/player/play';

        await spotifyPut(endpoint, token, { uris: [nextTrack.uri] });
        await sessionStore.update(sessionId, { nowPlaying: nextTrack });

        const updatedSession = await sessionStore.getById(sessionId);
        io.to(sessionId).emit('playback:state', {
          isPlaying: true,
          nowPlaying: nextTrack,
        });
        io.to(sessionId).emit('queue:updated', { queue: updatedSession.queue });
      } catch (err) {
        console.error('Next error:', err);
        socket.emit('error', { message: err.message });
      }
    });

    // Host: pause
    socket.on('playback:pause', async ({ sessionId }) => {
      if (!socket.data.isHost) return;

      try {
        const session = await sessionStore.getById(sessionId);
        if (!session) return;

        const token = await getValidToken(session, sessionStore);
        await spotifyPut('/me/player/pause', token);

        io.to(sessionId).emit('playback:state', {
          isPlaying: false,
          nowPlaying: session.nowPlaying,
        });
      } catch (err) {
        console.error('Pause error:', err);
        socket.emit('error', { message: err.message });
      }
    });

    // Host: update token (after refresh on client side)
    socket.on('auth:updateToken', async ({ sessionId, accessToken, expiresIn }) => {
      if (!socket.data.isHost) return;
      try {
        await sessionStore.update(sessionId, {
          hostToken: accessToken,
          hostTokenExpiry: Date.now() + (expiresIn || 3600) * 1000,
        });
      } catch (err) {
        console.error('Update token error:', err);
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      const { sessionId, isHost } = socket.data;
      
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      if (sessionId) {
        try {
          // Remove participant from DB
          await sessionStore.removeParticipant(sessionId, socket.id);

          // If host disconnected, close the room
          if (isHost && roomHosts.get(sessionId) === socket.id) {
            console.log(`Host disconnected from session ${sessionId}, closing room`);
            
            roomHosts.delete(sessionId);
            await sessionStore.closeRoom(sessionId);
            
            // Broadcast to all members that room was closed
            io.to(sessionId).emit('session:ended', { 
              reason: 'Room closed: Host disconnected' 
            });
          } else {
            // Just notify participants update
            const session = await sessionStore.getById(sessionId);
            if (session) {
              io.to(sessionId).emit('session:participants', {
                participants: session.participants.map(p => ({ 
                  name: p.name, 
                  joinedAt: p.joinedAt 
                })),
              });
            }
          }
        } catch (err) {
          console.error('Disconnect handling error:', err);
        }
      }
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
}
