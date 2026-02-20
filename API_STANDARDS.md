# API_STANDARDS.md

## Base URL

All HTTP endpoints: `http[s]://<backend-host>/api`
WebSocket endpoint: `ws[s]://<backend-host>/ws`

---

## Authentication

All protected HTTP endpoints require:
```
Authorization: Bearer <JWT>
```

JWT payload: `{ sub: userId, username, iat, exp }`

---

## HTTP Endpoints

### Auth

#### POST /api/auth/register
```json
Body:    { "username": "string (2-64)", "password": "string (min 6)" }
Success: 201 { "user": { "id", "username", "created_at" } }
Errors:  400 (validation), 409 (username taken)
```

#### POST /api/auth/login
```json
Body:    { "username": "string", "password": "string" }
Success: 200 { "token": "JWT", "user": { "id", "username" } }
Errors:  401 (invalid credentials)
```

#### GET /api/auth/me
```json
Headers: Authorization: Bearer <JWT>
Success: 200 { "user": { "id", "username" } }
Errors:  401 (invalid/expired token)
```

---

### Rooms

#### POST /api/rooms
Create a new room (caller becomes host).
```json
Body:    { "settings": { ...optional overrides } }
Success: 201 { "room": RoomObject }
Errors:  401
```

#### GET /api/rooms/code/:code
Validate a join code before connecting.
```json
Success: 200 { "room": RoomObject }
Errors:  404 (not found/inactive)
```

#### GET /api/rooms/:roomId
```json
Success: 200 { "room": RoomObject }
Errors:  404
```

#### GET /api/rooms/:roomId/members
```json
Success: 200 { "members": [ { "id", "username", "joined_at" } ] }
```

#### PATCH /api/rooms/:roomId/settings (Host only)
```json
Body:    Partial<RoomSettings>
Success: 200 { "room": RoomObject }
Errors:  403 (not host), 404
```

#### DELETE /api/rooms/:roomId (Host only)
```json
Success: 200 { "message": "Room closed" }
Errors:  403, 404
```

---

### Search

#### GET /api/search?q=<query>&limit=<number>
```json
Success: 200 { "results": [ TrackObject, ... ] }
Errors:  400 (missing q), 503 (search backend unavailable)
```

#### GET /api/search/track/:videoId
```json
Success: 200 { "track": TrackObject }
Errors:  404
```

---

## Object Schemas

### RoomObject
```json
{
  "id": "uuid",
  "joinCode": "XXXXXX",
  "hostId": "uuid",
  "hostUsername": "string",
  "isActive": true,
  "createdAt": "ISO8601",
  "settings": RoomSettings
}
```

### RoomSettings
```json
{
  "userSkipMode": "vote" | "instant",
  "userPrevMode": "vote" | "instant",
  "voteThreshold": 0.5,        // fraction [0.1 - 1.0]
  "voteCooldownSec": 5,        // integer, 0 = no cooldown
  "userQueueing": true,        // users can add to queue
  "userReordering": false,     // users can reorder queue
  "userRemoval": false         // users can remove from queue
}
```

### TrackObject
```json
{
  "videoId": "string",         // YouTube video ID
  "title": "string",
  "artist": "string",
  "album": "string | null",
  "durationMs": 240000,
  "thumbnailUrl": "string | null",
  "isExplicit": false
}
```

### PlaybackState
```json
{
  "currentItem": TrackObject | null,
  "positionMs": 0,             // position when serverTime was recorded
  "serverTime": 1700000000000, // unix ms when position was recorded
  "isPlaying": true,
  "queue": [ TrackObject, ... ]
}
```

Live client position = `positionMs + (Date.now() - serverTime)` when `isPlaying`.

---

## WebSocket Protocol

Connect: `ws://<host>/ws?token=<JWT>`

Messages are JSON objects:
```json
{ "event": "event_name", "data": {}, "ts": 1700000000000 }
```

---

### Client → Server Events (C2S)

| Event | Data | Description |
|-------|------|-------------|
| `join_room` | `{ code: "XXXXXX" }` | Join a room by code |
| `leave_room` | `{}` | Leave current room |
| `host_heartbeat` | `{}` | Host keepalive (every 10s) |
| `playback_play` | `{}` | **Host only.** Resume playback |
| `playback_pause` | `{ positionMs }` | **Host only.** Pause at position |
| `playback_seek` | `{ positionMs }` | **Host only.** Seek to position |
| `playback_skip` | `{ trackId }` | Skip current track (host instant; user vote-based) |
| `playback_prev` | `{ trackId }` | Prev / restart (host instant; user vote-based) |
| `playback_position_report` | `{ clientTime }` | Client drift report |
| `queue_add` | `{ item: TrackObject }` | Add track to queue |
| `queue_remove` | `{ index }` | Remove track at index |
| `queue_reorder` | `{ fromIndex, toIndex }` | Reorder queue |
| `queue_play_now` | `{ index }` | **Host only.** Play queue item immediately |
| `vote` | `{ action: "skip"|"prev", trackId }` | Cast vote |
| `settings_update` | `{ settings: Partial<RoomSettings> }` | **Host only.** Update settings |

---

### Server → Client Events (S2C)

| Event | Data | Description |
|-------|------|-------------|
| `connected` | `{ userId, username }` | WS connection established |
| `error` | `{ code, message }` | Error response |
| `room_state` | `{ room, playback, members, isHost }` | Full state on join/rejoin |
| `member_joined` | `{ user: { id, username }, memberCount }` | New member |
| `member_left` | `{ user: { id, username }, memberCount }` | Member left |
| `room_closed` | `{ reason }` | Room closed (all clients) |
| `settings_updated` | `{ settings: RoomSettings }` | Settings changed |
| `playback_state` | `PlaybackState` | Play/pause state change |
| `playback_seek` | `PlaybackState` | Seek event |
| `now_playing` | `PlaybackState` | Track changed |
| `queue_updated` | `{ queue: TrackObject[] }` | Queue changed |
| `vote_update` | `{ action, trackId, voteCount, memberCount, threshold, passed }` | Vote progress |
| `vote_passed` | `{ action, trackId }` | Vote threshold met |

---

## Error Codes

### HTTP
| Status | Meaning |
|--------|---------|
| 400 | Bad request / validation error |
| 401 | Unauthenticated |
| 403 | Forbidden (wrong role) |
| 404 | Not found |
| 409 | Conflict (e.g., duplicate username) |
| 429 | Rate limited |
| 500 | Internal server error |
| 503 | External service unavailable |

### WebSocket Error Codes
| Code | Meaning |
|------|---------|
| `AUTH_FAILED` | Token invalid |
| `ROOM_NOT_FOUND` | Room not found or inactive |
| `FORBIDDEN` | Action not permitted for role |
| `INVALID` | Missing or invalid data |
| `VOTE_ERROR` | Vote rejected (cooldown, duplicate) |
| `UNKNOWN_EVENT` | Unrecognized event name |
| `SERVER_ERROR` | Unexpected server error |

---

## Room Lifecycle Rules

1. Host creates room → room marked `is_active = true` in DB
2. Host sends `host_heartbeat` every `HEARTBEAT_INTERVAL_MS` (default 10s)
3. If heartbeat not received for `ROOM_TIMEOUT_MS` (default 30s): room closed in DB
4. On server startup: all rooms with stale heartbeats are closed (ghost room recovery)
5. Host WS disconnect → room immediately closed, `room_closed` broadcast to all members
6. Member WS disconnect → member removed, `member_left` broadcast

---

## Voting Rules and Thresholds

- Actions subject to voting: `skip`, `prev` (when `userSkipMode`/`userPrevMode` = `"vote"`)
- Default threshold: 50% of currently connected members (`voteThreshold = 0.5`)
- Minimum: 1 vote always counts (avoids dead-lock in single-user rooms)
- Votes are deduplicated: one vote per (user, action, trackId) per room session
- Votes reset when:
  - Track changes (`now_playing` event)
  - Host changes voting mode via `settings_update`
  - Vote passes and action is executed
- Cooldown: `voteCooldownSec` seconds between any votes by the same user (server-enforced)
- Host skip/prev: always instant, bypasses voting entirely

---

## Rate Limiting

- All `/api/*` routes: 100 requests per 60s per IP (configurable)
- WS vote events: additionally throttled by `voteCooldownSec` per user
