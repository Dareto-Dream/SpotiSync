import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import apiRoutes from './routes/api.js';
import { initWebSocket } from './websocket/handler.js';
import { initRoomCleanup } from './modules/room.js';

dotenv.config();

const app = express();
const server = createServer(app);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// API routes
app.use('/api', apiRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Spotify Jam Mode API',
    version: '1.0.0',
    status: 'running'
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Initialize WebSocket
initWebSocket(server);

// Initialize room cleanup
initRoomCleanup();

// Start server
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║   Spotify Jam Mode Backend Server        ║
╚═══════════════════════════════════════════╝

Server running on port ${PORT}
Environment: ${process.env.NODE_ENV || 'development'}
Frontend URL: ${process.env.FRONTEND_URL}
WebSocket path: /ws

API Endpoints:
- POST   /api/rooms/create
- GET    /api/rooms/:roomCode
- POST   /api/rooms/:roomCode/join
- GET    /api/rooms/:roomCode/queue
- POST   /api/rooms/:roomCode/queue
- DELETE /api/rooms/:roomCode/queue/:id
- GET    /api/search
- GET    /api/auth/login
- GET    /api/auth/callback
- GET    /api/auth/refresh
- GET    /api/health

Ready to accept connections!
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
