require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const rateLimit = require('express-rate-limit');

const pool = require('./config/db');
const { runMigrations } = require('./db/migrate');
const { recoverStaleRooms } = require('./modules/rooms/service');
const { setupWebSocket } = require('./modules/websocket/handler');

const authRoutes = require('./modules/auth/routes');
const roomRoutes = require('./modules/rooms/routes');
const searchRoutes = require('./modules/search/routes');

const app = express();
const server = http.createServer(app);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api/', limiter);

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/search', searchRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[HTTP]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });
setupWebSocket(wss);

// ─── STARTUP ──────────────────────────────────────────────────────────────────
async function start() {
  try {
    await pool.query('SELECT 1'); // verify DB connection
    console.log('[DB] Connected');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }

  await runMigrations();
  await recoverStaleRooms();

  const PORT = parseInt(process.env.PORT || '4000');
  server.listen(PORT, () => {
    console.log(`[Server] Running on port ${PORT}`);
    console.log(`[Server] WS available at ws://localhost:${PORT}/ws`);
  });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down...');
  server.close(() => {
    pool.end();
    process.exit(0);
  });
});

start();
