# Spotify Jam Mode

A collaborative Spotify listening experience where a host controls playback and participants can add songs to the queue. Everyone hears the same music in real-time.

## Features

- 🎵 **Host-Controlled Playback** - Host creates room and controls the music
- 🔗 **Easy Joining** - Participants join with a simple 6-character code
- 📝 **Collaborative Queue** - Anyone can search and add tracks
- 🎧 **Real-Time Sync** - Everyone hears the same thing simultaneously
- 🌐 **Web-Based** - No app installation required
- ⚡ **Spotify Web Playback SDK** - Browser-based playback

## Architecture

This is a full-stack application consisting of:

- **Backend** (`/backend`) - Express.js server with PostgreSQL, OAuth, WebSocket
- **Frontend** (`/frontend`) - React application with Vite

Both components are designed to run independently but operate together when properly configured.

## Requirements

- Node.js 18+ or 20+
- PostgreSQL 12+
- Spotify Premium account (for hosts)
- Spotify Developer App credentials

## Quick Start

1. **Set up Spotify App**
   - Create app at [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - Note Client ID and Client Secret
   - Add redirect URI: `http://localhost:3001/api/auth/callback`

2. **Set up PostgreSQL**
   ```bash
   createdb spotify_jam
   ```

3. **Backend Setup**
   ```bash
   cd backend
   npm install
   cp .env.example .env
   # Edit .env with your credentials
   npm run migrate
   npm run dev
   ```

4. **Frontend Setup** (in new terminal)
   ```bash
   cd frontend
   npm install
   cp .env.example .env
   # Edit .env with your credentials
   npm run dev
   ```

5. **Access Application**
   - Open `http://localhost:3000`
   - Create a room as host or join an existing one

## Documentation

- **[DOC.md](DOC.md)** - Complete setup, configuration, and operations guide
- **[API_STANDARDS.md](API_STANDARDS.md)** - API endpoints, WebSocket events, and protocols

## Key Fixes Implemented

This implementation addresses all critical playback issues:

1. ✅ **SDK Initialization** - `onSpotifyWebPlaybackSDKReady` defined before script loads
2. ✅ **User Gesture Requirement** - Player connection requires button click
3. ✅ **Device Transfer** - Automatic transfer to Web SDK device after connection
4. ✅ **Token Refresh** - Backend manages OAuth refresh flow, SDK always gets fresh tokens
5. ✅ **Room Persistence** - PostgreSQL-backed rooms with heartbeat and cleanup
6. ✅ **Server Authority** - All state managed server-side, clients synchronized via WebSocket

## Browser Support

- Chrome 120+
- Safari 17+ (macOS and iOS)
- Firefox 121+
- Edge 120+

## Production Deployment

See [DOC.md](DOC.md) for production deployment instructions including:
- HTTPS requirements
- Environment configuration
- Database setup
- Scaling considerations

## License

Demonstration project. Ensure compliance with Spotify's Terms of Service.
