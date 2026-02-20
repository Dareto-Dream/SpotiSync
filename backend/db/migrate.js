const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function runMigrations() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  try {
    await pool.query(schema);
    console.log('[DB] Schema applied successfully');
  } catch (err) {
    console.error('[DB] Migration failed:', err.message);
    throw err;
  }
}

module.exports = { runMigrations };
