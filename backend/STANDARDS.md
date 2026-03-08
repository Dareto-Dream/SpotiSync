# STANDARDS.md

## Scope

This file documents the HTTP and WebSocket interfaces exposed by the backend service in `backend/`.

Base URLs:
- HTTP: `http[s]://<backend-host>`
- API prefix: `/api`
- Client WebSocket: `ws[s]://<backend-host>/ws`

---

## Authentication

Protected HTTP routes require a bearer token:
- `Authorization: Bearer <access_token>`

Auth endpoints also set a refresh token cookie:
- Cookie name: `REFRESH_COOKIE_NAME` (default `refresh_token`)
- HttpOnly, SameSite, Secure according to environment settings

---

## Global Behavior

- All `/api/*` routes are rate-limited (default 100 requests per 60s per IP).
- `Content-Type: application/json` is expected for JSON bodies.
- Error shape: `{ "error": "message" }`

---

## Health

### GET `/health`
Simple health check.

Response:
```json
{ "status": "ok", "time": "ISO8601" }
```

---

## Auth Routes (`/api/auth`)

### POST `/api/auth/register`
Create a new user and immediately return tokens.

Body:
```json
{ "username": "string", "password": "string" }
```

Response:
- `201` `{ "token": "<access_token>", "user": { "id", "username" } }`
- Sets refresh token cookie.

Errors:
- `400/409` validation conflicts

### POST `/api/auth/login`
Login with username/password.

Body:
```json
{ "username": "string", "password": "string" }
```

Response:
- `200` `{ "token": "<access_token>", "user": { "id", "username" } }`
- Sets refresh token cookie.

Errors:
- `401` invalid credentials

### POST `/api/auth/google`
Login with Google ID token.

Body:
```json
{ "idToken": "string" }
```

Response:
- `200` `{ "token": "<access_token>", "user": { "id", "username" } }`
- Sets refresh token cookie.

### POST `/api/auth/refresh`
Exchange refresh token for a new access token.

Body (optional if cookie is present):
```json
{ "refreshToken": "string" }
```

Response:
- `200` `{ "token": "<access_token>", "user": { "id", "username" } }`
- Sets refresh token cookie.

### POST `/api/auth/logout`
Revoke refresh token and clear cookie.

Body (optional if cookie is present):
```json
{ "refreshToken": "string" }
```

Response:
- `200` `{ "success": true }`

### GET `/api/auth/me`
Validate the bearer token.

Headers:
- `Authorization: Bearer <access_token>`

Response:
```json
{ "user": { "id": "string", "username": "string" } }
```

---

## Rooms Routes (`/api/rooms`)

All room routes require `Authorization: Bearer <access_token>`.

### POST `/api/rooms`
Create a room (caller becomes host).

Body:
```json
{ "settings": { } }
```

Response:
```json
{ "room": RoomObject }
```

### GET `/api/rooms/code/:code`
Lookup room by join code.

Response:
```json
{ "room": RoomObject }
```

Errors:
- `404` room not found or inactive

### GET `/api/rooms/:roomId`
Fetch room by ID.

Response:
```json
{ "room": RoomObject }
```

### GET `/api/rooms/:roomId/members`
Fetch room members.

Response:
```json
{ "members": [ { "id", "username", "joined_at" } ] }
```

### PATCH `/api/rooms/:roomId/settings`
Update room settings (host only).

Body:
```json
{ "userSkipMode": "vote"|"instant", "userPrevMode": "vote"|"instant", ... }
```

Response:
```json
{ "room": RoomObject }
```

Errors:
- `403` only host can change settings
- `404` room not found

### DELETE `/api/rooms/:roomId`
Close a room (host only).

Response:
```json
{ "message": "Room closed" }
```

---

## Search Routes (`/api/search`)

All search routes require `Authorization: Bearer <access_token>`.

### GET `/api/search?q=<query>&limit=<number>`
Search tracks.

Query:
- `q` (required): search term
- `limit` (optional): max results (default 20)

Response:
```json
{ "results": [ TrackObject, ... ] }
```

Errors:
- `400` when `q` is missing

### GET `/api/search/track/:videoId`
Fetch track details by YouTube video ID.

Response:
```json
{ "track": TrackObject }
```

Errors:
- `404` when not found

### GET `/api/search/playlist?url=<url>|id=<id>|q=<value>`
Fetch playlist details by URL or ID.

Query:
- `url` or `id` or `q` (any one required)

Response:
```json
{ "...": "playlist details" }
```

Errors:
- `400` when no input provided

---

## Media Routes (`/api/media`)

### GET `/api/media/resolve/:videoId`
Resolve a stream source for a YouTube video.

Headers:
- `Authorization: Bearer <access_token>`

Query (optional):
- `cookieMethod` or `cookie_method` to request a specific worker capability

Response (worker-backed):
```json
{
  "source": "worker",
  "videoId": "string",
  "streamProxyUrl": "string",
  "streamProxyToken": "string",
  "streamProxyExpiresAt": "ISO8601",
  "contentType": "string|null",
  "streamMode": "string|null",
  "workerId": "string|null",
  "fetchedAt": "ISO8601|null",
  "attempts": []
}
```

Response (legacy fallback):
```json
{
  "source": "legacy",
  "videoId": "string",
  "streamUrl": "https://www.youtube.com/watch?v=<id>",
  "reason": "string",
  "attempts": []
}
```

Errors:
- `400` invalid `videoId`

### GET `/api/media/stream/:token`
Stream proxy endpoint used by the backend to relay worker audio to clients.

Usage:
- Use `streamProxyUrl` from `/api/media/resolve/:videoId`.
- Token is short-lived and single-purpose.

---

## WebSocket Routes

### Client WS: `ws[s]://<backend-host>/ws`
Used by frontend clients. Authenticate with query string `?token=<JWT>`.

### Worker WS: `ws[s]://<backend-host>/ws-worker`
Used by worker instances for streaming audio data.

---

## Object Schemas

### RoomObject
```json
{
  "id": "uuid",
  "joinCode": "string",
  "hostId": "uuid",
  "hostUsername": "string",
  "isActive": true,
  "createdAt": "ISO8601",
  "settings": { }
}
```

### TrackObject
```json
{
  "videoId": "string",
  "title": "string",
  "artist": "string",
  "album": "string|null",
  "durationMs": 0,
  "thumbnailUrl": "string|null",
  "isExplicit": false
}
```

---

## Worker-Only Routes (Backend Internal)

Important: these routes are for the worker process only. Clients must never call them directly.
The worker does not expose its own HTTP server; it talks to the backend, and only the backend should talk to the worker.

### POST `/api/media/worker/heartbeat`
Worker heartbeat and capability update.

Headers:
- `x-worker-token: <WORKER_TOKEN>`

Body:
```json
{
  "workerId": "string",
  "meta": {
    "host": "string|null",
    "browser": "string",
    "capabilities": ["string", "..."]
  }
}
```

Response:
```json
{ "ok": true, "activeWorkers": 0 }
```

### GET `/api/media/worker/jobs/next?workerId=<id>`
Poll for the next assigned job.

Headers:
- `x-worker-token: <WORKER_TOKEN>`

Response:
- `204` when no job is available
- `200` with:
```json
{ "job": { "id": "string", "payload": { }, "createdAt": "ISO8601" } }
```

### POST `/api/media/worker/jobs/:jobId/result`
Submit a job result.

Headers:
- `x-worker-token: <WORKER_TOKEN>`

Body:
```json
{
  "workerId": "string",
  "success": true,
  "result": { },
  "error": "string"
}
```

Response:
```json
{ "ok": true }
```
