# SpotiSync Discord Bot

Discord bot that joins a voice channel, connects to a SpotiSync room, and streams audio via the backend relay.

## Setup
1. Create a Discord application + bot, invite it with `applications.commands` and `bot` scopes, and give it Voice permissions.
2. Create a backend user for the bot (local auth): `POST /api/auth/register` or via your UI.
3. Copy `.env.example` to `.env` and fill in values.
4. Install deps and run:

```bash
npm install
npm start
```

## Commands
- `/join code:<ROOM_CODE>`: Join your current voice channel and the specified room.
- `/leave`: Leave the room and voice channel.
- `/add query:<text>`: Search YouTube Music and add the top result to the queue.
- `/queue`: Show the current queue.
- `/skip`: Vote to skip the current track.

## Notes
- Audio is pulled via `/api/media/resolve/:videoId` and uses the backend stream proxy (`/api/media/stream/:token`) when available. If no worker is available, the bot reports an error in Discord and does not play fallback audio.
- Set `BOT_COOKIE_METHOD` if you want to target a specific worker capability (for example `youtube_firefox`).
- The bot maintains separate state per Discord server (guild), so multiple servers can use it concurrently.
