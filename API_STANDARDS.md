# API Standards

## REST API Endpoints

### Authentication

#### GET /api/auth/login
Get Spotify OAuth authorization URL.

**Query Parameters:**
- `state` (optional): State parameter for OAuth flow

**Response:**
```json
{
  "authUrl": "https://accounts.spotify.com/authorize?..."
}
```

#### GET /api/auth/callback
OAuth callback endpoint (redirects to frontend).

**Query Parameters:**
- `code`: Authorization code from Spotify
- `state`: State parameter

**Behavior:**
- Exchanges code for tokens
- Stores tokens in database
- Redirects to frontend with user info

#### GET /api/auth/refresh
Refresh access token for a user.

**Query Parameters:**
- `userId`: User ID

**Response:**
```json
{
  "accessToken": "BQC..."
}
```

**Errors:**
- 400: Missing userId
- 401: Failed to refresh token

#### GET /api/auth/profile
Get user's Spotify profile.

**Query Parameters:**
- `userId`: User ID

**Response:**
```json
{
  "id": "user123",
  "display_name": "John Doe",
  "email": "john@example.com",
  ...
}
```

### Room Management

#### POST /api/rooms/create
Create a new room (host only).

**Request Body:**
```json
{
  "hostId": "user123",
  "displayName": "John Doe"
}
```

**Response:**
```json
{
  "roomId": 1,
  "roomCode": "ABCD12",
  "hostId": "user123"
}
```

**Errors:**
- 400: Missing required fields
- 500: Failed to create room

#### GET /api/rooms/:roomCode
Get room details.

**Response:**
```json
{
  "room": {
    "id": 1,
    "room_code": "ABCD12",
    "host_id": "user123",
    "is_active": true,
    "current_track_uri": "spotify:track:...",
    "current_track_position_ms": 45000,
    "is_playing": true,
    "device_id": "abc123..."
  },
  "members": [...],
  "queue": [...]
}
```

**Errors:**
- 404: Room not found
- 500: Server error

#### POST /api/rooms/:roomCode/join
Join a room as a participant.

**Request Body:**
```json
{
  "userId": "guest_123",
  "displayName": "Jane Doe"
}
```

**Response:**
```json
{
  "room": {...},
  "members": [...]
}
```

**Errors:**
- 400: Missing required fields or room not active
- 404: Room not found

### Queue Management

#### GET /api/rooms/:roomCode/queue
Get room queue.

**Response:**
```json
{
  "queue": [
    {
      "id": 1,
      "track_uri": "spotify:track:...",
      "track_name": "Song Title",
      "artist_name": "Artist Name",
      "album_name": "Album Name",
      "duration_ms": 210000,
      "added_by": "user123",
      "position": 0
    }
  ]
}
```

#### POST /api/rooms/:roomCode/queue
Add track to queue.

**Request Body:**
```json
{
  "track": {
    "uri": "spotify:track:...",
    "name": "Song Title",
    "artists": "Artist Name",
    "album": "Album Name",
    "durationMs": 210000
  },
  "addedBy": "user123"
}
```

**Response:**
```json
{
  "queue": [...]
}
```

#### DELETE /api/rooms/:roomCode/queue/:queueItemId
Remove track from queue (host only).

**Response:**
```json
{
  "queue": [...]
}
```

### Search

#### GET /api/search
Search Spotify tracks.

**Query Parameters:**
- `q`: Search query
- `userId`: User ID (for token)

**Response:**
```json
{
  "results": [
    {
      "uri": "spotify:track:...",
      "id": "123",
      "name": "Song Title",
      "artists": "Artist Name",
      "album": "Album Name",
      "albumArt": "https://...",
      "durationMs": 210000,
      "previewUrl": "https://..."
    }
  ]
}
```

### Health Check

#### GET /api/health
Server health check.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-02-15T12:00:00.000Z"
}
```

---

## WebSocket Events

### Connection
**URL:** `ws://localhost:3001/ws`

All WebSocket messages follow this format:
```json
{
  "type": "event_name",
  "payload": {...}
}
```

### Client → Server Events

#### join_room
Join a room.

**Payload:**
```json
{
  "roomCode": "ABCD12",
  "userId": "user123",
  "displayName": "John Doe",
  "isHost": false
}
```

#### leave_room
Leave current room.

**Payload:** `{}`

#### heartbeat
Host heartbeat to keep room alive.

**Payload:** `{}`

#### search_tracks
Search for tracks.

**Payload:**
```json
{
  "query": "song name"
}
```

#### add_to_queue
Add track to queue.

**Payload:**
```json
{
  "track": {
    "uri": "spotify:track:...",
    "name": "Song Title",
    "artists": "Artist Name",
    "album": "Album Name",
    "durationMs": 210000
  }
}
```

#### remove_from_queue
Remove track from queue (host only).

**Payload:**
```json
{
  "queueItemId": 1
}
```

#### playback_control
Control playback (host only).

**Payload:**
```json
{
  "action": "play|pause|next|previous|seek",
  "deviceId": "abc123...",
  "trackUri": "spotify:track:..." (optional),
  "positionMs": 45000 (optional)
}
```

#### sync_playback
Sync playback state (host only).

**Payload:**
```json
{
  "state": {
    "trackUri": "spotify:track:...",
    "positionMs": 45000,
    "isPlaying": true,
    "deviceId": "abc123..."
  }
}
```

#### transfer_device
Transfer playback to device (host only).

**Payload:**
```json
{
  "deviceId": "abc123..."
}
```

#### request_token
Request fresh access token.

**Payload:** `{}`

### Server → Client Events

#### room_joined
Confirmation of room join.

**Payload:**
```json
{
  "roomCode": "ABCD12",
  "room": {...},
  "members": [...],
  "queue": [...]
}
```

#### member_joined
New member joined room.

**Payload:**
```json
{
  "userId": "user123",
  "displayName": "John Doe",
  "isHost": false
}
```

#### member_left
Member left room.

**Payload:**
```json
{
  "userId": "user123"
}
```

#### queue_updated
Queue was updated.

**Payload:**
```json
{
  "queue": [...]
}
```

#### playback_state
Synced playback state from host.

**Payload:**
```json
{
  "trackUri": "spotify:track:...",
  "positionMs": 45000,
  "isPlaying": true,
  "deviceId": "abc123..."
}
```

#### playback_changed
Playback control action performed.

**Payload:**
```json
{
  "action": "play|pause|next|previous|seek",
  "deviceId": "abc123...",
  "trackUri": "spotify:track:...",
  "positionMs": 45000
}
```

#### room_closed
Room was closed.

**Payload:**
```json
{
  "reason": "Host disconnected"
}
```

#### device_transferred
Device transfer completed.

**Payload:**
```json
{
  "deviceId": "abc123..."
}
```

#### token_response
Fresh access token.

**Payload:**
```json
{
  "accessToken": "BQC..."
}
```

#### search_results
Search results.

**Payload:**
```json
{
  "results": [...]
}
```

#### error
Error message.

**Payload:**
```json
{
  "message": "Error description"
}
```

---

## Room Lifecycle Rules

### Room Creation
1. Host authenticates with Spotify
2. POST /api/rooms/create
3. Room inserted into PostgreSQL with unique code
4. Room marked as active
5. Host is first member

### Room Active State
- Host maintains connection via WebSocket
- Heartbeat sent every 5 seconds
- `last_heartbeat` timestamp updated in database
- Room remains active while heartbeat continues

### Member Joining
1. Participant enters room code
2. POST /api/rooms/:roomCode/join validates room is active
3. Member added to room_members table
4. WebSocket connection established
5. Initial state synced to member

### Room Closure Triggers
1. **Host Disconnects:**
   - WebSocket connection closes
   - Heartbeat stops
   - Room marked inactive in database
   - All members removed
   - Broadcast "room_closed" to all clients

2. **Host Timeout:**
   - No heartbeat for 15 seconds (configurable)
   - Cleanup process marks room inactive
   - All members disconnected

3. **Server Restart:**
   - On startup, check for stale rooms
   - Rooms with old `last_heartbeat` marked inactive
   - No ghost rooms remain

### Member Leaving
- WebSocket disconnect or explicit leave
- Member removed from room_members
- Broadcast to remaining members
- Room continues if host remains

---

## Error Codes

### HTTP Status Codes
- 200: Success
- 201: Created
- 204: No Content
- 400: Bad Request (missing parameters, invalid data)
- 401: Unauthorized (invalid token)
- 404: Not Found (room doesn't exist)
- 500: Internal Server Error

### WebSocket Error Types
All WebSocket errors sent via `error` event with descriptive message.

Common errors:
- "Room not found"
- "Room is not active"
- "Not in a room"
- "Only host can control playback"
- "Only host can remove from queue"
- "Failed to search tracks"
- "Failed to control playback"
- "Not connected"

---

## Rate Limits & Constraints

### Database Constraints
- Room codes: 6 characters, alphanumeric (no ambiguous chars)
- Display names: Max 255 characters
- Queue position: Auto-incrementing integers
- Track URIs: Max 255 characters

### Timing
- Heartbeat interval: 5 seconds (configurable)
- Room timeout: 15 seconds (configurable)
- Token refresh: 5 minutes before expiry

### Playback
- Requires Spotify Premium (host only)
- Web Playback SDK requires user gesture to connect
- Device transfer may take 1-2 seconds
- Sync accuracy: Best-effort, typically <1 second
