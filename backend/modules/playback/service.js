const pool = require('../../config/db');

/**
 * Playback state is stored in DB for persistence.
 * An in-memory cache keyed by roomId speeds up frequent reads.
 */
const stateCache = new Map(); // roomId -> playbackState

async function getState(roomId) {
  if (stateCache.has(roomId)) return stateCache.get(roomId);

  const result = await pool.query(
    'SELECT * FROM room_playback WHERE room_id = $1',
    [roomId]
  );
  if (!result.rows[0]) return null;

  const row = result.rows[0];
  const state = {
    roomId,
    currentItem: row.current_item,
    positionMs: Number(row.position_ms),
    serverTime: new Date(row.server_time).getTime(),
    isPlaying: row.is_playing,
    queue: row.queue || [],
  };
  stateCache.set(roomId, state);
  return state;
}

async function setState(roomId, partial) {
  const current = (await getState(roomId)) || {
    roomId,
    currentItem: null,
    positionMs: 0,
    serverTime: Date.now(),
    isPlaying: false,
    queue: [],
  };

  const updated = { ...current, ...partial, roomId, serverTime: Date.now() };
  stateCache.set(roomId, updated);

  await pool.query(
    `UPDATE room_playback SET
       current_item = $1,
       position_ms = $2,
       server_time = to_timestamp($3 / 1000.0),
       is_playing = $4,
       queue = $5
     WHERE room_id = $6`,
    [
      JSON.stringify(updated.currentItem),
      updated.positionMs,
      updated.serverTime,
      updated.isPlaying,
      JSON.stringify(updated.queue),
      roomId,
    ]
  );
  return updated;
}

async function play(roomId) {
  return setState(roomId, { isPlaying: true });
}

async function pause(roomId, positionMs) {
  return setState(roomId, { isPlaying: false, positionMs });
}

async function seek(roomId, positionMs) {
  return setState(roomId, { positionMs });
}

async function setCurrentItem(roomId, item, positionMs = 0) {
  return setState(roomId, { currentItem: item, positionMs, isPlaying: true });
}

async function addToQueue(roomId, item) {
  const state = await getState(roomId);
  if (!state) return null;
  const queue = [...(state.queue || []), item];
  return setState(roomId, { queue });
}

async function removeFromQueue(roomId, index) {
  const state = await getState(roomId);
  if (!state) return null;
  const queue = state.queue.filter((_, i) => i !== index);
  return setState(roomId, { queue });
}

async function reorderQueue(roomId, fromIndex, toIndex) {
  const state = await getState(roomId);
  if (!state) return null;
  const queue = [...state.queue];
  const [item] = queue.splice(fromIndex, 1);
  queue.splice(toIndex, 0, item);
  return setState(roomId, { queue });
}

// Advance to next queue item; returns new state or null if queue empty
async function skipToNext(roomId) {
  const state = await getState(roomId);
  if (!state) return null;
  const queue = state.queue || [];
  if (queue.length === 0) {
    return setState(roomId, { currentItem: null, isPlaying: false, positionMs: 0, queue: [] });
  }
  const [nextItem, ...rest] = queue;
  return setState(roomId, { currentItem: nextItem, queue: rest, positionMs: 0, isPlaying: true });
}

// Current estimated position accounting for elapsed time since last update
function getLivePosition(state) {
  if (!state) return 0;
  if (!state.isPlaying) return state.positionMs;
  const elapsed = Date.now() - state.serverTime;
  return state.positionMs + elapsed;
}

// Evict room from cache (on close)
function evictCache(roomId) {
  stateCache.delete(roomId);
}

module.exports = {
  getState, setState, play, pause, seek, setCurrentItem,
  addToQueue, removeFromQueue, reorderQueue, skipToNext, getLivePosition, evictCache,
};
