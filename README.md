# SpotiSync — Collaborative Listening Sessions

A full-stack web application that replicates Spotify's "Jam" mode. One host authenticates with Spotify, creates a session with a 6-character join code, and other users join the room to collaboratively search, queue tracks, and listen in sync via the Spotify Web Playback SDK.

## Architecture

```
spotisync/
├── server/                  # Express + Socket.io backend
│   ├── index.js             # Entry point
│   ├── routes/
│   │   ├── auth.js          # Spotify OAuth (PKCE)
│   │   ├── sessions.js      # Session CRUD
│   │   └── spotify.js       # Spotify API proxy (search, devices, player)
│   ├── socket/
│   │   └── index.js         # Real-time events (queue, playback, participants)
│   ├── store/
│   │   └── sessions.js      # In-memory session store
│   └── utils/
│       └── spotify.js       # Spotify API helpers + token refresh
├── client/                  # React + Vite frontend
│   ├── src/
│   │   ├── pages/           # Landing, Host, Join, Room pages
│   │   ├── components/      # NowPlaying, Queue, Search, Participants, HostControls
│   │   ├── hooks/           # useSpotifyPlayer (Web Playback SDK)
│   │   └── context/         # SocketContext (Socket.io client)
│   └── index.html           # Loads Spotify Playback SDK script
├── .env.example             # Environment template
└── package.json             # Root with dev scripts
```

## Features

- **Host Authentication** — OAuth 2.0 with Spotify, token refresh handled server-side
- **Session Management** — Create sessions with auto-generated 6-char join codes
- **Real-time Sync** — Socket.io for live queue updates, participant tracking, and playback state
- **Collaborative Queue** — Any participant can search Spotify and add tracks
- **Web Playback SDK** — Host's browser registers as a Spotify device; playback syncs to all SDK-connected clients
- **Host Controls** — Play/pause, skip, and queue management (host-only)
- **Auto Cleanup** — Sessions expire after 4 hours

## Prerequisites

- **Node.js** 18+
- **Spotify Developer Account** — Create an app at https://developer.spotify.com/dashboard
- **Spotify Premium** — Required for the Web Playback SDK

## Setup

### 1. Create a Spotify App

1. Go to https://developer.spotify.com/dashboard
2. Click **Create App**
3. Set the **Redirect URI** to `http://localhost:3001/api/auth/callback`
4. Note your **Client ID** and **Client Secret**

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your Spotify credentials:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3001/api/auth/callback
PORT=3001
CLIENT_URL=http://localhost:5173
```

### 3. Install Dependencies

```bash
npm run install:all
```

### 4. Run Development

```bash
npm run dev
```

This starts both the server (port 3001) and client (port 5173) concurrently.

### 5. Open the App

- Go to `http://localhost:5173`
- Click **Host a Session** → Sign in with Spotify
- Share the 6-character code with friends
- Friends click **Join a Room** → enter the code
- Everyone searches and queues tracks — the host controls playback

## Production Build

```bash
npm run build   # Builds client to client/dist
npm start       # Serves everything from the Express server
```

## Module Breakdown

| Module | Responsibility |
|--------|---------------|
| `server/routes/auth.js` | Spotify OAuth flow (login, callback, token exchange) |
| `server/routes/sessions.js` | Create/join/delete sessions |
| `server/routes/spotify.js` | Proxied Spotify API calls (search, devices, player state) |
| `server/socket/index.js` | Real-time: queue sync, playback commands, participant tracking |
| `server/store/sessions.js` | In-memory session store (swap for Redis in production) |
| `server/utils/spotify.js` | Spotify API helpers with automatic token refresh |
| `client/src/hooks/useSpotifyPlayer.js` | Web Playback SDK integration |
| `client/src/context/SocketContext.jsx` | Socket.io client provider |
| `client/src/pages/RoomPage.jsx` | Main collaborative room UI |

## Notes

- The in-memory session store resets on server restart. For production, replace with Redis or a database.
- Spotify Premium is required for the Web Playback SDK to function.
- The server proxies all Spotify API calls so client tokens are never exposed to participants.
