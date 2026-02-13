-- Database schema for Spotify Rooms

CREATE TABLE IF NOT EXISTS rooms (
    room_id VARCHAR(10) PRIMARY KEY,
    host_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    current_track_uri VARCHAR(255),
    position_ms INTEGER DEFAULT 0,
    is_playing BOOLEAN DEFAULT false,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_members (
    id SERIAL PRIMARY KEY,
    room_id VARCHAR(10) REFERENCES rooms(room_id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_host BOOLEAN DEFAULT false,
    UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_tokens (
    user_id VARCHAR(255) PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active, last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_user_tokens_expiry ON user_tokens(expires_at);

-- Function to clean up stale rooms (older than 5 minutes without heartbeat)
CREATE OR REPLACE FUNCTION cleanup_stale_rooms()
RETURNS void AS $$
BEGIN
    UPDATE rooms
    SET is_active = false
    WHERE is_active = true
    AND last_heartbeat < NOW() - INTERVAL '5 minutes';
    
    DELETE FROM room_members
    WHERE room_id IN (
        SELECT room_id FROM rooms WHERE is_active = false
    );
END;
$$ LANGUAGE plpgsql;
