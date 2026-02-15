import { query, getClient } from './db.js';

const migrations = [
  {
    name: '001_create_rooms_table',
    up: `
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        room_code VARCHAR(10) UNIQUE NOT NULL,
        host_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        current_track_uri VARCHAR(255),
        current_track_position_ms INTEGER DEFAULT 0,
        is_playing BOOLEAN DEFAULT false,
        device_id VARCHAR(255)
      );
      
      CREATE INDEX idx_rooms_code ON rooms(room_code);
      CREATE INDEX idx_rooms_active ON rooms(is_active);
      CREATE INDEX idx_rooms_heartbeat ON rooms(last_heartbeat);
    `
  },
  {
    name: '002_create_room_members_table',
    up: `
      CREATE TABLE IF NOT EXISTS room_members (
        id SERIAL PRIMARY KEY,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        user_id VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        is_host BOOLEAN DEFAULT false,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(room_id, user_id)
      );
      
      CREATE INDEX idx_room_members_room ON room_members(room_id);
      CREATE INDEX idx_room_members_user ON room_members(user_id);
    `
  },
  {
    name: '003_create_queue_table',
    up: `
      CREATE TABLE IF NOT EXISTS queue_items (
        id SERIAL PRIMARY KEY,
        room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        track_uri VARCHAR(255) NOT NULL,
        track_name VARCHAR(500) NOT NULL,
        artist_name VARCHAR(500) NOT NULL,
        album_name VARCHAR(500),
        duration_ms INTEGER NOT NULL,
        added_by VARCHAR(255) NOT NULL,
        position INTEGER NOT NULL,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX idx_queue_room ON queue_items(room_id, position);
    `
  },
  {
    name: '004_create_auth_tokens_table',
    up: `
      CREATE TABLE IF NOT EXISTS auth_tokens (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) UNIQUE NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);
      CREATE INDEX idx_auth_tokens_expires ON auth_tokens(expires_at);
    `
  },
  {
    name: '005_create_migrations_table',
    up: `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `
  }
];

async function runMigrations() {
  console.log('Starting database migrations...');
  
  try {
    // Create migrations table first if it doesn't exist
    await query(migrations[4].up);
    
    for (const migration of migrations) {
      const result = await query(
        'SELECT * FROM migrations WHERE name = $1',
        [migration.name]
      );
      
      if (result.rows.length === 0) {
        console.log(`Running migration: ${migration.name}`);
        await query(migration.up);
        await query(
          'INSERT INTO migrations (name) VALUES ($1)',
          [migration.name]
        );
        console.log(`✓ Completed migration: ${migration.name}`);
      } else {
        console.log(`⊘ Skipping migration (already applied): ${migration.name}`);
      }
    }
    
    console.log('All migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigrations();
