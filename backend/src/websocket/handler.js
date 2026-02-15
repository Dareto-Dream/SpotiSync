import { WebSocketServer } from 'ws';
import {
  getRoomByCode,
  updateRoomHeartbeat,
  leaveRoom,
  closeRoom,
  registerRoomSocket,
  unregisterRoomSocket,
  getRoomSockets,
  getRoomMembers,
  updateRoomPlaybackState
} from './modules/room.js';
import {
  addToQueue,
  getQueue,
  removeFromQueue,
  searchTracks,
  transferPlayback,
  play,
  pause,
  skipToNext,
  skipToPrevious,
  seek,
  getCurrentPlayback
} from './modules/playback.js';
import { getValidAccessToken } from './modules/auth.js';

const clients = new Map(); // socketId -> { ws, userId, roomCode, isHost }

export function initWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const socketId = generateSocketId();
    console.log(`WebSocket connected: ${socketId}`);

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(socketId, ws, message);
      } catch (error) {
        console.error('WebSocket message error:', error);
        sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      handleDisconnect(socketId);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  // Heartbeat checker
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  console.log('WebSocket server initialized');
  return wss;
}

async function handleMessage(socketId, ws, message) {
  const { type, payload } = message;

  switch (type) {
    case 'join_room':
      await handleJoinRoom(socketId, ws, payload);
      break;

    case 'leave_room':
      await handleLeaveRoom(socketId);
      break;

    case 'heartbeat':
      await handleHeartbeat(socketId, payload);
      break;

    case 'search_tracks':
      await handleSearchTracks(socketId, ws, payload);
      break;

    case 'add_to_queue':
      await handleAddToQueue(socketId, payload);
      break;

    case 'remove_from_queue':
      await handleRemoveFromQueue(socketId, payload);
      break;

    case 'playback_control':
      await handlePlaybackControl(socketId, payload);
      break;

    case 'sync_playback':
      await handleSyncPlayback(socketId, payload);
      break;

    case 'transfer_device':
      await handleTransferDevice(socketId, payload);
      break;

    case 'request_token':
      await handleRequestToken(socketId, ws, payload);
      break;

    default:
      sendError(ws, `Unknown message type: ${type}`);
  }
}

async function handleJoinRoom(socketId, ws, payload) {
  const { roomCode, userId, displayName, isHost } = payload;

  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      return sendError(ws, 'Room not found');
    }

    if (!room.is_active) {
      return sendError(ws, 'Room is not active');
    }

    // Register client
    clients.set(socketId, {
      ws,
      userId,
      roomCode,
      isHost: isHost || false
    });

    // Register in room tracking
    registerRoomSocket(roomCode, socketId, isHost || false);

    // Get room members
    const members = await getRoomMembers(roomCode);
    const queue = await getQueue(roomCode);

    // Send join success
    send(ws, 'room_joined', {
      roomCode,
      room,
      members,
      queue
    });

    // Broadcast to room
    broadcastToRoom(roomCode, 'member_joined', {
      userId,
      displayName,
      isHost: isHost || false
    }, socketId);

    console.log(`${userId} joined room ${roomCode} as ${isHost ? 'host' : 'member'}`);
  } catch (error) {
    console.error('Error joining room:', error);
    sendError(ws, error.message);
  }
}

async function handleLeaveRoom(socketId) {
  const client = clients.get(socketId);
  
  if (!client) {
    return;
  }

  const { roomCode, userId, isHost } = client;

  try {
    await leaveRoom(roomCode, userId);
    
    const role = unregisterRoomSocket(roomCode, socketId);
    
    if (role === 'host') {
      // Host left, close room
      await closeRoom(roomCode);
      broadcastToRoom(roomCode, 'room_closed', {
        reason: 'Host disconnected'
      });
      
      // Disconnect all clients in room
      clients.forEach((c, sid) => {
        if (c.roomCode === roomCode) {
          c.ws.close();
          clients.delete(sid);
        }
      });
    } else {
      // Regular member left
      broadcastToRoom(roomCode, 'member_left', { userId });
    }

    clients.delete(socketId);
    console.log(`${userId} left room ${roomCode}`);
  } catch (error) {
    console.error('Error leaving room:', error);
  }
}

async function handleHeartbeat(socketId, payload) {
  const client = clients.get(socketId);
  
  if (!client || !client.isHost) {
    return;
  }

  const { roomCode } = client;
  await updateRoomHeartbeat(roomCode);
}

async function handleSearchTracks(socketId, ws, payload) {
  const client = clients.get(socketId);
  
  if (!client) {
    return sendError(ws, 'Not in a room');
  }

  const { query } = payload;
  const { userId } = client;

  try {
    const accessToken = await getValidAccessToken(userId);
    const results = await searchTracks(accessToken, query);
    
    send(ws, 'search_results', { results });
  } catch (error) {
    console.error('Error searching tracks:', error);
    sendError(ws, 'Failed to search tracks');
  }
}

async function handleAddToQueue(socketId, payload) {
  const client = clients.get(socketId);
  
  if (!client) {
    return;
  }

  const { roomCode, userId } = client;
  const { track } = payload;

  try {
    const queue = await addToQueue(roomCode, track, userId);
    
    broadcastToRoom(roomCode, 'queue_updated', { queue });
  } catch (error) {
    console.error('Error adding to queue:', error);
  }
}

async function handleRemoveFromQueue(socketId, payload) {
  const client = clients.get(socketId);
  
  if (!client) {
    return;
  }

  const { roomCode, isHost } = client;
  const { queueItemId } = payload;

  if (!isHost) {
    return sendError(client.ws, 'Only host can remove from queue');
  }

  try {
    const queue = await removeFromQueue(roomCode, queueItemId);
    
    broadcastToRoom(roomCode, 'queue_updated', { queue });
  } catch (error) {
    console.error('Error removing from queue:', error);
  }
}

async function handlePlaybackControl(socketId, payload) {
  const client = clients.get(socketId);
  
  if (!client || !client.isHost) {
    return sendError(client?.ws, 'Only host can control playback');
  }

  const { userId, roomCode } = client;
  const { action, deviceId, trackUri, positionMs } = payload;

  try {
    const accessToken = await getValidAccessToken(userId);

    switch (action) {
      case 'play':
        await play(accessToken, deviceId, trackUri, positionMs);
        break;
      case 'pause':
        await pause(accessToken, deviceId);
        break;
      case 'next':
        await skipToNext(accessToken, deviceId);
        break;
      case 'previous':
        await skipToPrevious(accessToken, deviceId);
        break;
      case 'seek':
        await seek(accessToken, positionMs, deviceId);
        break;
    }

    // Broadcast state change
    broadcastToRoom(roomCode, 'playback_changed', {
      action,
      deviceId,
      trackUri,
      positionMs
    });
  } catch (error) {
    console.error('Error controlling playback:', error);
    sendError(client.ws, 'Failed to control playback');
  }
}

async function handleSyncPlayback(socketId, payload) {
  const client = clients.get(socketId);
  
  if (!client || !client.isHost) {
    return;
  }

  const { roomCode } = client;
  const { state } = payload;

  try {
    await updateRoomPlaybackState(roomCode, state);
    
    // Broadcast to all members
    broadcastToRoom(roomCode, 'playback_state', state, socketId);
  } catch (error) {
    console.error('Error syncing playback:', error);
  }
}

async function handleTransferDevice(socketId, payload) {
  const client = clients.get(socketId);
  
  if (!client || !client.isHost) {
    return sendError(client?.ws, 'Only host can transfer device');
  }

  const { userId, roomCode } = client;
  const { deviceId } = payload;

  try {
    const accessToken = await getValidAccessToken(userId);
    await transferPlayback(accessToken, deviceId);
    
    send(client.ws, 'device_transferred', { deviceId });
    
    // Update room state
    await updateRoomPlaybackState(roomCode, { deviceId });
  } catch (error) {
    console.error('Error transferring device:', error);
    sendError(client.ws, 'Failed to transfer device');
  }
}

async function handleRequestToken(socketId, ws, payload) {
  const client = clients.get(socketId);
  
  if (!client) {
    return sendError(ws, 'Not connected');
  }

  const { userId } = client;

  try {
    const accessToken = await getValidAccessToken(userId);
    send(ws, 'token_response', { accessToken });
  } catch (error) {
    console.error('Error getting token:', error);
    sendError(ws, 'Failed to get access token');
  }
}

function handleDisconnect(socketId) {
  const client = clients.get(socketId);
  
  if (client) {
    handleLeaveRoom(socketId);
  }

  clients.delete(socketId);
  console.log(`WebSocket disconnected: ${socketId}`);
}

function send(ws, type, payload) {
  if (ws.readyState === 1) { // OPEN
    ws.send(JSON.stringify({ type, payload }));
  }
}

function sendError(ws, message) {
  send(ws, 'error', { message });
}

function broadcastToRoom(roomCode, type, payload, excludeSocketId = null) {
  clients.forEach((client, socketId) => {
    if (client.roomCode === roomCode && socketId !== excludeSocketId) {
      send(client.ws, type, payload);
    }
  });
}

function generateSocketId() {
  return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
