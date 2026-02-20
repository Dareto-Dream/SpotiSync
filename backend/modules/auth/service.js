const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../../config/db');
const { redis } = require('../../config/redis');

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_insecure';
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '15m';
const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const REFRESH_PREFIX = 'refresh:';
const refreshTtlSeconds = Math.max(1, REFRESH_TOKEN_TTL_DAYS) * 24 * 60 * 60;

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
}

async function storeRefreshToken(refreshToken, userId) {
  await redis.set(`${REFRESH_PREFIX}${refreshToken}`, userId, { EX: refreshTtlSeconds });
}

async function issueTokens(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = uuidv4();
  await storeRefreshToken(refreshToken, user.id);
  return { accessToken, refreshToken, user: { id: user.id, username: user.username } };
}

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
      `INSERT INTO users (username, password_hash, auth_provider)
       VALUES ($1, $2, 'local')
       RETURNING id, username, created_at`,
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
  if (user.auth_provider !== 'local') {
    throw Object.assign(new Error('Use Google sign-in for this account'), { status: 400 });
  }

  const valid = await bcrypt.compare(password, user.password_hash || '');
  if (!valid) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  return issueTokens(user);
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function refreshSession(refreshToken) {
  if (!refreshToken) throw Object.assign(new Error('Missing refresh token'), { status: 401 });
  const userId = await redis.get(`${REFRESH_PREFIX}${refreshToken}`);
  if (!userId) throw Object.assign(new Error('Invalid or expired refresh token'), { status: 401 });

  await redis.del(`${REFRESH_PREFIX}${refreshToken}`); // rotate
  const user = await getUserById(userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

  return issueTokens(user);
}

async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) return;
  await redis.del(`${REFRESH_PREFIX}${refreshToken}`);
}

async function getUserById(id) {
  const result = await pool.query('SELECT id, username, created_at, auth_provider FROM users WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function findUserByGoogle(googleSub, email) {
  const result = await pool.query(
    'SELECT id, username FROM users WHERE google_sub = $1 OR email = $2',
    [googleSub, email]
  );
  return result.rows[0] || null;
}

async function usernameExists(username) {
  const res = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
  return res.rowCount > 0;
}

function sanitizeUsername(raw) {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 32) || 'user';
}

async function generateGoogleUsername(base) {
  let attempt = sanitizeUsername(base);
  let counter = 0;
  while (await usernameExists(attempt)) {
    counter += 1;
    attempt = `${sanitizeUsername(base)}${counter}`;
    if (counter > 10) {
      attempt = `user${Math.floor(Math.random() * 10000)}`;
    }
  }
  return attempt;
}

async function createGoogleUser(payload) {
  const base = payload.email?.split('@')[0] || payload.name || 'user';
  const username = await generateGoogleUsername(base);
  const result = await pool.query(
    `INSERT INTO users (username, email, google_sub, auth_provider)
     VALUES ($1, $2, $3, 'google')
     RETURNING id, username`,
    [username, payload.email || null, payload.sub]
  );
  return result.rows[0];
}

async function loginWithGoogle(idToken) {
  if (!googleClient) {
    throw Object.assign(new Error('Google OAuth not configured'), { status: 500 });
  }
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    throw Object.assign(new Error('Invalid Google token'), { status: 401 });
  }

  if (!payload?.sub) {
    throw Object.assign(new Error('Invalid Google payload'), { status: 401 });
  }

  let user = await findUserByGoogle(payload.sub, payload.email);
  if (!user) user = await createGoogleUser(payload);

  return issueTokens(user);
}

module.exports = {
  register,
  login,
  loginWithGoogle,
  refreshSession,
  revokeRefreshToken,
  verifyToken,
  getUserById,
};
