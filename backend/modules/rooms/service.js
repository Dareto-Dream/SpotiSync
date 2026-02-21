const pool = require('../../config/db');
const { v4: uuidv4 } = require('uuid');
const playbackService = require('../playback/service');

const DEFAULT_SETTINGS = {
  userSkipMode: 'vote',      // 'vote' | 'instant'
  userPrevMode: 'vote',      // 'vote' | 'instant'
  voteThreshold: 0.5,        // fraction of active members needed
  voteCooldownSec: 5,
  userQueueing: true,
  userReordering: false,
  userRemoval: false,
  autoplayEnabled: true,
  autoplayVariety: 35,      // 0 = familiar, 100 = exploratory
  autoplayHistorySize: 20,  // number of recent tracks used to avoid repeats
  autoplayAllowExplicit: true,
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
  const allowed = [
    'userSkipMode', 'userPrevMode', 'voteThreshold', 'voteCooldownSec',
    'userQueueing', 'userReordering', 'userRemoval',
    'autoplayEnabled', 'autoplayVariety', 'autoplayHistorySize', 'autoplayAllowExplicit',
  ];
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
async function closeTimedOutRooms(timeoutMs) {
  const result = await pool.query(
    `UPDATE rooms SET is_active = FALSE
     WHERE is_active = TRUE AND last_heartbeat < NOW() - ($1 || ' milliseconds')::INTERVAL
     RETURNING id`,
    [timeoutMs]
  );

  if (result.rows.length === 0) return 0;

  const ids = result.rows.map(r => r.id);
  await pool.query(`DELETE FROM room_members WHERE room_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM room_votes WHERE room_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM room_playback WHERE room_id = ANY($1::uuid[])`, [ids]);
  ids.forEach(playbackService.evictCache);

  return ids.length;
}

async function deleteOldInactiveRooms(retentionHours) {
  const result = await pool.query(
    `DELETE FROM rooms
     WHERE is_active = FALSE
       AND last_heartbeat < NOW() - ($1 || ' hours')::INTERVAL
     RETURNING id`,
    [retentionHours]
  );
  return result.rows.length;
}

async function cleanupOrphans() {
  const orphanMembers = await pool.query(
    `DELETE FROM room_members rm
     WHERE NOT EXISTS (SELECT 1 FROM rooms r WHERE r.id = rm.room_id)
     RETURNING id`
  );
  const orphanPlayback = await pool.query(
    `DELETE FROM room_playback rp
     WHERE NOT EXISTS (SELECT 1 FROM rooms r WHERE r.id = rp.room_id)
     RETURNING room_id`
  );
  const orphanVotes = await pool.query(
    `DELETE FROM room_votes rv
     WHERE NOT EXISTS (SELECT 1 FROM rooms r WHERE r.id = rv.room_id)
     RETURNING id`
  );
  orphanPlayback.rows.forEach(r => playbackService.evictCache(r.room_id));

  return {
    members: orphanMembers.rows.length,
    playback: orphanPlayback.rows.length,
    votes: orphanVotes.rows.length,
  };
}

async function recoverStaleRooms() {
  const timeoutMs = parseInt(process.env.ROOM_TIMEOUT_MS || '30000', 10);
  const closed = await closeTimedOutRooms(timeoutMs);
  if (closed > 0) {
    console.log(`[Room] Recovered ${closed} stale room(s)`);
  }
}

async function cleanupRoomData(options = {}) {
  const timeoutMs = options.timeoutMs ?? parseInt(process.env.ROOM_TIMEOUT_MS || '30000', 10);
  const retentionHours = options.retentionHours ?? parseInt(process.env.ROOM_RETENTION_HOURS || '24', 10);

  const closed = await closeTimedOutRooms(timeoutMs);
  const removed = await deleteOldInactiveRooms(retentionHours);
  const orphans = await cleanupOrphans();

  return { closed, removed, orphans };
}

let janitorTimer = null;
function startRoomJanitor() {
  if (janitorTimer) return;
  const intervalMs = parseInt(process.env.ROOM_CLEANUP_INTERVAL_MS || String(5 * 60 * 1000), 10);

  const tick = async () => {
    try {
      const summary = await cleanupRoomData();
      if (summary.closed || summary.removed || summary.orphans.members || summary.orphans.playback || summary.orphans.votes) {
        console.log('[Room Janitor]', summary);
      }
    } catch (err) {
      console.error('[Room Janitor] Cleanup failed:', err.message);
    }
  };

  janitorTimer = setInterval(tick, intervalMs);
  tick(); // run once at startup
}

module.exports = {
  createRoom, getRoomByCode, getRoomById, joinRoom, leaveRoom,
  getMembers, closeRoom, updateHeartbeat, updateSettings, recoverStaleRooms,
  cleanupRoomData, startRoomJanitor,
  DEFAULT_SETTINGS,
};
