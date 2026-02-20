# DOC.md — Operational Guide

## External Dependencies

### YouTube Music Search (ytmusic-api)
- **Package:** `ytmusic-api` (npm)
- **Type:** Community reverse-engineered (NOT officially supported by Google/YouTube)
- **Risk:** May break without notice if YouTube Music changes its internal API
- **Usage:** Song search and metadata lookup only
- **Fallback:** If search fails, a 503 error is returned to the client. Replace `modules/search/service.js` to integrate an alternative (e.g., YouTube Data API v3)

### YouTube IFrame Player API
- **Source:** `https://www.youtube.com/iframe_api` (official)
- **Usage:** Browser-side video/audio playback
- **Constraints:** Content must be embeddable (some YouTube Music tracks have embedding disabled; error code 101/150 will surface). Autoplay requires user gesture on first interaction.

---

## Environment Variables

### Backend (`/backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP/WS server port |
| `NODE_ENV` | `development` | Environment mode |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `JWT_SECRET` | required | Secret for signing JWTs (min 32 chars) |
| `JWT_EXPIRES_IN` | `7d` | JWT expiry duration |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated CORS origins |
| `HEARTBEAT_INTERVAL_MS` | `10000` | Host heartbeat interval (ms) |
| `ROOM_TIMEOUT_MS` | `30000` | Room closure after no heartbeat (ms) |
| `DEFAULT_VOTE_THRESHOLD` | `0.5` | Default skip vote fraction |
| `VOTE_COOLDOWN_SEC` | `5` | Vote cooldown per user (seconds) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per IP |

### Frontend (`/frontend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:4000` | Backend API base URL |
| `VITE_WS_URL` | `ws://localhost:4000` | Backend WebSocket URL |

For production HTTPS/WSS, use `https://` and `wss://` URLs.

---

## PostgreSQL Setup

### Requirements
- PostgreSQL 14+ with `pgcrypto` extension enabled

### Create Database
```sql
CREATE DATABASE jammode;
\c jammode
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Apply Schema
The schema is auto-applied on server startup via `db/migrate.js`.

To apply manually:
```bash
psql -d jammode -f backend/db/schema.sql
```

### Recommended Connection String
```
postgresql://jamuser:password@localhost:5432/jammode
```

---

## Running the Backend

### Development
```bash
cd backend
cp .env.example .env
# Edit .env with your values
npm install
npm run dev
```

### Production
```bash
cd backend
npm install --production
NODE_ENV=production npm start
```

The server starts HTTP + WebSocket on `PORT`. No separate WS server needed.

---

## Running the Frontend

### Development
```bash
cd frontend
cp .env.example .env
# Edit .env with backend URLs
npm install
npm run dev
# Opens on http://localhost:5173
```

### Production Build
```bash
cd frontend
npm run build
# Serve the dist/ folder from any static host (Nginx, Vercel, Netlify, etc.)
```

For production, set `VITE_API_URL` and `VITE_WS_URL` to your deployed backend URLs before building.

---

## External Setup Steps

### 1. Database
Provision a PostgreSQL 14+ instance. Apply the schema (auto-applied on first run).

### 2. YouTube IFrame API
No configuration needed. The script is loaded from `https://www.youtube.com/iframe_api` in `index.html`. Ensure your domain is not blocked by YouTube's embedding policies.

### 3. CORS
Set `ALLOWED_ORIGINS` in backend to include your frontend domain(s).

### 4. HTTPS / WSS (Production)
- Use a reverse proxy (Nginx, Caddy, Traefik) to terminate TLS
- Backend sees plain HTTP internally, proxy handles TLS
- Set `VITE_API_URL=https://...` and `VITE_WS_URL=wss://...`

### 5. Safari / iOS Compatibility
- YouTube IFrame uses `playsinline: 1` for iOS Safari
- Autoplay is disabled by default; each client must tap "Tap to start audio"
- Users should not have Low Power Mode enabled (restricts autoplay further)

---

## Architecture Notes

```
/backend
  server.js              → Entry: Express + HTTP server + WebSocket server
  config/db.js           → PostgreSQL pool
  db/schema.sql          → Table definitions
  db/migrate.js          → Auto-migration on startup
  modules/
    auth/                → JWT auth: register, login, middleware
    rooms/               → Room lifecycle: create, join, close, heartbeat, settings
    playback/            → Playback state: in-memory cache + DB persistence
    voting/              → Vote tracking: in-memory + DB cooldown/dedup
    search/              → YouTube Music search via ytmusic-api
    websocket/           → WS handler: room coordination, event routing

/frontend
  src/
    context/
      AuthContext.jsx    → JWT auth state
      RoomContext.jsx    → WS connection + room/playback/queue state
    hooks/
      useWebSocket.js    → WS connection with auto-reconnect
    modules/
      auth/              → Login/register pages + API client
      player/            → YouTube IFrame player hook + UI
      room/              → Lobby, room page, members, settings
      queue/             → Queue display + controls
      search/            → Search UI
      voting/            → Vote bar display
```

Each module is independently replaceable. To swap the search backend, replace `modules/search/service.js` and keep the same interface (`search(q, limit)` → `TrackObject[]`).
