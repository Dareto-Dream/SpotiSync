# Spotify Jam Mode - Documentation

## System Requirements

- Node.js 18+ or 20+
- PostgreSQL 12+
- Spotify Premium account (for hosts)
- Modern web browser (Chrome, Safari, Firefox, Edge)

## Spotify App Configuration

### 1. Create Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click "Create app"
3. Fill in:
   - **App name:** Spotify Jam Mode
   - **App description:** Collaborative listening experience
   - **Redirect URI:** `http://localhost:3001/api/auth/callback`
   - **Web API:** Yes

4. Save and note your:
   - **Client ID**
   - **Client Secret**

### 2. Required Scopes

The application automatically requests these scopes:
- `streaming` - Web Playback SDK
- `user-read-email` - User identification
- `user-read-private` - User identification
- `user-read-playback-state` - Read playback state
- `user-modify-playback-state` - Control playback
- `user-read-currently-playing` - Current track info
- `playlist-read-private` - Playlist access
- `playlist-read-collaborative` - Collaborative playlist access

## PostgreSQL Setup

### 1. Install PostgreSQL

**macOS (Homebrew):**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
```

**Windows:**
Download installer from [postgresql.org](https://www.postgresql.org/download/windows/)

### 2. Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database
CREATE DATABASE spotify_jam;

# Create user (optional)
CREATE USER jam_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE spotify_jam TO jam_user;

# Exit
\q
```

### 3. Database URL Format

```
postgresql://username:password@host:port/database
```

Example:
```
postgresql://jam_user:your_password@localhost:5432/spotify_jam
```

Or use default:
```
postgresql://localhost:5432/spotify_jam
```

## Backend Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Database Configuration
DATABASE_URL=postgresql://localhost:5432/spotify_jam

# Spotify OAuth Configuration
SPOTIFY_CLIENT_ID=your_client_id_from_spotify
SPOTIFY_CLIENT_SECRET=your_client_secret_from_spotify
SPOTIFY_REDIRECT_URI=http://localhost:3001/api/auth/callback

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000

# Session Configuration
SESSION_SECRET=generate_random_string_here

# Room Configuration (optional)
ROOM_HEARTBEAT_INTERVAL=5000
ROOM_TIMEOUT=15000
```

**Important:** Replace placeholder values with actual credentials.

### 3. Run Database Migrations

```bash
npm run migrate
```

This creates all required tables:
- `rooms`
- `room_members`
- `queue_items`
- `auth_tokens`
- `migrations`

### 4. Start Backend Server

**Development (with auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server runs on `http://localhost:3001`

### Verify Backend

```bash
curl http://localhost:3001/api/health
```

Should return:
```json
{"status":"ok","timestamp":"..."}
```

## Frontend Setup

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Backend API URL
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001

# Spotify Configuration
VITE_SPOTIFY_CLIENT_ID=your_client_id_from_spotify
```

### 3. Start Frontend

**Development:**
```bash
npm run dev
```

Frontend runs on `http://localhost:3000`

**Production Build:**
```bash
npm run build
npm run preview
```

## Usage Flow

### Host Creating a Room

1. Open `http://localhost:3000`
2. Click "Start Hosting"
3. Enter display name
4. Click "Connect with Spotify"
5. Authorize the application
6. Click "Create Room"
7. Share the 6-character room code with participants

### Host Player Setup

1. In the room, wait for "Player ready to connect"
2. **IMPORTANT:** Click "Connect Player" button
   - This is required for browser audio permissions
   - Player will not work without this user interaction
3. Wait for "Connected" status
4. Player device is now registered with Spotify
5. Playback will transfer to the browser automatically

### Participants Joining

1. Open `http://localhost:3000`
2. Enter display name
3. Enter room code
4. Click "Join Room"
5. Search and add songs to queue
6. Playback syncs automatically from host

### Playback Synchronization

- Host controls playback via browser player or Spotify app
- Host's playback state syncs to all participants every 1-2 seconds
- Participants see current track, progress, and play/pause state
- If participant reloads, state resyncs on rejoin
- If host disconnects, room closes and all participants are notified

## Production Deployment

### Environment Variables

**Backend:**
- Update `FRONTEND_URL` to production domain
- Update `SPOTIFY_REDIRECT_URI` to production callback URL
- Use strong `SESSION_SECRET`
- Set `NODE_ENV=production`
- Use secure PostgreSQL connection (SSL)

**Frontend:**
- Update `VITE_API_URL` to production backend
- Update `VITE_WS_URL` to production WebSocket (wss://)

### HTTPS Requirements

Spotify Web Playback SDK requires HTTPS in production:
- Backend must use HTTPS
- Frontend must use HTTPS
- WebSocket must use WSS (secure WebSocket)

### Spotify App Settings

Update Redirect URI in Spotify Dashboard to production URL:
```
https://your-backend-domain.com/api/auth/callback
```

### Database

- Use connection pooling (already configured)
- Enable SSL for PostgreSQL in production
- Regular backups of `auth_tokens` and `rooms` tables
- Monitor `last_heartbeat` for stale rooms

### Scaling Considerations

- Backend can scale horizontally with session affinity for WebSocket
- Use Redis for shared WebSocket state if needed
- PostgreSQL handles concurrent room management
- Consider rate limiting for API endpoints

## Troubleshooting

### SDK Initialization Fails

**Error:** `onSpotifyWebPlaybackSDKReady is not defined`

**Solution:** Fixed in codebase. Callback is defined before SDK script loads.

### Player Won't Connect

**Error:** AudioContext blocked or player connection fails

**Cause:** Browser blocks audio without user gesture

**Solution:** Click "Connect Player" button in UI. This is required.

### No Playback After Connection

**Issue:** Device ID captured but no audio

**Solution:** 
1. Check if device appears in Spotify's device list
2. Verify device transfer was successful
3. Try starting playback from Spotify app
4. Check browser console for errors

### Token Expired

**Error:** 401 errors from Spotify API

**Solution:** Backend automatically refreshes tokens. Check:
- `auth_tokens` table has refresh_token
- `SPOTIFY_CLIENT_SECRET` is correct
- User hasn't revoked app access

### Room Won't Close

**Issue:** Ghost rooms after host disconnect

**Solution:** 
- Heartbeat timeout configured (15s default)
- Cleanup runs every 5 seconds
- Check `last_heartbeat` timestamps in database

### Safari Issues

**iOS Safari:**
- Requires user tap to start audio
- May need AudioContext resume
- WebSocket connection may be unstable on poor networks

**Desktop Safari:**
- Same as other browsers
- Ensure HTTPS in production

### WebSocket Reconnection

If WebSocket disconnects:
- Client attempts reconnection (5 attempts, exponential backoff)
- State resyncs on reconnection
- Users see connection status indicator

### Database Connection

**Error:** Connection refused or timeout

**Solution:**
1. Verify PostgreSQL is running: `pg_isready`
2. Check `DATABASE_URL` format
3. Verify user permissions: `GRANT ALL ON DATABASE`
4. Check firewall/network settings

## File Structure

```
spotify-jam/
├── backend/
│   ├── src/
│   │   ├── database/
│   │   │   ├── db.js
│   │   │   └── migrate.js
│   │   ├── modules/
│   │   │   ├── auth.js
│   │   │   ├── room.js
│   │   │   └── playback.js
│   │   ├── routes/
│   │   │   └── api.js
│   │   ├── websocket/
│   │   │   └── handler.js
│   │   └── server.js
│   ├── package.json
│   └── .env
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.js
│   │   │   └── websocket.js
│   │   ├── components/
│   │   │   ├── NowPlaying.jsx
│   │   │   ├── Queue.jsx
│   │   │   ├── Search.jsx
│   │   │   └── Members.jsx
│   │   ├── context/
│   │   │   └── AppContext.jsx
│   │   ├── hooks/
│   │   │   └── useSpotifyPlayer.js
│   │   ├── pages/
│   │   │   ├── Home.jsx
│   │   │   ├── Host.jsx
│   │   │   ├── Callback.jsx
│   │   │   └── Room.jsx
│   │   ├── styles/
│   │   │   ├── Home.css
│   │   │   ├── Host.css
│   │   │   ├── Room.css
│   │   │   └── Global.css
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   ├── package.json
│   └── .env
│
├── API_STANDARDS.md
└── DOC.md
```

## Architecture Notes

### Modular Design

Each module is independent and replaceable:
- **auth.js** - OAuth and token management
- **room.js** - Room lifecycle and state
- **playback.js** - Spotify API integration
- **websocket/** - Real-time communication

### Server Authority

- Room state stored in PostgreSQL
- Server is source of truth for all state
- Clients receive state updates via WebSocket
- No client-side state conflicts

### Token Management

- Tokens stored in database, not browser
- Backend refreshes tokens automatically
- Frontend requests fresh token when needed
- SDK always receives valid token

### Browser Compatibility

Tested on:
- Chrome 120+
- Safari 17+ (macOS and iOS)
- Firefox 121+
- Edge 120+

## Support

For issues related to:
- **Spotify API:** [Spotify Web API Documentation](https://developer.spotify.com/documentation/web-api)
- **Web Playback SDK:** [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)
- **PostgreSQL:** [PostgreSQL Documentation](https://www.postgresql.org/docs/)

## License

This is a demonstration project. Ensure compliance with Spotify's Terms of Service for production use.
