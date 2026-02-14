import pg from 'pg';
const { Pool } = pg;

let pool = null;

export function initDatabase() {
  if (pool) return pool;

  // Support both full connection string and individual params
  const connectionString = process.env.DATABASE_URL;
  
  if (connectionString) {
    pool = new Pool({ connectionString });
  } else {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'spotisync',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    });
  }

  pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
  });

  console.log('Database connection pool initialized');
  return pool;
}

export function getPool() {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

export async function setupSchema() {
  const pool = getPool();
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id VARCHAR(20) PRIMARY KEY,
      join_code VARCHAR(6) UNIQUE NOT NULL,
      host_token TEXT NOT NULL,
      host_refresh_token TEXT,
      host_token_expiry BIGINT,
      host_device_id VARCHAR(100),
      created_at BIGINT NOT NULL,
      last_heartbeat BIGINT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      now_playing JSONB,
      CONSTRAINT status_check CHECK (status IN ('active', 'closed'))
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_rooms_join_code ON rooms(join_code);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS room_members (
      id SERIAL PRIMARY KEY,
      room_id VARCHAR(20) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      socket_id VARCHAR(100) NOT NULL,
      name VARCHAR(100) NOT NULL,
      joined_at BIGINT NOT NULL,
      UNIQUE(room_id, socket_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS queue_items (
      id SERIAL PRIMARY KEY,
      room_id VARCHAR(20) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      queue_id VARCHAR(10) UNIQUE NOT NULL,
      uri VARCHAR(200) NOT NULL,
      name VARCHAR(300) NOT NULL,
      artists JSONB NOT NULL,
      album JSONB NOT NULL,
      duration_ms INTEGER,
      album_art TEXT,
      added_at BIGINT NOT NULL,
      position INTEGER NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_queue_items_room_id ON queue_items(room_id, position);
  `);

  console.log('Database schema initialized');
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database connection pool closed');
  }
}
