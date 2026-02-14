# API Standards — SpotiSync

Complete specification for all HTTP endpoints and WebSocket events in the SpotiSync system.

---

## HTTP API Endpoints

### Authentication

#### `GET /api/auth/login`
Initiates Spotify OAuth flow. Redirects to Spotify authorization.

**Response**: 302 Redirect to Spotify

---

#### `GET /api/auth/callback`
OAuth callback endpoint. Exchanges authorization code for tokens.

**Query Parameters**:
- `code` (string): Authorization code from Spotify
- `state` (string): CSRF protection token
- `error` (string, optional): Error from Spotify

**Response**: 302 Redirect to `/host` with tokens in query params

---

#### `GET /api/auth/client-id`
Returns Spotify client ID for Web Playback SDK.

**Response**:
```json
{
  "clientId": "string"
}
```

---

### Sessions

#### `POST /api/sessions`
Creates a new session (host only).

**Request Body**:
```json
{
  "accessToken": "string",
  "refreshToken": "string",
  "expiresIn": "number"
}
```

**Response** (201):
```json
{
  "sessionId": "string",
  "joinCode": "string"
}
```

**Errors**:
- 400: Missing accessToken
- 500: Database error

---

#### `GET /api/sessions/join/:code`
Looks up session by join code.

**Parameters**:
- `code` (string): 6-character join code (case-insensitive)

**Response** (200):
```json
{
  "sessionId": "string",
  "joinCode": "string",
  "participantCount": "number",
  "queueLength": "number",
  "nowPlaying": "object|null"
}
```

**Errors**:
- 404: Session not found
- 500: Database error

---

#### `GET /api/sessions/:id`
Gets full session state.

**Parameters**:
- `id` (string): Session ID

**Response** (200):
```json
{
  "sessionId": "string",
  "joinCode": "string",
  "queue": "array",
  "nowPlaying": "object|null",
  "participants": "array"
}
```

**Errors**:
- 404: Session not found

---

#### `DELETE /api/sessions/:id`
Ends a session (host only).

**Parameters**:
- `id` (string): Session ID

**Response** (200):
```json
{
  "ok": true
}
```

**Errors**:
- 404: Session not found

---

### Spotify API Proxy

#### `GET /api/spotify/search`
Searches Spotify catalog.

**Query Parameters**:
- `q` (string, required): Search query
- `sessionId` (string, required): Session ID
- `type` (string): Search type (default: "track")
- `limit` (number): Result limit (default: 20)

**Response**: Spotify search results

**Errors**:
- 400: Missing parameters
- 404: Session not found
- 401: Spotify auth error

---

#### `GET /api/spotify/me`
Gets host profile.

**Query Parameters**:
- `sessionId` (string, required): Session ID

**Response**: Spotify user profile

**Errors**:
- 400: Missing sessionId
- 404: Session not found

---

#### `GET /api/spotify/devices`
Lists available playback devices.

**Query Parameters**:
- `sessionId` (string, required): Session ID

**Response**: Spotify devices list

---

#### `GET /api/spotify/player`
Gets current playback state.

**Query Parameters**:
- `sessionId` (string, required): Session ID

**Response**: Spotify player state or `null`

---

## WebSocket Events

### Client → Server

#### `session:join`
Join a session room.

**Payload**:
```json
{
  "sessionId": "string",
  "name": "string",
  "isHost": "boolean"
}
```

**Server Response**: `session:state` event

---

#### `queue:add`
Add track to queue.

**Payload**:
```json
{
  "sessionId": "string",
  "track": {
    "uri": "string",
    "name": "string",
    "artists": "array",
    "album": "object",
    "duration_ms": "number",
    "albumArt": "string"
  }
}
```

**Server Response**: `queue:updated` broadcast

---

#### `queue:remove`
Remove track from queue (host only).

**Payload**:
```json
{
  "sessionId": "string",
  "queueId": "string"
}
```

**Server Response**: `queue:updated` broadcast or `error`

---

#### `playback:transferDevice`
Transfer playback to Web SDK device (host only).

**Payload**:
```json
{
  "sessionId": "string",
  "deviceId": "string"
}
```

**Server Response**: `playback:deviceTransferred` or `error`

---

#### `playback:play`
Start playback of specific track or resume (host only).

**Payload**:
```json
{
  "sessionId": "string",
  "uri": "string|null",
  "deviceId": "string"
}
```

**Server Response**: `playback:state` broadcast

---

#### `playback:next`
Play next track from queue (host only).

**Payload**:
```json
{
  "sessionId": "string",
  "deviceId": "string"
}
```

**Server Response**: `playback:state` and `queue:updated` broadcast

---

#### `playback:pause`
Pause playback (host only).

**Payload**:
```json
{
  "sessionId": "string"
}
```

**Server Response**: `playback:state` broadcast

---

#### `auth:updateToken`
Update host's access token (host only).

**Payload**:
```json
{
  "sessionId": "string",
  "accessToken": "string",
  "expiresIn": "number"
}
```

---

### Server → Client

#### `session:state`
Initial session state sent to joining client.

**Payload**:
```json
{
  "queue": "array",
  "nowPlaying": "object|null",
  "participants": "array"
}
```

---

#### `session:participants`
Participant list update (broadcast).

**Payload**:
```json
{
  "participants": [
    {
      "name": "string",
      "joinedAt": "number"
    }
  ]
}
```

---

#### `session:ended`
Session closed notification (broadcast).

**Payload**:
```json
{
  "reason": "string"
}
```

**Reasons**:
- "Room closed: Host disconnected"
- "Host ended the session"

---

#### `queue:updated`
Queue changed (broadcast).

**Payload**:
```json
{
  "queue": [
    {
      "queueId": "string",
      "uri": "string",
      "name": "string",
      "artists": "array",
      "album": "object",
      "duration_ms": "number",
      "albumArt": "string",
      "addedAt": "number"
    }
  ]
}
```

---

#### `playback:state`
Playback state changed (broadcast).

**Payload**:
```json
{
  "isPlaying": "boolean",
  "nowPlaying": "object|null"
}
```

---

#### `playback:deviceTransferred`
Device transfer confirmed (to requesting client only).

**Payload**:
```json
{
  "deviceId": "string"
}
```

---

#### `error`
Error message (to requesting client only).

**Payload**:
```json
{
  "message": "string"
}
```

**Common Errors**:
- "Session not found"
- "Only the host can control playback"
- "Only the host can remove tracks"
- "Queue is empty"
- "Failed to connect to Spotify"

---

## Room Lifecycle Rules

### Room Creation
1. Host calls `POST /api/sessions` with Spotify tokens
2. Server creates room in database with `active` status
3. Server returns session ID and join code
4. Room marked with initial heartbeat timestamp

### Room Active State
1. Host joins via WebSocket (`session:join` with `isHost: true`)
2. Server updates heartbeat every 5 seconds while host is connected
3. Members can join while `status = 'active'`

### Room Closure Triggers
1. **Host Disconnect**: WebSocket disconnect from host socket
   - Server sets `status = 'closed'`
   - Server deletes all members and queue items
   - Server broadcasts `session:ended` with reason "Room closed: Host disconnected"
   - All clients are forced back to lobby

2. **Heartbeat Timeout**: Room heartbeat not updated for 30 seconds
   - Background job detects stale room
   - Server closes room (same as host disconnect)
   - Broadcasts closure message to all clients

3. **Manual Close**: Host calls `DELETE /api/sessions/:id`
   - Server closes room gracefully
   - Broadcasts "Host ended the session"

### Server Restart Recovery
- On startup, server checks for rooms with stale heartbeats (>60s)
- Closes all stale rooms to prevent ghost rooms
- No rooms persist without active heartbeat

### Database Consistency
- All room state stored in PostgreSQL
- In-memory tracking of which socket is host per room
- Room closure cascades delete to `room_members` and `queue_items`
- Old rooms (>4 hours) cleaned up periodically

---

## Error Codes

| HTTP Code | Meaning |
|-----------|---------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (Spotify API) |
| 400 | Bad Request (missing parameters) |
| 401 | Unauthorized (Spotify token issues) |
| 404 | Not Found (session doesn't exist) |
| 500 | Internal Server Error |

## Rate Limits

- WebSocket heartbeat: Every 5 seconds
- Stale room check: Every 10 seconds
- Old room cleanup: Every 30 minutes
- Spotify API: Subject to Spotify's rate limits

## Authentication

- Host: Requires valid Spotify Premium account OAuth token
- Guest: No authentication required
- All Spotify API calls use host's token with automatic refresh
