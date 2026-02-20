-- Jam Mode Database Schema
-- Run this once to initialize the database

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code CHAR(6) UNIQUE NOT NULL,
  host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  -- Room settings stored as JSONB for extensibility
  settings JSONB DEFAULT '{
    "userSkipMode": "vote",
    "userPrevMode": "vote",
    "voteThreshold": 0.5,
    "voteCooldownSec": 5,
    "userQueueing": true,
    "userReordering": false,
    "userRemoval": false
  }'::jsonb
);

CREATE TABLE IF NOT EXISTS room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

-- Playback state for each room (single row per active room)
CREATE TABLE IF NOT EXISTS room_playback (
  room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  current_item JSONB,            -- full track object
  position_ms BIGINT DEFAULT 0, -- current playback position
  server_time TIMESTAMPTZ DEFAULT NOW(), -- time when position was recorded
  is_playing BOOLEAN DEFAULT FALSE,
  queue JSONB DEFAULT '[]'::jsonb  -- ordered array of track objects
);

-- Vote tracking (reset per track change)
CREATE TABLE IF NOT EXISTS room_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(16) NOT NULL CHECK (action IN ('skip', 'prev')),
  track_id TEXT NOT NULL,         -- videoId of current track
  voted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, user_id, action, track_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rooms_join_code ON rooms(join_code);
CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active);
CREATE INDEX IF NOT EXISTS idx_rooms_heartbeat ON rooms(last_heartbeat) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_room_votes_room ON room_votes(room_id);
