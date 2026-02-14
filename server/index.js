import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDatabase, setupSchema, closeDatabase } from './db/index.js';
import authRoutes from './routes/auth.js';
import sessionRoutes from './routes/sessions.js';
import spotifyRoutes from './routes/spotify.js';
import { setupSocket } from './socket/index.js';
import { sessionStore } from './store/sessions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] }
});

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

// Make io and session store accessible to routes
app.set('io', io);
app.set('sessionStore', sessionStore);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/spotify', spotifyRoutes);

// Serve built client in production
const clientBuild = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuild));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

// Socket.io
setupSocket(io, sessionStore);

// Initialize database and start server
async function startServer() {
  try {
    console.log('Initializing database...');
    initDatabase();
    await setupSchema();
    console.log('✓ Database ready');

    // Clean up any stale rooms on startup
    await sessionStore.cleanupStaleRooms(60000);
    console.log('✓ Cleaned up stale rooms');

    // Start cleanup intervals
    // Check for stale rooms every 10 seconds (rooms with no heartbeat for 30s)
    setInterval(async () => {
      try {
        const staleRooms = await sessionStore.cleanupStaleRooms(30000);
        if (staleRooms.length > 0) {
          // Notify clients that their rooms were closed
          for (const roomId of staleRooms) {
            io.to(roomId).emit('session:ended', { 
              reason: 'Room closed: Host disconnected' 
            });
          }
        }
      } catch (err) {
        console.error('Stale room cleanup error:', err);
      }
    }, 10000);

    // Clean up old rooms every 30 minutes (older than 4 hours)
    setInterval(async () => {
      try {
        await sessionStore.cleanupOldRooms();
      } catch (err) {
        console.error('Old room cleanup error:', err);
      }
    }, 30 * 60 * 1000);

    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => {
      console.log(`SpotiSync server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing server...');
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
});

startServer();
