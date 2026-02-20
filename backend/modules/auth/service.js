const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_insecure';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

async function register(username, password) {
  if (!username || username.length < 2 || username.length > 64) {
    throw Object.assign(new Error('Username must be 2-64 characters'), { status: 400 });
  }
  if (!password || password.length < 6) {
    throw Object.assign(new Error('Password must be at least 6 characters'), { status: 400 });
  }

  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username.trim(), hash]
    );
    return result.rows[0];
  } catch (err) {
    if (err.code === '23505') {
      throw Object.assign(new Error('Username already taken'), { status: 409 });
    }
    throw err;
  }
}

async function login(username, password) {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = result.rows[0];
  if (!user) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  const token = jwt.sign(
    { sub: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  return { token, user: { id: user.id, username: user.username } };
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function getUserById(id) {
  const result = await pool.query('SELECT id, username, created_at FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

module.exports = { register, login, verifyToken, getUserById };
