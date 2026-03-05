# Cookie Worker Runtime

This folder is for cookie extraction workers and should not be deployed to Railway.

## Purpose

Workers run on trusted devices that have real browser cookies. They poll backend jobs, run `yt-dlp` locally with browser cookies, and send extraction results back.

## Required Environment Variables

- `BACKEND_URL` (example: `https://your-railway-app.up.railway.app`)
- `WORKER_ID` (unique per device/process)
- `WORKER_TOKEN` (must match backend `COOKIE_WORKER_AUTH_TOKEN`)
- `WORKER_COOKIES_BROWSER` (example: `chrome`, `edge`, `firefox`)

Optional:

- `WORKER_COOKIES_PROFILE` (browser profile path/name)
- `WORKER_POLL_INTERVAL_MS`
- `WORKER_HEARTBEAT_INTERVAL_MS`
- `YTDLP_BIN` (default `yt-dlp`)

## Run

```bash
node backend/worker/index.js
```

Run multiple workers by using different `WORKER_ID`s on different devices or processes.
