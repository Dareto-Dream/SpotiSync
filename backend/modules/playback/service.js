const pool = require('../../config/db');
const autoplay = require('./autoplay');

const MIN_AUTOPLAY_QUEUE = 10;

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
    autoplayQueue: row.autoplay_queue || [],
    autoplayProfile: autoplay.normalizeProfile(row.autoplay_profile || {}),
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
    autoplayQueue: [],
    autoplayProfile: autoplay.normalizeProfile({}),
  };

  const updated = { ...current, ...partial, roomId, serverTime: Date.now() };
  stateCache.set(roomId, updated);

  await pool.query(
    `UPDATE room_playback SET
       current_item = $1,
       position_ms = $2,
       server_time = to_timestamp($3 / 1000.0),
       is_playing = $4,
       queue = $5,
       autoplay_queue = $6,
       autoplay_profile = $7
     WHERE room_id = $8`,
    [
      JSON.stringify(updated.currentItem),
      updated.positionMs,
      updated.serverTime,
      updated.isPlaying,
      JSON.stringify(updated.queue),
      JSON.stringify(updated.autoplayQueue || []),
      JSON.stringify(autoplay.normalizeProfile(updated.autoplayProfile || {})),
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

async function removeFromAutoplayQueue(roomId, index) {
  const state = await getState(roomId);
  if (!state) return null;
  const target = (state.autoplayQueue || [])[index];
  const autoplayQueue = (state.autoplayQueue || []).filter((_, i) => i !== index);
  let nextProfile = state.autoplayProfile || {};
  if (target?.videoId) {
    nextProfile = autoplay.normalizeProfile(nextProfile);
    const nextIds = [...nextProfile.autoplayExcludedIds.filter(id => id !== target.videoId), target.videoId]
      .slice(-200);
    const signature = autoplay.getTrackSignature(target);
    const nextSignatures = signature
      ? [...nextProfile.autoplayExcludedSignatures.filter(s => s !== signature), signature].slice(-200)
      : nextProfile.autoplayExcludedSignatures;
    nextProfile = { ...nextProfile, autoplayExcludedIds: nextIds, autoplayExcludedSignatures: nextSignatures };
  }
  return setState(roomId, { autoplayQueue, autoplayProfile: nextProfile });
}

async function reorderAutoplayQueue(roomId, fromIndex, toIndex) {
  const state = await getState(roomId);
  if (!state) return null;
  const autoplayQueue = [...(state.autoplayQueue || [])];
  const [item] = autoplayQueue.splice(fromIndex, 1);
  autoplayQueue.splice(toIndex, 0, item);
  return setState(roomId, { autoplayQueue });
}

async function promoteAutoplayToQueue(roomId, fromIndex, toIndex = null) {
  const state = await getState(roomId);
  if (!state) return null;
  const autoplayQueue = [...(state.autoplayQueue || [])];
  if (fromIndex < 0 || fromIndex >= autoplayQueue.length) return state;
  const [item] = autoplayQueue.splice(fromIndex, 1);
  const queue = [...(state.queue || [])];
  const insertAt = toIndex === null || toIndex > queue.length ? queue.length : Math.max(0, toIndex);
  queue.splice(insertAt, 0, item);
  return setState(roomId, { autoplayQueue, queue });
}

async function ensureAutoplayQueue(roomId, settings = {}) {
  const state = await getState(roomId);
  if (!state) return null;

  if (!settings.autoplayEnabled) {
    if ((state.autoplayQueue || []).length) {
      return setState(roomId, { autoplayQueue: [] });
    }
    return state;
  }

  const profile = autoplay.normalizeProfile(state.autoplayProfile || {});
  if (!profile.autoplaySeeded) {
    return state;
  }

  const currentAuto = [...(state.autoplayQueue || [])];
  if (currentAuto.length >= MIN_AUTOPLAY_QUEUE) return state;

  const baseState = { ...state, autoplayQueue: currentAuto, autoplayProfile: profile };
  const missing = MIN_AUTOPLAY_QUEUE - currentAuto.length;
  const candidates = await autoplay.findAutoplayCandidates({
    state: baseState,
    settings,
    limit: Math.max(12, missing * 2),
  });

  for (const track of candidates) {
    if (currentAuto.length >= MIN_AUTOPLAY_QUEUE) break;
    if (!track?.videoId) continue;
    if (currentAuto.some(t => t.videoId === track.videoId)) continue;
    if ((state.queue || []).some(t => t?.videoId === track.videoId)) continue;
    if (state.currentItem?.videoId === track.videoId) continue;
    currentAuto.push(track);
  }

  if (currentAuto.length === (state.autoplayQueue || []).length) return state;
  return setState(roomId, { autoplayQueue: currentAuto });
}

// Advance to next item: normal queue has priority over autoplay queue
async function skipToNext(roomId, settings = {}) {
  let state = await getState(roomId);
  if (!state) return null;

  let queue = [...(state.queue || [])];
  let autoplayQueue = [...(state.autoplayQueue || [])];

  if (queue.length === 0 && settings.autoplayEnabled) {
    // Ensure autoplay queue is populated before consuming
    state = await ensureAutoplayQueue(roomId, settings) || state;
    autoplayQueue = [...(state.autoplayQueue || [])];
  }

  let nextItem = null;
  let usedAutoplay = false;

  if (queue.length > 0) {
    [nextItem, ...queue] = queue;
  } else if (settings.autoplayEnabled && autoplayQueue.length > 0) {
    [nextItem, ...autoplayQueue] = autoplayQueue;
    usedAutoplay = true;
  }

  const updated = await setState(roomId, {
    currentItem: nextItem,
    queue,
    autoplayQueue,
    positionMs: 0,
    isPlaying: !!nextItem,
  });

  return { state: updated, usedAutoplay };
}

async function updateAutoplayProfile(roomId, updater) {
  const state = await getState(roomId);
  if (!state) return null;
  const nextProfile = updater(autoplay.normalizeProfile(state.autoplayProfile || {}));
  return setState(roomId, { autoplayProfile: autoplay.normalizeProfile(nextProfile || {}) });
}

async function learnTaste(roomId, track, options = {}) {
  return updateAutoplayProfile(roomId, (profile) => autoplay.learnFromTrack(profile, track, options));
}

async function markAutoplaySeeded(roomId) {
  return updateAutoplayProfile(roomId, (profile) => ({ ...profile, autoplaySeeded: true }));
}

async function getAutoplaySuggestions(roomId, settings, limit = 10) {
  const state = await getState(roomId);
  if (!state) return [];
  try {
    return await autoplay.findAutoplayCandidates({ state, settings, limit });
  } catch (err) {
    console.error('[Autoplay] Suggestion build failed:', err.message);
    return [];
  }
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
  addToQueue, removeFromQueue, reorderQueue, skipToNext,
  updateAutoplayProfile, learnTaste,
  markAutoplaySeeded,
  getAutoplaySuggestions,
  removeFromAutoplayQueue, reorderAutoplayQueue, promoteAutoplayToQueue,
  ensureAutoplayQueue,
  getLivePosition, evictCache,
};
