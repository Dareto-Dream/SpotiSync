const db = require('./db');

class RoomManager {
  constructor() {
    // Start heartbeat cleanup task
    this.startCleanupTask();
  }

  // Generate random room code
  generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // Create a new room
  async createRoom(hostId, displayName) {
    const roomId = this.generateRoomCode();
    
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      
      // Insert room
      await client.query(
        `INSERT INTO rooms (room_id, host_id, is_active, last_heartbeat)
         VALUES ($1, $2, true, NOW())`,
        [roomId, hostId]
      );
      
      // Add host as member
      await client.query(
        `INSERT INTO room_members (room_id, user_id, display_name, is_host)
         VALUES ($1, $2, $3, true)`,
        [roomId, hostId, displayName]
      );
      
      await client.query('COMMIT');
      
      console.log(`Room created: ${roomId} by ${hostId}`);
      return { roomId, hostId };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to create room:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Join existing room
  async joinRoom(roomId, userId, displayName) {
    const client = await db.connect();
    try {
      // Check if room exists and is active
      const roomCheck = await client.query(
        'SELECT host_id, is_active FROM rooms WHERE room_id = $1',
        [roomId]
      );
      
      if (roomCheck.rows.length === 0) {
        throw new Error('ROOM_NOT_FOUND');
      }
      
      if (!roomCheck.rows[0].is_active) {
        throw new Error('ROOM_CLOSED');
      }
      
      // Add member (ignore if already exists)
      await client.query(
        `INSERT INTO room_members (room_id, user_id, display_name, is_host)
         VALUES ($1, $2, $3, false)
         ON CONFLICT (room_id, user_id) DO UPDATE
         SET display_name = $3, joined_at = NOW()`,
        [roomId, userId, displayName]
      );
      
      console.log(`User ${userId} joined room ${roomId}`);
      return { roomId, hostId: roomCheck.rows[0].host_id };
    } catch (error) {
      console.error('Failed to join room:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Update room heartbeat
  async updateHeartbeat(roomId) {
    try {
      const result = await db.query(
        `UPDATE rooms
         SET last_heartbeat = NOW()
         WHERE room_id = $1 AND is_active = true
         RETURNING room_id`,
        [roomId]
      );
      
      return result.rows.length > 0;
    } catch (error) {
      console.error('Failed to update heartbeat:', error);
      return false;
    }
  }

  // Close room (host disconnect)
  async closeRoom(roomId) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      
      // Mark room as inactive
      await client.query(
        'UPDATE rooms SET is_active = false WHERE room_id = $1',
        [roomId]
      );
      
      // Get all members for notification
      const members = await client.query(
        'SELECT user_id FROM room_members WHERE room_id = $1',
        [roomId]
      );
      
      // Remove all members
      await client.query(
        'DELETE FROM room_members WHERE room_id = $1',
        [roomId]
      );
      
      await client.query('COMMIT');
      
      console.log(`Room closed: ${roomId}`);
      return members.rows.map(m => m.user_id);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Failed to close room:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Leave room
  async leaveRoom(roomId, userId) {
    try {
      // Check if user is host
      const memberCheck = await db.query(
        'SELECT is_host FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, userId]
      );
      
      if (memberCheck.rows.length === 0) {
        return { wasHost: false };
      }
      
      const isHost = memberCheck.rows[0].is_host;
      
      // Remove member
      await db.query(
        'DELETE FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, userId]
      );
      
      // If host left, close the room
      if (isHost) {
        await this.closeRoom(roomId);
      }
      
      return { wasHost: isHost };
    } catch (error) {
      console.error('Failed to leave room:', error);
      throw error;
    }
  }

  // Get room members
  async getRoomMembers(roomId) {
    try {
      const result = await db.query(
        `SELECT user_id, display_name, is_host, joined_at
         FROM room_members
         WHERE room_id = $1
         ORDER BY is_host DESC, joined_at ASC`,
        [roomId]
      );
      
      return result.rows;
    } catch (error) {
      console.error('Failed to get room members:', error);
      return [];
    }
  }

  // Update playback state
  async updatePlaybackState(roomId, state) {
    try {
      await db.query(
        `UPDATE rooms
         SET current_track_uri = $2,
             position_ms = $3,
             is_playing = $4,
             updated_at = NOW()
         WHERE room_id = $1`,
        [roomId, state.track_uri, state.position_ms, state.is_playing]
      );
    } catch (error) {
      console.error('Failed to update playback state:', error);
    }
  }

  // Get playback state
  async getPlaybackState(roomId) {
    try {
      const result = await db.query(
        `SELECT current_track_uri, position_ms, is_playing, updated_at
         FROM rooms
         WHERE room_id = $1 AND is_active = true`,
        [roomId]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return {
        track_uri: result.rows[0].current_track_uri,
        position_ms: result.rows[0].position_ms,
        is_playing: result.rows[0].is_playing,
        updated_at: result.rows[0].updated_at
      };
    } catch (error) {
      console.error('Failed to get playback state:', error);
      return null;
    }
  }

  // Cleanup stale rooms
  async cleanupStaleRooms() {
    try {
      const result = await db.query(
        `UPDATE rooms
         SET is_active = false
         WHERE is_active = true
         AND last_heartbeat < NOW() - INTERVAL '5 minutes'
         RETURNING room_id`
      );
      
      if (result.rows.length > 0) {
        console.log(`Cleaned up ${result.rows.length} stale rooms`);
        
        // Remove members from stale rooms
        for (const row of result.rows) {
          await db.query(
            'DELETE FROM room_members WHERE room_id = $1',
            [row.room_id]
          );
        }
      }
    } catch (error) {
      console.error('Failed to cleanup stale rooms:', error);
    }
  }

  // Start periodic cleanup
  startCleanupTask() {
    setInterval(() => {
      this.cleanupStaleRooms();
    }, 60000); // Every minute
  }
}

module.exports = new RoomManager();
