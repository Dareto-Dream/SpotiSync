require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const cookieParser = require('cookie-parser');
const spotifyAuth = require('./spotifyAuth');
const WebSocketServer = require('./websocket');
const db = require('./db');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket server
new WebSocketServer(server);

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Spotify OAuth - Get authorization URL
app.get('/api/auth/login', (req, res) => {
  const authUrl = spotifyAuth.getAuthUrl();
  res.json({ url: authUrl });
});

// Spotify OAuth - Handle callback
app.get('/api/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  
  if (error) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=auth_failed`);
  }
  
  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=missing_code`);
  }
  
  try {
    const tokens = await spotifyAuth.exchangeCode(code);
    
    // Set secure cookie with user info
    res.cookie('spotify_user', JSON.stringify({
      userId: tokens.userId,
      displayName: tokens.displayName
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });
    
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=token_exchange_failed`);
  }
});

// Get current user
app.get('/api/auth/me', (req, res) => {
  const userCookie = req.cookies.spotify_user;
  
  if (!userCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const user = JSON.parse(userCookie);
    res.json(user);
  } catch (error) {
    res.status(401).json({ error: 'Invalid session' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('spotify_user');
  res.json({ success: true });
});

// Get fresh access token
app.get('/api/auth/token', async (req, res) => {
  const userCookie = req.cookies.spotify_user;
  
  if (!userCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  try {
    const user = JSON.parse(userCookie);
    const accessToken = await spotifyAuth.getFreshToken(user.userId);
    
    res.json({ accessToken });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// Transfer playback to device
app.post('/api/playback/transfer', async (req, res) => {
  const userCookie = req.cookies.spotify_user;
  const { deviceId } = req.body;
  
  if (!userCookie) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  if (!deviceId) {
    return res.status(400).json({ error: 'Missing deviceId' });
  }
  
  try {
    const user = JSON.parse(userCookie);
    const success = await spotifyAuth.transferPlayback(user.userId, deviceId);
    
    res.json({ success });
  } catch (error) {
    console.error('Playback transfer error:', error);
    res.status(500).json({ error: 'Failed to transfer playback' });
  }
});

// Database initialization endpoint (for setup)
app.post('/api/admin/init-db', async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(schema);
    res.json({ success: true, message: 'Database initialized' });
  } catch (error) {
    console.error('Database initialization error:', error);
    res.status(500).json({ error: 'Failed to initialize database' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log(`Redirect URI: ${process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
