# SpotiSync — Operational Documentation

## Required Environment Variables

Create a `.env` file in the `server/` directory with the following:

```bash
# Spotify App Credentials
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3001/api/auth/callback

# Server Configuration
PORT=3001
CLIENT_URL=http://localhost:5173

# PostgreSQL Database
# Option 1: Individual parameters
DB_HOST=localhost
DB_PORT=5432
DB_NAME=spotisync
DB_USER=postgres
DB_PASSWORD=postgres

# Option 2: Connection string (takes precedence)
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/spotisync
```

## Spotify App Configuration

1. **Create Spotify App**
   - Go to https://developer.spotify.com/dashboard
   - Click "Create App"
   - Fill in app name and description
   - Add redirect URI: `http://localhost:3001/api/auth/callback`
     - For production: `https://yourdomain.com/api/auth/callback`
   - Note your Client ID and Client Secret

2. **Required Settings**
   - **Spotify Premium Required**: The Web Playback SDK only works with Premium accounts
   - **Scopes**: The app requests these automatically:
     - `streaming`
     - `user-read-email`
     - `user-read-private`
     - `user-read-playback-state`
     - `user-modify-playback-state`
     - `user-read-currently-playing`

## PostgreSQL Setup

### Local Development

**Install PostgreSQL**:
- macOS: `brew install postgresql@15 && brew services start postgresql@15`
- Ubuntu: `sudo apt install postgresql postgresql-contrib`
- Windows: Download from https://www.postgresql.org/download/

**Create Database**:
```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE spotisync;

# Exit
\q
```

**Initialize Schema**:
```bash
# From project root
npm run db:setup
```

This creates three tables:
- `rooms` - Room metadata, host tokens, heartbeat tracking
- `room_members` - Active participants in each room
- `queue_items` - Queued tracks per room

### Production

Use a managed PostgreSQL service:
- **Heroku Postgres**
- **AWS RDS**
- **Google Cloud SQL**
- **DigitalOcean Managed Databases**
- **Supabase**
- **Render Postgres**

Set the `DATABASE_URL` environment variable with your connection string.

## Running the Application

### Development Mode

```bash
# Install dependencies (first time only)
npm install           # Installs concurrently
cd server && npm install
cd ../client && npm install

# Initialize database (first time only)
npm run db:setup

# Start both server and client
npm run dev
```

This runs:
- Server on http://localhost:3001
- Client on http://localhost:5173

### Production Mode

```bash
# Build client
npm run build

# This runs server and serves built client files
npm start
```

Server serves:
- API endpoints on `/api/*`
- Socket.io on `/socket.io/*`
- Static client files from `server/../client/dist`

Access at: http://localhost:3001

## Deployment

### Environment Variables (Production)

```bash
SPOTIFY_CLIENT_ID=your_prod_client_id
SPOTIFY_CLIENT_SECRET=your_prod_client_secret
SPOTIFY_REDIRECT_URI=https://yourdomain.com/api/auth/callback
PORT=3001
CLIENT_URL=https://yourdomain.com
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

### Build & Deploy Steps

1. **Update Spotify Redirect URI**
   - Add production URL to Spotify app settings
   - Update `SPOTIFY_REDIRECT_URI` in `.env`

2. **Database Migration**
   ```bash
   npm run db:setup
   ```

3. **Build Application**
   ```bash
   npm run build
   ```

4. **Start Server**
   ```bash
   npm start
   ```

### Platform-Specific Guides

**Heroku**:
```bash
# Add Heroku Postgres addon
heroku addons:create heroku-postgresql:mini

# Deploy
git push heroku main

# Run database setup
heroku run npm run db:setup
```

**Render**:
- Create PostgreSQL database
- Create Web Service
- Set environment variables
- Build command: `npm run build`
- Start command: `npm start`
- Run `npm run db:setup` via shell access

**Docker**:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN cd client && npm ci && npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

## Troubleshooting

### Spotify Playback Issues

**"Connect Web Player" button doesn't appear**:
- Ensure you're signed in with a Spotify Premium account
- Check browser console for errors
- Verify `SPOTIFY_CLIENT_ID` is correct

**Device transfer fails**:
- Make sure the SDK player is connected (green status indicator)
- Check that no other Spotify app has an active session
- Try refreshing the page

**Audio doesn't play**:
- Click "Connect Web Player" button (user gesture required)
- Check browser autoplay settings
- Ensure Spotify Premium is active

### Database Issues

**"Database not initialized" error**:
```bash
npm run db:setup
```

**Connection refused**:
- Verify PostgreSQL is running: `pg_isready`
- Check credentials in `.env`
- Test connection: `psql -U postgres -d spotisync`

**Schema errors after update**:
```bash
# Backup existing data
pg_dump spotisync > backup.sql

# Recreate schema
npm run db:setup

# Restore data if needed
psql spotisync < backup.sql
```

### Room Management

**Rooms don't close when host disconnects**:
- Check server logs for errors
- Verify heartbeat interval is running (every 5 seconds)
- Cleanup interval runs every 10 seconds (checks for stale rooms)

**Ghost rooms after server restart**:
- On startup, rooms with heartbeat >60s old are closed
- If issues persist, manually clean: `DELETE FROM rooms WHERE last_heartbeat < (extract(epoch from now()) * 1000) - 60000;`

### Performance Optimization

**Database Connection Pooling**:
- Default pool size: 10 connections
- Adjust via `PGPOOLSIZE` environment variable

**Heartbeat Tuning**:
- Current: 5s updates, 30s timeout
- Modify in `server/index.js` if needed

**Client-Side Caching**:
- Queue updates are real-time
- Participant list updates on join/leave
- Consider debouncing for high-traffic rooms

## Browser Compatibility

### Fully Supported
- Chrome 76+ (desktop)
- Edge 79+ (desktop)
- Safari 14.1+ (desktop)
- Safari iOS 14.5+ (mobile)

### Limitations
- **Firefox**: No Web Playback SDK support (can join as guest, can't host)
- **iOS Chrome**: Uses Safari WebKit, should work
- **Older browsers**: May not support AudioContext or modern JavaScript features

## Security Notes

1. **Token Storage**:
   - Access tokens stored in PostgreSQL (encrypted at rest)
   - Refresh tokens used for automatic token renewal
   - Tokens never sent to client after initial auth

2. **CORS**:
   - Configured for specific client URL
   - Update `CLIENT_URL` for production domain

3. **Rate Limiting**:
   - Consider adding rate limits for production
   - Use `express-rate-limit` for API endpoints

4. **HTTPS**:
   - Required for production Spotify OAuth
   - Use reverse proxy (nginx, Caddy) or platform SSL

## Monitoring

**Database Health**:
```sql
-- Active rooms
SELECT COUNT(*) FROM rooms WHERE status = 'active';

-- Rooms by age
SELECT id, join_code, created_at, last_heartbeat 
FROM rooms 
WHERE status = 'active' 
ORDER BY created_at DESC;

-- Cleanup stale manually
DELETE FROM rooms 
WHERE last_heartbeat < (extract(epoch from now()) * 1000) - 30000;
```

**Server Logs**:
- Watch for "Heartbeat update error"
- Monitor "Stale room cleanup" messages
- Check for PostgreSQL connection errors

## Additional Configuration

### Session Timeout
- Default: 4 hours (auto-cleanup)
- Modify: `server/store/sessions.js` → `cleanupOldRooms()`

### Heartbeat Settings
- Update interval: 5 seconds
- Stale threshold: 30 seconds
- Cleanup check: 10 seconds
- Modify: `server/index.js` and `server/socket/index.js`

### Queue Size Limits
- No hard limit by default
- Add validation in `server/socket/index.js` → `queue:add` handler
