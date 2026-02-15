import axios from 'axios';
import { query } from '../database/db.js';
import { getRoomByCode } from './room.js';

export async function addToQueue(roomCode, track, addedBy) {
  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      throw new Error('Room not found');
    }

    // Get current max position
    const posResult = await query(
      `SELECT COALESCE(MAX(position), -1) as max_pos
       FROM queue_items
       WHERE room_id = $1`,
      [room.id]
    );

    const nextPosition = posResult.rows[0].max_pos + 1;

    await query(
      `INSERT INTO queue_items
       (room_id, track_uri, track_name, artist_name, album_name, duration_ms, added_by, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        room.id,
        track.uri,
        track.name,
        track.artists,
        track.album,
        track.durationMs,
        addedBy,
        nextPosition
      ]
    );

    return await getQueue(roomCode);
  } catch (error) {
    console.error('Error adding to queue:', error);
    throw error;
  }
}

export async function getQueue(roomCode) {
  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      return [];
    }

    const result = await query(
      `SELECT id, track_uri, track_name, artist_name, album_name,
              duration_ms, added_by, position, added_at
       FROM queue_items
       WHERE room_id = $1
       ORDER BY position`,
      [room.id]
    );

    return result.rows;
  } catch (error) {
    console.error('Error getting queue:', error);
    return [];
  }
}

export async function removeFromQueue(roomCode, queueItemId) {
  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      throw new Error('Room not found');
    }

    await query(
      `DELETE FROM queue_items
       WHERE room_id = $1 AND id = $2`,
      [room.id, queueItemId]
    );

    // Reorder remaining items
    await query(
      `UPDATE queue_items
       SET position = subquery.new_position
       FROM (
         SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 as new_position
         FROM queue_items
         WHERE room_id = $1
       ) as subquery
       WHERE queue_items.id = subquery.id`,
      [room.id]
    );

    return await getQueue(roomCode);
  } catch (error) {
    console.error('Error removing from queue:', error);
    throw error;
  }
}

export async function clearQueue(roomCode) {
  try {
    const room = await getRoomByCode(roomCode);
    
    if (!room) {
      throw new Error('Room not found');
    }

    await query(
      `DELETE FROM queue_items WHERE room_id = $1`,
      [room.id]
    );
  } catch (error) {
    console.error('Error clearing queue:', error);
  }
}

export async function transferPlayback(accessToken, deviceId) {
  try {
    await axios.put(
      'https://api.spotify.com/v1/me/player',
      {
        device_ids: [deviceId],
        play: false
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`Transferred playback to device ${deviceId}`);
    return true;
  } catch (error) {
    console.error('Error transferring playback:', error.response?.data || error.message);
    throw error;
  }
}

export async function play(accessToken, deviceId, trackUri = null, positionMs = 0) {
  try {
    const body = trackUri ? { uris: [trackUri], position_ms: positionMs } : {};
    
    await axios.put(
      `https://api.spotify.com/v1/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`,
      body,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return true;
  } catch (error) {
    console.error('Error starting playback:', error.response?.data || error.message);
    throw error;
  }
}

export async function pause(accessToken, deviceId = null) {
  try {
    await axios.put(
      `https://api.spotify.com/v1/me/player/pause${deviceId ? `?device_id=${deviceId}` : ''}`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return true;
  } catch (error) {
    console.error('Error pausing playback:', error.response?.data || error.message);
    throw error;
  }
}

export async function skipToNext(accessToken, deviceId = null) {
  try {
    await axios.post(
      `https://api.spotify.com/v1/me/player/next${deviceId ? `?device_id=${deviceId}` : ''}`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return true;
  } catch (error) {
    console.error('Error skipping to next:', error.response?.data || error.message);
    throw error;
  }
}

export async function skipToPrevious(accessToken, deviceId = null) {
  try {
    await axios.post(
      `https://api.spotify.com/v1/me/player/previous${deviceId ? `?device_id=${deviceId}` : ''}`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return true;
  } catch (error) {
    console.error('Error skipping to previous:', error.response?.data || error.message);
    throw error;
  }
}

export async function seek(accessToken, positionMs, deviceId = null) {
  try {
    await axios.put(
      `https://api.spotify.com/v1/me/player/seek`,
      null,
      {
        params: {
          position_ms: positionMs,
          ...(deviceId && { device_id: deviceId })
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return true;
  } catch (error) {
    console.error('Error seeking:', error.response?.data || error.message);
    throw error;
  }
}

export async function getCurrentPlayback(accessToken) {
  try {
    const response = await axios.get(
      'https://api.spotify.com/v1/me/player',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    return response.data;
  } catch (error) {
    if (error.response?.status === 204) {
      return null; // No active playback
    }
    console.error('Error getting current playback:', error.response?.data || error.message);
    throw error;
  }
}

export async function searchTracks(accessToken, query, limit = 20) {
  try {
    const response = await axios.get(
      'https://api.spotify.com/v1/search',
      {
        params: {
          q: query,
          type: 'track',
          limit
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    return response.data.tracks.items.map(track => ({
      uri: track.uri,
      id: track.id,
      name: track.name,
      artists: track.artists.map(a => a.name).join(', '),
      album: track.album.name,
      albumArt: track.album.images[0]?.url,
      durationMs: track.duration_ms,
      previewUrl: track.preview_url
    }));
  } catch (error) {
    console.error('Error searching tracks:', error.response?.data || error.message);
    throw error;
  }
}
