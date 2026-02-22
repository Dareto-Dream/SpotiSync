const { verifyWsToken } = require('../auth/middleware');
const roomService = require('../rooms/service');
const playbackService = require('../playback/service');
const autoplayService = require('../playback/autoplay');
const votingService = require('../voting/service');
const { C2S, S2C } = require('./events');

/**
 * In-memory map of active WebSocket connections per room.
 * roomConnections: Map<roomId, Map<userId, WebSocket>>
 */
const roomConnections = new Map();
// Per-room autoplay feedback state: { trackId, likes:Set<userId>, dislikes:Set<userId> }
const feedbackState = new Map();

function getRoomClients(roomId) {
  return roomConnections.get(roomId) || new Map();
}

function broadcast(roomId, event, data, excludeUserId = null) {
  const clients = getRoomClients(roomId);
  const message = JSON.stringify({ event, data, ts: Date.now() });
  for (const [uid, ws] of clients) {
    if (uid === excludeUserId) continue;
    if (ws.readyState === 1) { // OPEN
      ws.send(message);
    }
  }
}

function sendTo(ws, event, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ event, data, ts: Date.now() }));
  }
}

function getFeedback(roomId) {
  const fb = feedbackState.get(roomId);
  if (!fb) {
    return { trackId: null, likes: new Set(), dislikes: new Set() };
  }
  return fb;
}

function resetFeedback(roomId, trackId = null) {
  feedbackState.set(roomId, {
    trackId,
    likes: new Set(),
    dislikes: new Set(),
  });
}

function emitFeedback(roomId, targetWs = null) {
  const fb = getFeedback(roomId);
  const payload = {
    trackId: fb.trackId,
    likes: [...fb.likes],
    dislikes: [...fb.dislikes],
  };
  if (targetWs) {
    sendTo(targetWs, S2C.FEEDBACK_UPDATE, payload);
  } else {
    broadcast(roomId, S2C.FEEDBACK_UPDATE, payload);
  }
}

function ensureFeedbackTrack(roomId, trackId) {
  const fb = getFeedback(roomId);
  if (fb.trackId !== trackId) {
    resetFeedback(roomId, trackId || null);
  }
}

function getActiveMemberCount(roomId) {
  return getRoomClients(roomId).size;
}

async function emitAutoplaySuggestions(roomId, settings, targetWs = null) {
  const payload = { suggestions: [] };
  if (!settings?.autoplayEnabled) {
    return targetWs
      ? sendTo(targetWs, S2C.AUTOPLAY_SUGGESTIONS, payload)
      : broadcast(roomId, S2C.AUTOPLAY_SUGGESTIONS, payload);
  }

  try {
    const suggestions = await playbackService.getAutoplaySuggestions(roomId, settings, 10);
    payload.suggestions = suggestions;
  } catch (err) {
    console.error('[WS] Failed to build autoplay suggestions:', err.message);
  }

  if (targetWs) {
    sendTo(targetWs, S2C.AUTOPLAY_SUGGESTIONS, payload);
  } else {
    broadcast(roomId, S2C.AUTOPLAY_SUGGESTIONS, payload);
  }
}

function setupWebSocket(wss) {
  wss.on('connection', async (ws, req) => {
    ws._userId = null;
    ws._username = null;
    ws._roomId = null;
    ws._isHost = false;
    ws._isAlive = true;

    const tryAuth = (candidate) => {
      const user = verifyWsToken(candidate);
      if (!user) return false;
      ws._userId = user.sub;
      ws._username = user.username;
      ws._isHost = false;
      sendTo(ws, S2C.CONNECTED, { userId: user.sub, username: user.username });
      return true;
    };

    // Require client-side auth message post-connection
    sendTo(ws, S2C.AUTH_REQUIRED, { message: 'Send auth event with token' });

    ws.on('pong', () => { ws._isAlive = true; });

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return sendTo(ws, S2C.ERROR, { code: 'INVALID_MSG', message: 'Invalid JSON' });
      }
      await handleMessage(ws, msg, tryAuth);
    });

    ws.on('close', () => handleDisconnect(ws));
    ws.on('error', (err) => console.error('[WS] Error for user', ws._userId, err.message));
  });

  // Ping/pong heartbeat to detect dead connections
  const pingInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws._isAlive) return ws.terminate();
      ws._isAlive = false;
      ws.ping();
    });
  }, 15000);

  wss.on('close', () => clearInterval(pingInterval));
}

async function handleMessage(ws, msg, tryAuth) {
  const { event, data = {} } = msg;

  if (!ws._userId && event !== C2S.AUTH) {
    return sendTo(ws, S2C.AUTH_REQUIRED, { message: 'Authenticate first with { event: "auth", data: { token } }' });
  }

  if (event === C2S.AUTH) {
    if (ws._userId) return sendTo(ws, S2C.ERROR, { code: 'ALREADY_AUTH', message: 'Already authenticated' });
    if (!data?.token) return sendTo(ws, S2C.ERROR, { code: 'MISSING_TOKEN', message: 'Token required' });
    const ok = tryAuth(data.token);
    if (!ok) {
      sendTo(ws, S2C.ERROR, { code: 'AUTH_FAILED', message: 'Invalid or expired token' });
      return ws.close(4001, 'Unauthorized');
    }
    return;
  }

  const userId = ws._userId;
  const username = ws._username;

  try {
    switch (event) {
      case C2S.JOIN_ROOM:
        await handleJoinRoom(ws, data);
        break;

      case C2S.LEAVE_ROOM:
        await handleLeaveRoom(ws);
        break;

      case C2S.HOST_HEARTBEAT:
        if (ws._roomId) await roomService.updateHeartbeat(ws._roomId);
        break;

      case C2S.PLAY:
        await handlePlay(ws);
        break;

      case C2S.PAUSE:
        await handlePause(ws, data);
        break;

      case C2S.SEEK:
        await handleSeek(ws, data);
        break;

      case C2S.SKIP:
        await handleSkip(ws, data);
        break;

      case C2S.PREV:
        await handlePrev(ws, data);
        break;

      case C2S.POSITION_REPORT:
        // Client reports its current position for drift analysis
        // For now, just log; advanced drift correction can be added
        break;

      case C2S.QUEUE_ADD:
        await handleQueueAdd(ws, data);
        break;

      case C2S.QUEUE_REMOVE:
        await handleQueueRemove(ws, data);
        break;

      case C2S.QUEUE_REORDER:
        await handleQueueReorder(ws, data);
        break;

      case C2S.QUEUE_PLAY_NOW:
        await handleQueuePlayNow(ws, data);
        break;

      case C2S.VOTE:
        await handleVote(ws, data);
        break;

      case C2S.FEEDBACK:
        await handleFeedback(ws, data);
        break;

      case C2S.UPDATE_SETTINGS:
        await handleUpdateSettings(ws, data);
        break;

      default:
        sendTo(ws, S2C.ERROR, { code: 'UNKNOWN_EVENT', message: `Unknown event: ${event}` });
    }
  } catch (err) {
    console.error('[WS] Handler error:', err.message);
    sendTo(ws, S2C.ERROR, { code: 'SERVER_ERROR', message: err.message });
  }
}

async function handleJoinRoom(ws, { code }) {
  if (!code) return sendTo(ws, S2C.ERROR, { code: 'MISSING_CODE', message: 'Room code required' });

  const room = await roomService.getRoomByCode(code);
  if (!room) return sendTo(ws, S2C.ERROR, { code: 'ROOM_NOT_FOUND', message: 'Room not found or inactive' });

  const userId = ws._userId;

  // Register in DB
  await roomService.joinRoom(room.id, userId);

  // Register in memory
  if (!roomConnections.has(room.id)) roomConnections.set(room.id, new Map());
  roomConnections.get(room.id).set(userId, ws);

  ws._roomId = room.id;
  ws._isHost = room.host_id === userId;

  // Get full state for new member
  const playbackState = await playbackService.getState(room.id);
  const members = await roomService.getMembers(room.id);

  sendTo(ws, S2C.ROOM_STATE, {
    room: sanitizeRoom(room),
    playback: serializePlayback(playbackState),
    members,
    isHost: ws._isHost,
  });
  ensureFeedbackTrack(room.id, playbackState?.currentItem?.videoId || null);
  emitFeedback(room.id, ws);

  // Notify others
  broadcast(room.id, S2C.MEMBER_JOINED, {
    user: { id: userId, username: ws._username },
    memberCount: getActiveMemberCount(room.id),
  }, userId);

  await emitAutoplaySuggestions(room.id, room.settings);
}

async function handleLeaveRoom(ws) {
  if (!ws._roomId) return;
  await doLeave(ws, false);
}

async function handleDisconnect(ws) {
  if (!ws._roomId) return;
  await doLeave(ws, true);
}

async function doLeave(ws, isDrop) {
  const roomId = ws._roomId;
  const userId = ws._userId;
  const isHost = ws._isHost;

  // Remove from memory
  const clients = getRoomClients(roomId);
  clients.delete(userId);
  if (clients.size === 0) roomConnections.delete(roomId);

  await roomService.leaveRoom(roomId, userId);
  ws._roomId = null;

  if (isHost) {
    // Host left -> close room
    await roomService.closeRoom(roomId);
    playbackService.evictCache(roomId);
    votingService.evictRoom(roomId);
    broadcast(roomId, S2C.ROOM_CLOSED, {
      reason: isDrop ? 'Host disconnected' : 'Host closed the room',
    });
    roomConnections.delete(roomId);
    feedbackState.delete(roomId);
  } else {
    const fb = feedbackState.get(roomId);
    if (fb) {
      fb.likes.delete(userId);
      fb.dislikes.delete(userId);
      feedbackState.set(roomId, fb);
      emitFeedback(roomId);
    }
    broadcast(roomId, S2C.MEMBER_LEFT, {
      user: { id: userId, username: ws._username },
      memberCount: getActiveMemberCount(roomId),
    });
  }
}

async function handlePlay(ws) {
  if (!ws._isHost) {
    return sendTo(ws, S2C.ERROR, {
      code: 'FORBIDDEN',
      message: 'Only host can control playback. Use mute for local silence.',
    });
  }
  const state = await playbackService.play(ws._roomId);
  broadcast(ws._roomId, S2C.PLAYBACK_STATE, serializePlayback(state));
}

async function handlePause(ws, { positionMs }) {
  if (!ws._isHost) {
    return sendTo(ws, S2C.ERROR, {
      code: 'FORBIDDEN',
      message: 'Only host can pause. Use the mute button to silence locally.',
    });
  }
  const state = await playbackService.pause(ws._roomId, positionMs || 0);
  broadcast(ws._roomId, S2C.PLAYBACK_STATE, serializePlayback(state));
}

async function handleSeek(ws, { positionMs }) {
  if (!ws._isHost) return sendTo(ws, S2C.ERROR, { code: 'FORBIDDEN', message: 'Only host can seek' });
  const state = await playbackService.seek(ws._roomId, positionMs || 0);
  broadcast(ws._roomId, S2C.PLAYBACK_SEEK, serializePlayback(state));
}

async function handleSkip(ws, data) {
  const room = await roomService.getRoomById(ws._roomId);
  if (!room) return;

  if (ws._isHost || room.settings.userSkipMode === 'instant') {
    await doSkip(ws._roomId, room.settings);
  } else {
    await handleVote(ws, { action: 'skip', trackId: room.settings.currentTrackId || data.trackId });
  }
}

async function handlePrev(ws, data) {
  const room = await roomService.getRoomById(ws._roomId);
  if (!room) return;

  if (ws._isHost || room.settings.userPrevMode === 'instant') {
    // "prev" in queue context: restart current track
    const state = await playbackService.seek(ws._roomId, 0);
    broadcast(ws._roomId, S2C.PLAYBACK_SEEK, serializePlayback(state));
  } else {
    await handleVote(ws, { action: 'prev', trackId: data.trackId });
  }
}

async function doSkip(roomId, settings = {}) {
  votingService.resetVotes(roomId);

  const before = await playbackService.getState(roomId);
  if (before?.currentItem?.videoId) {
    const durationMs = Number(before.currentItem.durationMs || 0);
    const progress = durationMs > 0 ? before.positionMs / durationMs : 1;
    const weight = progress < 0.35 ? 0.35 : 1;
    await playbackService.learnTaste(roomId, before.currentItem, { weight });
  }

  let state = await playbackService.skipToNext(roomId);
  if (!state) return;

  if (!state?.currentItem && settings?.autoplayEnabled) {
    const nextTrack = await autoplayService.findAutoplayTrack({
      state: before,
      settings,
    });
    if (nextTrack) {
      await playbackService.learnTaste(roomId, nextTrack, { weight: 0.8, isAutoplay: true });
      state = await playbackService.setCurrentItem(roomId, nextTrack, 0);
    }
  }

  ensureFeedbackTrack(roomId, state?.currentItem?.videoId || null);
  emitFeedback(roomId);

  broadcast(roomId, S2C.NOW_PLAYING, serializePlayback(state));
  broadcast(roomId, S2C.QUEUE_UPDATED, { queue: state.queue });
  await emitAutoplaySuggestions(roomId, settings);
}

async function handleVote(ws, { action, trackId }) {
  const roomId = ws._roomId;
  if (!roomId) return;

  const room = await roomService.getRoomById(roomId);
  if (!room) return;

  const settings = room.settings;

  try {
    const voteCount = await votingService.castVote(
      roomId, ws._userId, action, trackId, settings.voteCooldownSec
    );

    const memberCount = getActiveMemberCount(roomId);
    const passed = votingService.checkThreshold(roomId, action, memberCount, settings.voteThreshold);

    broadcast(roomId, S2C.VOTE_UPDATE, {
      action,
      trackId,
      voteCount,
      memberCount,
      threshold: settings.voteThreshold,
      passed,
    });

    if (passed) {
      broadcast(roomId, S2C.VOTE_PASSED, { action, trackId });
      if (action === 'skip') {
        await doSkip(roomId, settings);
      } else if (action === 'prev') {
        const state = await playbackService.seek(roomId, 0);
        broadcast(roomId, S2C.PLAYBACK_SEEK, serializePlayback(state));
        votingService.resetVotes(roomId);
      }
    }
  } catch (err) {
    sendTo(ws, S2C.ERROR, { code: 'VOTE_ERROR', message: err.message });
  }
}

async function handleFeedback(ws, { trackId, value }) {
  const roomId = ws._roomId;
  if (!roomId || !trackId) return;

  const state = await playbackService.getState(roomId);
  if (!state?.currentItem || state.currentItem.videoId !== trackId) {
    return sendTo(ws, S2C.ERROR, { code: 'INVALID_FEEDBACK', message: 'Feedback must target the current track.' });
  }

  const normalized = value === 'approve' ? 'approve' : value === 'disapprove' ? 'disapprove' : null;
  if (!normalized) {
    return sendTo(ws, S2C.ERROR, { code: 'INVALID_FEEDBACK', message: 'Value must be approve or disapprove.' });
  }

  ensureFeedbackTrack(roomId, trackId);
  const fb = getFeedback(roomId);

  const prevStatus = fb.likes.has(ws._userId)
    ? 'approve'
    : fb.dislikes.has(ws._userId)
      ? 'disapprove'
      : 'neutral';

  let nextStatus = prevStatus;
  if (normalized === 'approve') {
    if (prevStatus === 'approve') {
      fb.likes.delete(ws._userId);
      nextStatus = 'neutral';
    } else {
      fb.likes.add(ws._userId);
      fb.dislikes.delete(ws._userId);
      nextStatus = 'approve';
    }
  } else if (normalized === 'disapprove') {
    if (prevStatus === 'disapprove') {
      fb.dislikes.delete(ws._userId);
      nextStatus = 'neutral';
    } else {
      fb.dislikes.add(ws._userId);
      fb.likes.delete(ws._userId);
      nextStatus = 'disapprove';
    }
  }

  feedbackState.set(roomId, fb);
  emitFeedback(roomId);

  const weightMap = { approve: 1, disapprove: -1, neutral: 0 };
  const delta = weightMap[nextStatus] - weightMap[prevStatus];
  if (delta !== 0) {
    const weight = delta * 1.6; // stronger nudge than passive listening
    await playbackService.learnTaste(roomId, state.currentItem, { weight });
  }
}

async function handleQueueAdd(ws, { item }) {
  const roomId = ws._roomId;
  const room = await roomService.getRoomById(roomId);
  if (!room) return;

  if (!ws._isHost && !room.settings.userQueueing) {
    return sendTo(ws, S2C.ERROR, { code: 'FORBIDDEN', message: 'Queueing is disabled for this room' });
  }

  if (!item || !item.videoId) {
    return sendTo(ws, S2C.ERROR, { code: 'INVALID', message: 'Invalid track item' });
  }

  await playbackService.learnTaste(roomId, item, { weight: 1.2 });

  const state = await playbackService.getState(roomId);

  // If nothing is playing, start playing immediately
  if (!state.currentItem) {
    const newState = await playbackService.setCurrentItem(roomId, item, 0);
    ensureFeedbackTrack(roomId, item.videoId);
    emitFeedback(roomId);
    broadcast(roomId, S2C.NOW_PLAYING, serializePlayback(newState));
  } else {
    const newState = await playbackService.addToQueue(roomId, item);
    broadcast(roomId, S2C.QUEUE_UPDATED, { queue: newState.queue });
  }

  await emitAutoplaySuggestions(roomId, room.settings);
}

async function handleQueueRemove(ws, { index }) {
  const roomId = ws._roomId;
  const room = await roomService.getRoomById(roomId);
  if (!room) return;

  if (!ws._isHost && !room.settings.userRemoval) {
    return sendTo(ws, S2C.ERROR, { code: 'FORBIDDEN', message: 'Queue removal is disabled' });
  }

  const newState = await playbackService.removeFromQueue(roomId, index);
  if (newState) {
    broadcast(roomId, S2C.QUEUE_UPDATED, { queue: newState.queue });
    await emitAutoplaySuggestions(roomId, room.settings);
  }
}

async function handleQueueReorder(ws, { fromIndex, toIndex }) {
  const roomId = ws._roomId;
  const room = await roomService.getRoomById(roomId);
  if (!room) return;

  if (!ws._isHost && !room.settings.userReordering) {
    return sendTo(ws, S2C.ERROR, { code: 'FORBIDDEN', message: 'Queue reordering is disabled' });
  }

  const newState = await playbackService.reorderQueue(roomId, fromIndex, toIndex);
  if (newState) {
    broadcast(roomId, S2C.QUEUE_UPDATED, { queue: newState.queue });
    await emitAutoplaySuggestions(roomId, room.settings);
  }
}

async function handleQueuePlayNow(ws, { index }) {
  if (!ws._isHost) return sendTo(ws, S2C.ERROR, { code: 'FORBIDDEN', message: 'Host only' });
  const roomId = ws._roomId;
  const state = await playbackService.getState(roomId);
  if (!state || !state.queue[index]) return;

  const item = state.queue[index];
  const newQueue = state.queue.filter((_, i) => i !== index);
  const newState = await playbackService.setState(roomId, {
    currentItem: item,
    queue: newQueue,
    positionMs: 0,
    isPlaying: true,
  });
  await playbackService.learnTaste(roomId, item, { weight: 1 });
  votingService.resetVotes(roomId);
  ensureFeedbackTrack(roomId, item.videoId);
  emitFeedback(roomId);
  broadcast(roomId, S2C.NOW_PLAYING, serializePlayback(newState));
  broadcast(roomId, S2C.QUEUE_UPDATED, { queue: newState.queue });
  await emitAutoplaySuggestions(roomId, room.settings);
}

async function handleUpdateSettings(ws, { settings }) {
  if (!ws._isHost) {
    return sendTo(ws, S2C.ERROR, { code: 'FORBIDDEN', message: 'Only host can change settings' });
  }
  await roomService.updateSettings(ws._roomId, settings);
  const room = await roomService.getRoomById(ws._roomId);

  // If skip/prev mode changed, reset votes to avoid stale thresholds
  if (settings.userSkipMode || settings.userPrevMode || settings.voteThreshold) {
    votingService.resetVotes(ws._roomId);
  }

  broadcast(ws._roomId, S2C.SETTINGS_UPDATED, { settings: room.settings });
  await emitAutoplaySuggestions(ws._roomId, room.settings);
}

// Serializers
function serializePlayback(state) {
  if (!state) return null;
  return {
    currentItem: state.currentItem,
    positionMs: playbackService.getLivePosition(state),
    serverTime: state.serverTime,
    isPlaying: state.isPlaying,
    queue: state.queue,
  };
}

function sanitizeRoom(room) {
  return {
    id: room.id,
    joinCode: room.join_code,
    hostId: room.host_id,
    hostUsername: room.host_username,
    isActive: room.is_active,
    settings: room.settings,
  };
}

module.exports = { setupWebSocket, broadcast, getRoomClients };
