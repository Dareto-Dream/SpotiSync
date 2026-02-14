import { nanoid } from 'nanoid';
import { getPool } from '../db/index.js';

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export const sessionStore = {
  async create(hostToken) {
    const pool = getPool();
    const id = nanoid(12);
    const joinCode = generateJoinCode();
    const now = Date.now();

    await pool.query(
      `INSERT INTO rooms (id, join_code, host_token, created_at, last_heartbeat, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [id, joinCode, hostToken, now, now]
    );

    return {
      id,
      joinCode,
      hostToken,
      hostRefreshToken: null,
      hostTokenExpiry: null,
      hostDeviceId: null,
      queue: [],
      nowPlaying: null,
      participants: [],
      createdAt: now,
      lastHeartbeat: now,
      status: 'active',
    };
  },

  async getById(id) {
    const pool = getPool();
    const roomResult = await pool.query(
      'SELECT * FROM rooms WHERE id = $1 AND status = $2',
      [id, 'active']
    );

    if (roomResult.rows.length === 0) return null;

    const room = roomResult.rows[0];
    
    // Get queue
    const queueResult = await pool.query(
      'SELECT * FROM queue_items WHERE room_id = $1 ORDER BY position ASC',
      [id]
    );

    // Get participants
    const participantsResult = await pool.query(
      'SELECT socket_id, name, joined_at FROM room_members WHERE room_id = $1',
      [id]
    );

    return {
      id: room.id,
      joinCode: room.join_code,
      hostToken: room.host_token,
      hostRefreshToken: room.host_refresh_token,
      hostTokenExpiry: room.host_token_expiry,
      hostDeviceId: room.host_device_id,
      queue: queueResult.rows.map(row => ({
        queueId: row.queue_id,
        uri: row.uri,
        name: row.name,
        artists: row.artists,
        album: row.album,
        duration_ms: row.duration_ms,
        albumArt: row.album_art,
        addedAt: row.added_at,
      })),
      nowPlaying: room.now_playing,
      participants: participantsResult.rows.map(row => ({
        socketId: row.socket_id,
        name: row.name,
        joinedAt: row.joined_at,
      })),
      createdAt: room.created_at,
      lastHeartbeat: room.last_heartbeat,
      status: room.status,
    };
  },

  async getByJoinCode(code) {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id FROM rooms WHERE join_code = $1 AND status = $2',
      [code.toUpperCase(), 'active']
    );

    if (result.rows.length === 0) return null;
    return this.getById(result.rows[0].id);
  },

  async update(id, patch) {
    const pool = getPool();
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (patch.hostToken !== undefined) {
      updates.push(`host_token = $${paramIndex++}`);
      values.push(patch.hostToken);
    }
    if (patch.hostRefreshToken !== undefined) {
      updates.push(`host_refresh_token = $${paramIndex++}`);
      values.push(patch.hostRefreshToken);
    }
    if (patch.hostTokenExpiry !== undefined) {
      updates.push(`host_token_expiry = $${paramIndex++}`);
      values.push(patch.hostTokenExpiry);
    }
    if (patch.hostDeviceId !== undefined) {
      updates.push(`host_device_id = $${paramIndex++}`);
      values.push(patch.hostDeviceId);
    }
    if (patch.nowPlaying !== undefined) {
      updates.push(`now_playing = $${paramIndex++}`);
      values.push(JSON.stringify(patch.nowPlaying));
    }

    if (updates.length === 0) return this.getById(id);

    values.push(id);
    await pool.query(
      `UPDATE rooms SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      values
    );

    return this.getById(id);
  },

  async updateHeartbeat(id) {
    const pool = getPool();
    await pool.query(
      'UPDATE rooms SET last_heartbeat = $1 WHERE id = $2 AND status = $3',
      [Date.now(), id, 'active']
    );
  },

  async addParticipant(sessionId, socketId, name) {
    const pool = getPool();
    try {
      await pool.query(
        `INSERT INTO room_members (room_id, socket_id, name, joined_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (room_id, socket_id) DO NOTHING`,
        [sessionId, socketId, name, Date.now()]
      );
      return this.getById(sessionId);
    } catch (err) {
      console.error('Add participant error:', err);
      return null;
    }
  },

  async removeParticipant(sessionId, socketId) {
    const pool = getPool();
    await pool.query(
      'DELETE FROM room_members WHERE room_id = $1 AND socket_id = $2',
      [sessionId, socketId]
    );
    return this.getById(sessionId);
  },

  async isHostConnected(sessionId, hostSocketId) {
    const pool = getPool();
    const result = await pool.query(
      'SELECT 1 FROM room_members WHERE room_id = $1 AND socket_id = $2',
      [sessionId, hostSocketId]
    );
    return result.rows.length > 0;
  },

  async addToQueue(sessionId, track) {
    const pool = getPool();
    const queueId = nanoid(8);
    
    // Get current max position
    const posResult = await pool.query(
      'SELECT COALESCE(MAX(position), -1) as max_pos FROM queue_items WHERE room_id = $1',
      [sessionId]
    );
    const position = posResult.rows[0].max_pos + 1;

    await pool.query(
      `INSERT INTO queue_items (room_id, queue_id, uri, name, artists, album, duration_ms, album_art, added_at, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        sessionId,
        queueId,
        track.uri,
        track.name,
        JSON.stringify(track.artists || []),
        JSON.stringify(track.album || {}),
        track.duration_ms,
        track.albumArt || track.album?.images?.[0]?.url,
        Date.now(),
        position,
      ]
    );

    return this.getById(sessionId);
  },

  async removeFromQueue(sessionId, queueId) {
    const pool = getPool();
    await pool.query(
      'DELETE FROM queue_items WHERE room_id = $1 AND queue_id = $2',
      [sessionId, queueId]
    );
    return this.getById(sessionId);
  },

  async popQueue(sessionId) {
    const pool = getPool();
    const result = await pool.query(
      `DELETE FROM queue_items 
       WHERE id = (
         SELECT id FROM queue_items 
         WHERE room_id = $1 
         ORDER BY position ASC 
         LIMIT 1
       )
       RETURNING *`,
      [sessionId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      queueId: row.queue_id,
      uri: row.uri,
      name: row.name,
      artists: row.artists,
      album: row.album,
      duration_ms: row.duration_ms,
      albumArt: row.album_art,
      addedAt: row.added_at,
    };
  },

  async closeRoom(id) {
    const pool = getPool();
    await pool.query(
      'UPDATE rooms SET status = $1 WHERE id = $2',
      ['closed', id]
    );
    // Members and queue will be cascade deleted when room is deleted
    await pool.query('DELETE FROM room_members WHERE room_id = $1', [id]);
    await pool.query('DELETE FROM queue_items WHERE room_id = $1', [id]);
  },

  async delete(id) {
    const pool = getPool();
    await pool.query('DELETE FROM rooms WHERE id = $1', [id]);
  },

  async cleanupStaleRooms(timeoutMs = 30000) {
    const pool = getPool();
    const cutoff = Date.now() - timeoutMs;
    
    const result = await pool.query(
      'SELECT id FROM rooms WHERE last_heartbeat < $1 AND status = $2',
      [cutoff, 'active']
    );

    const staleRoomIds = result.rows.map(r => r.id);
    
    if (staleRoomIds.length > 0) {
      await pool.query(
        'UPDATE rooms SET status = $1 WHERE id = ANY($2::varchar[])',
        ['closed', staleRoomIds]
      );
      
      for (const roomId of staleRoomIds) {
        await pool.query('DELETE FROM room_members WHERE room_id = $1', [roomId]);
        await pool.query('DELETE FROM queue_items WHERE room_id = $1', [roomId]);
      }
      
      console.log(`Cleaned up ${staleRoomIds.length} stale rooms`);
    }

    return staleRoomIds;
  },

  async cleanupOldRooms(maxAgeMs = 4 * 60 * 60 * 1000) {
    const pool = getPool();
    const cutoff = Date.now() - maxAgeMs;
    
    await pool.query(
      'DELETE FROM rooms WHERE created_at < $1',
      [cutoff]
    );
  },
};
