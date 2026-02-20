const pool = require('../../config/db');

/**
 * In-memory vote store: roomId -> { skip: Set<userId>, prev: Set<userId> }
 * Synced to DB for auditing, but live state from memory for speed.
 */
const voteStore = new Map();

function ensureRoom(roomId) {
  if (!voteStore.has(roomId)) {
    voteStore.set(roomId, { skip: new Set(), prev: new Set() });
  }
  return voteStore.get(roomId);
}

async function castVote(roomId, userId, action, trackId, cooldownSec = 5) {
  if (!['skip', 'prev'].includes(action)) {
    throw Object.assign(new Error('Invalid action'), { status: 400 });
  }

  // Check cooldown in DB
  if (cooldownSec > 0) {
    const cooldownCheck = await pool.query(
      `SELECT voted_at FROM room_votes
       WHERE room_id = $1 AND user_id = $2
       ORDER BY voted_at DESC LIMIT 1`,
      [roomId, userId]
    );
    if (cooldownCheck.rows[0]) {
      const elapsed = (Date.now() - new Date(cooldownCheck.rows[0].voted_at).getTime()) / 1000;
      if (elapsed < cooldownSec) {
        throw Object.assign(
          new Error(`Vote cooldown: wait ${Math.ceil(cooldownSec - elapsed)}s`),
          { status: 429 }
        );
      }
    }
  }

  // Insert vote (idempotent via ON CONFLICT)
  try {
    await pool.query(
      `INSERT INTO room_votes (room_id, user_id, action, track_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_id, user_id, action, track_id) DO NOTHING`,
      [roomId, userId, action, trackId]
    );
  } catch (err) {
    throw err;
  }

  // Update in-memory
  const votes = ensureRoom(roomId);
  votes[action].add(userId);
  return votes[action].size;
}

function getVotes(roomId, action) {
  const votes = voteStore.get(roomId);
  if (!votes) return 0;
  return votes[action]?.size || 0;
}

function checkThreshold(roomId, action, activeMemberCount, threshold = 0.5) {
  const count = getVotes(roomId, action);
  // At minimum 1 vote always counts (avoids divide-by-zero)
  if (activeMemberCount <= 1) return count >= 1;
  return count / activeMemberCount >= threshold;
}

function resetVotes(roomId) {
  voteStore.set(roomId, { skip: new Set(), prev: new Set() });
}

function evictRoom(roomId) {
  voteStore.delete(roomId);
}

module.exports = { castVote, getVotes, checkThreshold, resetVotes, evictRoom };
