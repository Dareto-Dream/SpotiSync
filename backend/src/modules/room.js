import { customAlphabet } from 'nanoid';
import { query } from '../database/db.js';

const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// In-memory tracking for active connections
const activeRooms = new Map(); // roomCode -> { hostSocketId, memberSockets: Set }

export function initRoomCleanup() {
  const TIMEOUT = parseInt(process.env.ROOM_TIMEOUT) || 15000;
  
  setInterval(async () => {
    try {
      const result = await query(
        `UPDATE rooms
         SET is_active = false
         WHERE is_active = true
         AND last_heartbeat < NOW() - INTERVAL '${TIMEOUT} milliseconds'
         RETURNING room_code`,
        []
      );

      for (const row of result.rows) {
        console.log(`Room ${row.room_code} timed out, marking inactive`);
        activeRooms.delete(row.room_code);
      }
    } catch (error) {
      console.error('Error in room cleanup:', error);
    }
  }, 5000);
}

export async function createRoom(hostId, displayName) {
  const roomCode = nanoid();
  
  try {
    const result = await query(
      `INSERT INTO rooms (room_code, host_id, is_active, last_heartbeat)
       VALUES ($1, $2, true, CURRENT_TIMESTAMP)
       RETURNING id, room_code`,
      [roomCode, hostId]
    );

    const roomId = result.rows[0].id;

    await query(
      `INSERT INTO room_members (room_id, user_id, display_name, is_host)
       VALUES ($1, $2, $3, true)`,
      [roomId, hostId, displayName]
    );

    console.log(`Created room ${roomCode} for host ${hostId}`);
    
    return {
      roomId,
      roomCode,
      hostId
    };
  } catch (error) {
    console.error('Error creating room:', error);
    throw error;
  }
}

export async function getRoomByCode(roomCode) {
  try {
    const result = await query(
      `SELECT id, room_code, host_id, is_active, current_track_uri,
              current_track_position_ms, is_playing, device_id, last_heartbeat
       FROM rooms
       WHERE room_code = $1`,
      [roomCode]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error('Error getting room:', error);
    throw error;
  }
}

export async function updateRoomHeartbeat(roomCode) {
  try {
    await query(
      `UPDATE rooms
       SET last_heartbeat = CURRENT_TIMESTAMP
       WHERE room_code = $1 AND is_active = true`,
      [roomCode]
    );
  } catch (error) {
    console.error('Error updating heartbeat:', error);
  }
}

export async function joinRoom(roomCode, userId, displayName) {
  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      throw new Error('Room not found');
    }

    if (!room.is_active) {
      throw new Error('Room is not active');
    }

    // Add member to room
    await query(
      `INSERT INTO room_members (room_id, user_id, display_name, is_host)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [room.id, userId, displayName]
    );

    // Get all members
    const membersResult = await query(
      `SELECT user_id, display_name, is_host, joined_at
       FROM room_members
       WHERE room_id = $1
       ORDER BY joined_at`,
      [room.id]
    );

    return {
      room,
      members: membersResult.rows
    };
  } catch (error) {
    console.error('Error joining room:', error);
    throw error;
  }
}

export async function leaveRoom(roomCode, userId) {
  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      return;
    }

    await query(
      `DELETE FROM room_members
       WHERE room_id = $1 AND user_id = $2`,
      [room.id, userId]
    );

    // Check if user was host
    if (room.host_id === userId) {
      await closeRoom(roomCode);
    }
  } catch (error) {
    console.error('Error leaving room:', error);
  }
}

export async function closeRoom(roomCode) {
  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      return;
    }

    // Mark room as inactive
    await query(
      `UPDATE rooms
       SET is_active = false
       WHERE room_code = $1`,
      [roomCode]
    );

    // Remove all members
    await query(
      `DELETE FROM room_members
       WHERE room_id = $1`,
      [room.id]
    );

    // Clear queue
    await query(
      `DELETE FROM queue_items
       WHERE room_id = $1`,
      [room.id]
    );

    console.log(`Closed room ${roomCode}`);
    activeRooms.delete(roomCode);
  } catch (error) {
    console.error('Error closing room:', error);
  }
}

export async function getRoomMembers(roomCode) {
  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      return [];
    }

    const result = await query(
      `SELECT user_id, display_name, is_host, joined_at
       FROM room_members
       WHERE room_id = $1
       ORDER BY joined_at`,
      [room.id]
    );

    return result.rows;
  } catch (error) {
    console.error('Error getting room members:', error);
    return [];
  }
}

export async function updateRoomPlaybackState(roomCode, state) {
  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      return;
    }

    await query(
      `UPDATE rooms
       SET current_track_uri = $1,
           current_track_position_ms = $2,
           is_playing = $3,
           device_id = $4
       WHERE room_code = $5`,
      [
        state.trackUri || null,
        state.positionMs || 0,
        state.isPlaying || false,
        state.deviceId || null,
        roomCode
      ]
    );
  } catch (error) {
    console.error('Error updating playback state:', error);
  }
}

export function registerRoomSocket(roomCode, socketId, isHost) {
  if (!activeRooms.has(roomCode)) {
    activeRooms.set(roomCode, {
      hostSocketId: null,
      memberSockets: new Set()
    });
  }

  const room = activeRooms.get(roomCode);
  
  if (isHost) {
    room.hostSocketId = socketId;
  } else {
    room.memberSockets.add(socketId);
  }
}

export function unregisterRoomSocket(roomCode, socketId) {
  if (!activeRooms.has(roomCode)) {
    return null;
  }

  const room = activeRooms.get(roomCode);
  
  if (room.hostSocketId === socketId) {
    room.hostSocketId = null;
    return 'host';
  } else if (room.memberSockets.has(socketId)) {
    room.memberSockets.delete(socketId);
    return 'member';
  }
  
  return null;
}

export function getRoomSockets(roomCode) {
  if (!activeRooms.has(roomCode)) {
    return { hostSocketId: null, memberSockets: [] };
  }

  const room = activeRooms.get(roomCode);
  return {
    hostSocketId: room.hostSocketId,
    memberSockets: Array.from(room.memberSockets)
  };
}
