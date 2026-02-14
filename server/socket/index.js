import { spotifyPut, spotifyPost, getValidToken } from '../utils/spotify.js';

// Track which socket is the host for each room
const roomHosts = new Map();

export function setupSocket(io, sessionStore) {
  console.log('[Socket] Socket.IO handler initialized');

  io.on('connection', (socket) => {
    console.log(`[Socket] ✅ Client connected: ${socket.id}`);

    let heartbeatInterval = null;

    // Join session
    socket.on('session:join', async ({ sessionId, name, isHost }) => {
      console.log(`[Socket] session:join received:`, {
        socketId: socket.id,
        sessionId,
        name,
        isHost,
        timestamp: new Date().toISOString()
      });

      try {
        const session = await sessionStore.getById(sessionId);
        if (!session) {
          console.error(`[Socket] Session not found: ${sessionId}`);
          socket.emit('error', { message: 'Session not found' });
          return;
        }

        console.log(`[Socket] Session found, joining room...`);
        socket.join(sessionId);
        socket.data.sessionId = sessionId;
        socket.data.isHost = isHost || false;
        socket.data.name = name || 'Anonymous';

        await sessionStore.addParticipant(sessionId, socket.id, name || 'Anonymous');
        console.log(`[Socket] Participant added to database`);

        // Track host
        if (isHost) {
          roomHosts.set(sessionId, socket.id);
          console.log(`[Socket] 🎤 Host registered for room ${sessionId}`);
          
          // Start heartbeat
          heartbeatInterval = setInterval(async () => {
            try {
              await sessionStore.updateHeartbeat(sessionId);
              console.log(`[Socket] ❤️ Heartbeat updated for ${sessionId}`);
            } catch (err) {
              console.error('[Socket] Heartbeat update error:', err);
            }
          }, 5000);
        }

        // Send current state
        const updatedSession = await sessionStore.getById(sessionId);
        socket.emit('session:state', {
          queue: updatedSession.queue,
          nowPlaying: updatedSession.nowPlaying,
          participants: updatedSession.participants.map(p => ({ 
            name: p.name, 
            joinedAt: p.joinedAt 
          })),
        });

        console.log(`[Socket] Sent session:state to ${socket.id}`);

        // Notify everyone
        io.to(sessionId).emit('session:participants', {
          participants: updatedSession.participants.map(p => ({ 
            name: p.name, 
            joinedAt: p.joinedAt 
          })),
        });

        console.log(`[Socket] ✅ ${name} ${isHost ? '(HOST)' : ''} joined ${sessionId}`);
      } catch (err) {
        console.error('[Socket] Session join error:', err);
        socket.emit('error', { message: 'Failed to join session' });
      }
    });

    // Add track to queue
    socket.on('queue:add', async ({ sessionId, track }) => {
      console.log(`[Socket] queue:add received:`, { sessionId, track: track.name });

      try {
        const session = await sessionStore.addToQueue(sessionId, track);
        if (!session) return;

        io.to(sessionId).emit('queue:updated', { queue: session.queue });
        console.log(`[Socket] ✅ Track added: ${track.name}`);
      } catch (err) {
        console.error('[Socket] Queue add error:', err);
        socket.emit('error', { message: 'Failed to add track' });
      }
    });

    // Remove track from queue
    socket.on('queue:remove', async ({ sessionId, queueId }) => {
      console.log(`[Socket] queue:remove received:`, { sessionId, queueId });

      if (!socket.data.isHost) {
        console.warn('[Socket] Non-host tried to remove track');
        socket.emit('error', { message: 'Only host can remove tracks' });
        return;
      }

      try {
        const session = await sessionStore.removeFromQueue(sessionId, queueId);
        if (!session) return;

        io.to(sessionId).emit('queue:updated', { queue: session.queue });
        console.log(`[Socket] ✅ Track removed: ${queueId}`);
      } catch (err) {
        console.error('[Socket] Queue remove error:', err);
        socket.emit('error', { message: 'Failed to remove track' });
      }
    });

    // Transfer playback to device
    socket.on('playback:transferDevice', async ({ sessionId, deviceId }) => {
      console.log(`[Socket] 🎯 playback:transferDevice received:`, {
        socketId: socket.id,
        sessionId,
        deviceId,
        timestamp: new Date().toISOString()
      });

      try {
        const session = await sessionStore.getById(sessionId);
        if (!session) {
          console.error(`[Socket] Session ${sessionId} not found for device transfer`);
          return;
        }

        console.log(`[Socket] Session found, getting valid token...`);
        const token = await getValidToken(session, sessionStore);
        console.log(`[Socket] Token obtained, length: ${token?.length}, preview: ${token?.substring(0, 20)}...`);

        console.log(`[Socket] Calling Spotify API PUT /v1/me/player`);
        console.log(`[Socket] Request body:`, { device_ids: [deviceId], play: false });

        const result = await spotifyPut(
          '/v1/me/player',
          { device_ids: [deviceId], play: false },
          token
        );

        console.log(`[Socket] Spotify transfer API response:`, {
          status: result.status,
          statusText: result.statusText,
          ok: result.ok,
          timestamp: new Date().toISOString()
        });

        if (result.status >= 400) {
          const errorText = await result.text();
          console.error(`[Socket] Spotify API error response:`, errorText);
        }

        // Update session with device ID
        await sessionStore.update(sessionId, { hostDeviceId: deviceId });
        console.log(`[Socket] ✅ Device ${deviceId} registered for session ${sessionId}`);

        socket.emit('playback:deviceTransferred', { deviceId });
        console.log(`[Socket] Sent playback:deviceTransferred confirmation`);
      } catch (err) {
        console.error('[Socket] Device transfer error:', err);
        console.error('[Socket] Error stack:', err.stack);
        socket.emit('error', { message: 'Failed to transfer playback' });
      }
    });

    // Play track
    socket.on('playback:play', async ({ sessionId, uri }) => {
      console.log(`[Socket] playback:play received:`, {
        socketId: socket.id,
        sessionId,
        uri,
        timestamp: new Date().toISOString()
      });

      try {
        const session = await sessionStore.getById(sessionId);
        if (!session) {
          console.error(`[Socket] Session not found: ${sessionId}`);
          return;
        }

        const token = await getValidToken(session, sessionStore);
        console.log(`[Socket] Token obtained for play`);

        console.log(`[Socket] Calling Spotify API PUT /v1/me/player/play`);
        const result = await spotifyPut(
          '/v1/me/player/play',
          { uris: [uri] },
          token
        );

        console.log(`[Socket] Spotify play API response:`, {
          status: result.status,
          statusText: result.statusText
        });

        io.to(sessionId).emit('playback:state', { isPlaying: true });
        console.log(`[Socket] ✅ Playback started`);
      } catch (err) {
        console.error('[Socket] Playback play error:', err);
        socket.emit('error', { message: 'Failed to start playback' });
      }
    });

    // Next track
    socket.on('playback:next', async ({ sessionId }) => {
      console.log(`[Socket] playback:next received:`, { sessionId });

      try {
        const session = await sessionStore.getById(sessionId);
        if (!session || session.queue.length === 0) {
          console.warn('[Socket] No tracks in queue');
          return;
        }

        const token = await getValidToken(session, sessionStore);
        const nextTrack = session.queue[0];
        console.log(`[Socket] Playing next track: ${nextTrack.name}`);

        await spotifyPut('/v1/me/player/play', { uris: [nextTrack.uri] }, token);
        await sessionStore.popQueue(sessionId);

        const updated = await sessionStore.getById(sessionId);
        io.to(sessionId).emit('queue:updated', { queue: updated.queue });
        console.log(`[Socket] ✅ Next track playing`);
      } catch (err) {
        console.error('[Socket] Playback next error:', err);
        socket.emit('error', { message: 'Failed to skip track' });
      }
    });

    // Pause playback
    socket.on('playback:pause', async ({ sessionId }) => {
      console.log(`[Socket] playback:pause received:`, { sessionId });

      try {
        const session = await sessionStore.getById(sessionId);
        if (!session) return;

        const token = await getValidToken(session, sessionStore);
        await spotifyPut('/v1/me/player/pause', {}, token);

        io.to(sessionId).emit('playback:state', { isPlaying: false });
        console.log(`[Socket] ✅ Playback paused`);
      } catch (err) {
        console.error('[Socket] Playback pause error:', err);
        socket.emit('error', { message: 'Failed to pause' });
      }
    });

    // Update token
    socket.on('auth:updateToken', async ({ sessionId, accessToken, expiresIn }) => {
      console.log(`[Socket] auth:updateToken received:`, { sessionId, expiresIn });

      try {
        const expiry = Date.now() + (expiresIn * 1000);
        await sessionStore.update(sessionId, { 
          hostToken: accessToken,
          hostTokenExpiry: expiry
        });
        console.log(`[Socket] ✅ Token updated, expires at ${new Date(expiry).toISOString()}`);
      } catch (err) {
        console.error('[Socket] Token update error:', err);
      }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);

      // Clear heartbeat interval
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        console.log('[Socket] Heartbeat interval cleared');
      }

      const { sessionId, isHost, name } = socket.data;
      
      if (sessionId) {
        console.log(`[Socket] Cleaning up session ${sessionId} for ${name}`);

        try {
          await sessionStore.removeParticipant(sessionId, socket.id);

          // If host disconnected, close the room
          if (isHost && roomHosts.get(sessionId) === socket.id) {
            console.log(`[Socket] 🚨 Host disconnected, closing room ${sessionId}`);
            
            roomHosts.delete(sessionId);
            await sessionStore.closeRoom(sessionId);
            
            io.to(sessionId).emit('session:ended', { 
              reason: 'Room closed: Host disconnected' 
            });
            
            console.log(`[Socket] ✅ Room ${sessionId} closed and participants notified`);
          } else {
            // Just update participants
            const session = await sessionStore.getById(sessionId);
            if (session) {
              io.to(sessionId).emit('session:participants', {
                participants: session.participants.map(p => ({ 
                  name: p.name, 
                  joinedAt: p.joinedAt 
                })),
              });
              console.log(`[Socket] Participants list updated`);
            }
          }
        } catch (err) {
          console.error('[Socket] Disconnect handling error:', err);
        }
      }
    });
  });
}
