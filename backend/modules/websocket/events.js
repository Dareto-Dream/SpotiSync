/**
 * WebSocket Event Names
 * Client → Server (C2S) and Server → Client (S2C)
 */

const C2S = {
  AUTH: 'auth',
  // Room lifecycle
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  HOST_HEARTBEAT: 'host_heartbeat',

  // Playback control (host only for pause/resume)
  PLAY: 'playback_play',
  PAUSE: 'playback_pause',
  SEEK: 'playback_seek',
  SKIP: 'playback_skip',
  PREV: 'playback_prev',
  POSITION_REPORT: 'playback_position_report',  // client reporting drift

  // Queue
  QUEUE_ADD: 'queue_add',
  QUEUE_REMOVE: 'queue_remove',
  QUEUE_REORDER: 'queue_reorder',
  QUEUE_PLAY_NOW: 'queue_play_now',

  // Voting
  VOTE: 'vote',

  // Settings
  UPDATE_SETTINGS: 'settings_update',
};

const S2C = {
  // Connection
  AUTH_REQUIRED: 'auth_required',
  CONNECTED: 'connected',
  ERROR: 'error',
  ROOM_STATE: 'room_state',

  // Room lifecycle
  MEMBER_JOINED: 'member_joined',
  MEMBER_LEFT: 'member_left',
  ROOM_CLOSED: 'room_closed',
  SETTINGS_UPDATED: 'settings_updated',

  // Playback sync
  PLAYBACK_STATE: 'playback_state',
  PLAYBACK_SEEK: 'playback_seek',
  NOW_PLAYING: 'now_playing',

  // Queue
  QUEUE_UPDATED: 'queue_updated',

  // Voting
  VOTE_UPDATE: 'vote_update',
  VOTE_PASSED: 'vote_passed',
};

module.exports = { C2S, S2C };
