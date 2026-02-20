const pool = require('../../config/db');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_SETTINGS = {
  userSkipMode: 'vote',      // 'vote' | 'instant'
  userPrevMode: 'vote',      // 'vote' | 'instant'
  voteThreshold: 0.5,        // fraction of active members needed
  voteCooldownSec: 5,
  userQueueing: true,
  userReordering: false,
  userRemoval: false,
};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createRoom(hostId, settingsOverride = {}) {
  let code;
  let attempts = 0;
  // Ensure unique code
  while (attempts < 10) {
    code = generateCode();
    const existing = await pool.query('SELECT id FROM rooms WHERE join_code = $1 AND is_active = TRUE', [code]);
    if (existing.rows.length === 0) break;
    attempts++;
  }

  const settings = { ...DEFAULT_SETTINGS, ...settingsOverride };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roomResult = await client.query(
      `INSERT INTO rooms (host_id, join_code, settings) VALUES ($1, $2, $3) RETURNING *`,
      [hostId, code, JSON.stringify(settings)]
    );
    const room = roomResult.rows[0];

    await client.query(
      `INSERT INTO room_playback (room_id) VALUES ($1)`,
      [room.id]
    );

    await client.query(
      `INSERT INTO room_members (room_id, user_id) VALUES ($1, $2)`,
      [room.id, hostId]
    );

    await client.query('COMMIT');
    return room;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getRoomByCode(code) {
  const result = await pool.query(
    `SELECT r.*, u.username AS host_username FROM rooms r
     JOIN users u ON r.host_id = u.id
     WHERE r.join_code = $1 AND r.is_active = TRUE`,
    [code.toUpperCase()]
  );
  return result.rows[0] || null;
}

async function getRoomById(roomId) {
  const result = await pool.query(
    `SELECT r.*, u.username AS host_username FROM rooms r
     JOIN users u ON r.host_id = u.id
     WHERE r.id = $1`,
    [roomId]
  );
  return result.rows[0] || null;
}

async function joinRoom(roomId, userId) {
  try {
    await pool.query(
      `INSERT INTO room_members (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [roomId, userId]
    );
  } catch (err) {
    if (err.code === '23503') {
      throw Object.assign(new Error('Room not found'), { status: 404 });
    }
    throw err;
  }
}

async function leaveRoom(roomId, userId) {
  await pool.query(
    `DELETE FROM room_members WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId]
  );
}

async function getMembers(roomId) {
  const result = await pool.query(
    `SELECT u.id, u.username, rm.joined_at FROM room_members rm
     JOIN users u ON rm.user_id = u.id
     WHERE rm.room_id = $1`,
    [roomId]
  );
  return result.rows;
}

async function closeRoom(roomId) {
  await pool.query(
    `UPDATE rooms SET is_active = FALSE WHERE id = $1`,
    [roomId]
  );
  await pool.query(`DELETE FROM room_members WHERE room_id = $1`, [roomId]);
}

async function updateHeartbeat(roomId) {
  await pool.query(
    `UPDATE rooms SET last_heartbeat = NOW() WHERE id = $1`,
    [roomId]
  );
}

async function updateSettings(roomId, settings) {
  const allowed = ['userSkipMode', 'userPrevMode', 'voteThreshold', 'voteCooldownSec', 'userQueueing', 'userReordering', 'userRemoval'];
  const filtered = {};
  for (const k of allowed) {
    if (settings[k] !== undefined) filtered[k] = settings[k];
  }
  await pool.query(
    `UPDATE rooms SET settings = settings || $1::jsonb WHERE id = $2`,
    [JSON.stringify(filtered), roomId]
  );
}

// Called on server startup: close rooms whose heartbeat timed out
async function recoverStaleRooms() {
  const timeoutMs = parseInt(process.env.ROOM_TIMEOUT_MS || '30000');
  const result = await pool.query(
    `UPDATE rooms SET is_active = FALSE
     WHERE is_active = TRUE AND last_heartbeat < NOW() - ($1 || ' milliseconds')::INTERVAL
     RETURNING id`,
    [timeoutMs]
  );
  if (result.rows.length > 0) {
    const ids = result.rows.map(r => r.id);
    for (const id of ids) {
      await pool.query(`DELETE FROM room_members WHERE room_id = $1`, [id]);
    }
    console.log(`[Room] Recovered ${result.rows.length} stale room(s)`);
  }
}

module.exports = {
  createRoom, getRoomByCode, getRoomById, joinRoom, leaveRoom,
  getMembers, closeRoom, updateHeartbeat, updateSettings, recoverStaleRooms,
  DEFAULT_SETTINGS,
};
