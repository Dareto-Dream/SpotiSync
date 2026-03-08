import asyncio
import base64
import json
import os
import time
from urllib.parse import quote

import aiohttp
import discord
from discord import app_commands
from discord.ui import View, Button
from dotenv import load_dotenv

load_dotenv()

# ── Helpers (defined before use) ───────────────────────────────────────────────
def _to_ws_url(http_url: str) -> str:
    if http_url.startswith("https://"):
        return http_url.replace("https://", "wss://", 1) + "/ws"
    if http_url.startswith("http://"):
        return http_url.replace("http://", "ws://", 1) + "/ws"
    return f"ws://{http_url}/ws"

def _parse_jwt_exp(token: str) -> float:
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.b64decode(payload))
        return float(data.get("exp", 0)) * 1000
    except Exception:
        return 0.0

# ── Env ────────────────────────────────────────────────────────────────────────
DISCORD_TOKEN        = os.getenv("DISCORD_TOKEN")
DISCORD_CLIENT_ID    = os.getenv("DISCORD_CLIENT_ID")
DISCORD_GUILD_ID     = os.getenv("DISCORD_GUILD_ID", "")
BACKEND_URL          = os.getenv("BACKEND_URL", "http://localhost:4000").rstrip("/")
BACKEND_WS_URL       = os.getenv("BACKEND_WS_URL") or _to_ws_url(BACKEND_URL)
BOT_BACKEND_USERNAME = os.getenv("BOT_BACKEND_USERNAME", "")
BOT_BACKEND_PASSWORD = os.getenv("BOT_BACKEND_PASSWORD", "")
BOT_COOKIE_METHOD    = os.getenv("BOT_COOKIE_METHOD", "")
OWNER_ID             = int(os.getenv("OWNER_ID", "756572353911062550"))

if not DISCORD_TOKEN or not DISCORD_CLIENT_ID:
    raise RuntimeError("[Bot] Missing DISCORD_TOKEN or DISCORD_CLIENT_ID")
if not BOT_BACKEND_USERNAME or not BOT_BACKEND_PASSWORD:
    raise RuntimeError("[Bot] Missing BOT_BACKEND_USERNAME or BOT_BACKEND_PASSWORD")

# ── Backend auth ───────────────────────────────────────────────────────────────
_backend_token: str | None = None
_backend_token_exp: float = 0.0

async def _login_backend(session: aiohttp.ClientSession) -> str:
    global _backend_token, _backend_token_exp
    async with session.post(
        f"{BACKEND_URL}/api/auth/login",
        json={"username": BOT_BACKEND_USERNAME, "password": BOT_BACKEND_PASSWORD},
    ) as resp:
        if not resp.ok:
            text = await resp.text()
            raise RuntimeError(f"Backend login failed ({resp.status}): {text}")
        data = await resp.json()
    _backend_token = data.get("token") or data.get("accessToken")
    if not _backend_token:
        raise RuntimeError("Backend login did not return a token")
    _backend_token_exp = _parse_jwt_exp(_backend_token)
    print("[Auth] Backend token acquired")
    return _backend_token

async def _get_backend_token(session: aiohttp.ClientSession) -> str:
    now = time.time() * 1000
    if not _backend_token or (_backend_token_exp and now > _backend_token_exp - 30_000):
        return await _login_backend(session)
    return _backend_token

async def _api_fetch(
    session: aiohttp.ClientSession,
    path: str,
    method: str = "GET",
    **kwargs,
) -> aiohttp.ClientResponse:
    """Authenticated HTTP request. Auto-retries once on 401."""
    token = await _get_backend_token(session)
    headers = kwargs.pop("headers", {})
    headers["Authorization"] = f"Bearer {token}"
    headers.setdefault("Content-Type", "application/json")
    resp = await session.request(method, f"{BACKEND_URL}{path}", headers=headers, **kwargs)
    if resp.status == 401:
        token = await _login_backend(session)
        headers["Authorization"] = f"Bearer {token}"
        resp = await session.request(method, f"{BACKEND_URL}{path}", headers=headers, **kwargs)
    return resp

# ── Audio relay ────────────────────────────────────────────────────────────────
async def _resolve_audio_source(session: aiohttp.ClientSession, video_id: str) -> dict:
    qs = f"?cookieMethod={quote(BOT_COOKIE_METHOD)}" if BOT_COOKIE_METHOD else ""
    resp = await _api_fetch(session, f"/api/media/resolve/{quote(video_id)}{qs}")
    if not resp.ok:
        text = await resp.text()
        raise RuntimeError(f"Relay error ({resp.status}): {text}")
    data = await resp.json()
    if not data:
        raise RuntimeError("Relay unavailable (empty response)")

    if data.get("source") == "worker":
        url = data.get("streamProxyUrl") or data.get("streamEndpoint")
        if not url:
            raise RuntimeError("Worker relay did not return a stream URL")
        return {"url": url, "source": "worker"}

    if data.get("source") == "legacy":
        reason = data.get("reason", "no worker available")
        raise RuntimeError(
            f"Relay fell back to legacy source ({reason}); no worker available to stream"
        )

    raise RuntimeError("Relay did not return a usable stream URL")

# ── Per-guild state ────────────────────────────────────────────────────────────
class GuildState:
    def __init__(self, guild_id: int):
        self.guild_id          = guild_id
        self.room_code: str | None = None
        self.room_id: str | None = None
        self.playback: dict | None = None
        self.ws: aiohttp.ClientWebSocketResponse | None = None
        self.ws_task: asyncio.Task | None = None
        self.voice_client: discord.VoiceClient | None = None
        self.voice_channel_id: int | None = None
        self.text_channel_id: int | None = None
        self.last_track_id: str | None = None
        self.last_is_playing: bool | None = None
        self.session: aiohttp.ClientSession | None = None
        self._now_playing: dict | None = None
        self._controls: "PlaybackControls | None" = None

    def reset(self):
        self.room_code         = None
        self.room_id           = None
        self.playback          = None
        self.ws                = None
        self.ws_task           = None
        self.voice_client      = None
        self.voice_channel_id  = None
        self.last_track_id     = None
        self.last_is_playing   = None
        self._now_playing      = None
        self._controls         = None

_guild_states: dict[int, GuildState] = {}

def get_guild_state(guild_id: int) -> GuildState:
    if guild_id not in _guild_states:
        _guild_states[guild_id] = GuildState(guild_id)
    return _guild_states[guild_id]

# ── Bot setup ──────────────────────────────────────────────────────────────────
intents = discord.Intents.default()
intents.voice_states = True
intents.guilds = True
intents.members = True  # needed to resolve voice state from interaction.user

class SpotiSyncBot(discord.Client):
    def __init__(self):
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self._session: aiohttp.ClientSession | None = None

    @property
    def session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def setup_hook(self):
        if DISCORD_GUILD_ID:
            guild = discord.Object(id=int(DISCORD_GUILD_ID))
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
            print("[Bot] Registered guild commands")
        else:
            await self.tree.sync()
            print("[Bot] Registered global commands")

    async def on_ready(self):
        print(f"[Bot] Logged in as {self.user}")
        await self.change_presence(
            status=discord.Status.online,
            activity=discord.Game("Türkiye should make Istanbul Constantinople"),
        )

bot = SpotiSyncBot()

# ── Playback controls UI ───────────────────────────────────────────────────────
class PlaybackControls(View):
    def __init__(self, state: GuildState):
        super().__init__(timeout=None)
        self.state = state
        self.message: discord.Message | None = None
        self.showing_queue = False
        self.page = 0

    def _header(self) -> str:
        track       = self.state._now_playing
        now_playing = track["title"] if track else "Nothing playing"
        room_code   = self.state.room_code or "—"
        return f"🎵 **Now Playing:** {now_playing}\n🔑 **Room Code:** `{room_code}`"

    async def update_display(self):
        if not self.message:
            return
        try:
            await self.message.edit(content=self._header(), view=self)
        except Exception:
            pass

    @discord.ui.button(label="⏸ Pause", style=discord.ButtonStyle.primary)
    async def pause(self, interaction: discord.Interaction, button: Button):
        vc = self.state.voice_client
        if vc and vc.is_playing():
            vc.pause()
            button.label = "▶️ Resume"
            asyncio.create_task(_ws_send(self.state, "playback_state", {"isPlaying": False}))
        elif vc and vc.is_paused():
            vc.resume()
            button.label = "⏸ Pause"
            asyncio.create_task(_ws_send(self.state, "playback_state", {"isPlaying": True}))
        await self.update_display()
        await interaction.response.defer()

    @discord.ui.button(label="⏭ Skip", style=discord.ButtonStyle.secondary)
    async def skip(self, interaction: discord.Interaction, button: Button):
        vc = self.state.voice_client
        if vc and (vc.is_playing() or vc.is_paused()):
            track_id = self.state.last_track_id
            if track_id:
                asyncio.create_task(
                    _ws_send(self.state, "vote", {"action": "skip", "trackId": track_id})
                )
            vc.stop()
            await interaction.response.send_message("⏭ Skipped.", ephemeral=True)
        else:
            await interaction.response.send_message("Nothing to skip.", ephemeral=True)
        await self.update_display()

    @discord.ui.button(label="📃 Queue", style=discord.ButtonStyle.secondary)
    async def show_queue(self, interaction: discord.Interaction, button: Button):
        self.showing_queue = True
        self.page = 0
        await self._render_queue(interaction)

    @discord.ui.button(label="⬅️ Prev", style=discord.ButtonStyle.secondary)
    async def prev_page(self, interaction: discord.Interaction, button: Button):
        if not self.showing_queue:
            await interaction.response.defer()
            return
        self.page = max(0, self.page - 1)
        await self._render_queue(interaction)

    @discord.ui.button(label="➡️ Next", style=discord.ButtonStyle.secondary)
    async def next_page(self, interaction: discord.Interaction, button: Button):
        if not self.showing_queue:
            await interaction.response.defer()
            return
        self.page += 1
        await self._render_queue(interaction)

    async def _render_queue(self, interaction: discord.Interaction):
        playback   = self.state.playback or {}
        full_queue = playback.get("queue", [])
        if not full_queue:
            self.showing_queue = False
            await interaction.response.edit_message(
                content=self._header() + "\n\n🪹 Queue is empty.", view=self
            )
            return
        page_size = 10
        max_page  = (len(full_queue) - 1) // page_size
        self.page = max(0, min(self.page, max_page))
        start     = self.page * page_size
        items     = full_queue[start:start + page_size]
        lines     = "\n".join(
            f"{start + i + 1}. {t.get('title', 'Unknown')} — {t.get('artist', 'Unknown')}"
            for i, t in enumerate(items)
        )
        content = (
            self._header()
            + f"\n\n📃 **Queue Page {self.page + 1}/{max_page + 1}**\n{lines}"
        )
        await interaction.response.edit_message(content=content, view=self)

# ── WebSocket ──────────────────────────────────────────────────────────────────
async def _ws_send(state: GuildState, event: str, data: dict):
    if state.ws is None:
        return
    try:
        await state.ws.send_json({"event": event, "data": data})
    except Exception as e:
        print(f"[WS] Send error ({event}): {e}")

async def _handle_ws_message(state: GuildState, msg: dict):
    event = msg.get("event")
    data  = msg.get("data") or {}

    if event == "connected":
        await _ws_send(state, "join_room", {"code": state.room_code})

    elif event == "room_state":
        state.playback = data.get("playback")
        _sync_playback(state)

    elif event in ("now_playing", "playback_state"):
        state.playback = data or state.playback
        _sync_playback(state)

    elif event == "playback_seek":
        state.playback = data or state.playback
        if state.playback and state.playback.get("currentItem"):
            asyncio.create_task(
                _play_track(state, state.playback["currentItem"], state.playback.get("positionMs", 0))
            )

    elif event == "queue_updated":
        if state.playback is None:
            state.playback = {}
        state.playback["queue"]         = data.get("queue", [])
        state.playback["autoplayQueue"] = data.get("autoplayQueue", [])

    elif event == "room_closed":
        await _send_channel_message(state, f"Room closed: {data.get('reason', 'unknown reason')}")
        await _cleanup_state(state)

    elif event == "error":
        await _send_channel_message(state, f"Backend error: {data.get('message', 'unknown error')}")

async def _run_ws(state: GuildState):
    """
    WebSocket loop. Per STANDARDS.md:
      ws[s]://<backend-host>/ws?token=<JWT>
    Reconnects automatically unless room_code is cleared (intentional leave).
    """
    session = state.session or bot.session
    while True:
        try:
            token  = await _get_backend_token(session)
            ws_url = f"{BACKEND_WS_URL}?token={token}"
            print("[WS] Connecting to backend")
            async with session.ws_connect(ws_url) as ws:
                state.ws = ws
                print("[WS] Connected")
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        try:
                            parsed = json.loads(msg.data)
                            await _handle_ws_message(state, parsed)
                        except Exception as e:
                            print(f"[WS] Message error: {e}")
                    elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        print(f"[WS] Closed ({msg.type})")
                        break
        except asyncio.CancelledError:
            print("[WS] Task cancelled")
            return
        except Exception as e:
            print(f"[WS] Connection error: {e}")

        state.ws = None
        if not state.room_code:
            return  # Intentional leave — do not reconnect
        print("[WS] Reconnecting in 5s...")
        await asyncio.sleep(5)

async def _connect_room(state: GuildState, room_code: str):
    if state.ws_task and not state.ws_task.done():
        state.ws_task.cancel()
        try:
            await state.ws_task
        except asyncio.CancelledError:
            pass
    state.room_code = room_code
    state.session   = bot.session
    state.ws_task   = asyncio.create_task(_run_ws(state))

# ── Audio playback ─────────────────────────────────────────────────────────────
async def _play_track(state: GuildState, track: dict, position_ms: int = 0):
    if not state.voice_client or not state.voice_client.is_connected():
        print("[Audio] Skipping: voice not connected")
        return
    video_id = track.get("videoId")
    if not video_id:
        print("[Audio] Skipping: no videoId in track")
        return

    try:
        source_info = await _resolve_audio_source(state.session or bot.session, video_id)
    except Exception as e:
        print(f"[Audio] Relay failed: {e}")
        await _send_channel_message(state, f"Relay failed: {e}")
        return

    start_seconds  = max(0, position_ms // 1000)
    before_options = (
        f"-ss {start_seconds} "
        "-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5"
    )
    audio_source = discord.FFmpegPCMAudio(
        source_info["url"],
        before_options=before_options,
        options="-vn",
    )

    if state.voice_client.is_playing() or state.voice_client.is_paused():
        state.voice_client.stop()

    def after_play(error):
        if error:
            print(f"[Audio] Playback error: {error}")

    state.voice_client.play(audio_source, after=after_play)
    state.last_track_id   = video_id
    state.last_is_playing = True
    state._now_playing    = track

    print(f"[Audio] Playing: {track.get('title', video_id)} [{source_info['source']}]")

    if state.playback and state.playback.get("isPlaying") is False:
        state.voice_client.pause()
        state.last_is_playing = False

    if state._controls:
        asyncio.create_task(state._controls.update_display())

def _sync_playback(state: GuildState):
    playback = state.playback
    if not playback or not playback.get("currentItem"):
        return
    track      = playback["currentItem"]
    current_id = track.get("videoId")
    if not current_id:
        return

    if state.last_track_id != current_id:
        asyncio.create_task(
            _play_track(state, track, playback.get("positionMs", 0))
        )
        return

    vc = state.voice_client
    if not vc:
        return
    is_playing = playback.get("isPlaying", True)
    if is_playing != state.last_is_playing:
        if is_playing and vc.is_paused():
            vc.resume()
        elif not is_playing and vc.is_playing():
            vc.pause()
        state.last_is_playing = is_playing

# ── Utility ────────────────────────────────────────────────────────────────────
async def _connect_voice(state: GuildState, channel: discord.VoiceChannel) -> bool:
    try:
        if state.voice_client and state.voice_client.is_connected():
            await state.voice_client.disconnect(force=True)
        print(f"[Voice] Attempting to connect to {channel.name} ({channel.id})")
        vc = await channel.connect()
        state.voice_client     = vc
        state.voice_channel_id = channel.id
        print(f"[Voice] Connected to {channel.name} ({channel.id})")
        return True
    except Exception as e:
        import traceback
        print(f"[Voice] Failed to connect: {e}")
        traceback.print_exc()
        return False

async def _cleanup_state(state: GuildState):
    if state.ws_task and not state.ws_task.done():
        state.ws_task.cancel()
        try:
            await state.ws_task
        except asyncio.CancelledError:
            pass
    if state.voice_client and state.voice_client.is_connected():
        try:
            await state.voice_client.disconnect(force=True)
        except Exception:
            pass
    state.reset()

async def _send_channel_message(state: GuildState, content: str):
    if not state.text_channel_id:
        return
    try:
        channel = bot.get_channel(state.text_channel_id)
        if channel and hasattr(channel, "send"):
            await channel.send(content)
    except Exception as e:
        print(f"[Bot] Failed to send message: {e}")

# ── Slash commands ─────────────────────────────────────────────────────────────

@bot.tree.command(name="create", description="Create a new SpotiSync room and join it")
async def cmd_create(interaction: discord.Interaction):
    voice = interaction.user.voice
    if not voice or not voice.channel:
        await interaction.response.send_message("❌ Join a voice channel first.", ephemeral=True)
        return

    await interaction.response.defer()
    state = get_guild_state(interaction.guild_id)
    state.text_channel_id = interaction.channel_id

    # POST /api/rooms → { "room": { "joinCode": "...", "id": "...", ... } }
    try:
        resp = await _api_fetch(
            bot.session,
            "/api/rooms",
            method="POST",
            json={"settings": {}},
        )
        if not resp.ok:
            text = await resp.text()
            raise RuntimeError(f"Room creation failed ({resp.status}): {text}")
        data      = await resp.json()
        room      = data.get("room", {})
        join_code = room.get("joinCode")
        room_id   = room.get("id")
        if not join_code:
            raise RuntimeError("Backend did not return a joinCode")
    except Exception as e:
        await interaction.followup.send(f"❌ Failed to create room: {e}")
        return

    state.room_id = room_id

    connected = await _connect_voice(state, voice.channel)
    if not connected:
        await interaction.followup.send("❌ Room created but failed to join your voice channel.")
        return

    await interaction.followup.send(
        f"🎉 Room created!\n"
        f"🔑 **Join Code:** `{join_code}`\n"
        f"🔊 Joined **{voice.channel.name}** — share the code with others to let them in."
    )
    await _connect_room(state, join_code)


@bot.tree.command(name="join", description="Join an existing SpotiSync room and your current voice channel")
@app_commands.describe(code="Room join code")
async def cmd_join(interaction: discord.Interaction, code: str):
    voice = interaction.user.voice
    if not voice or not voice.channel:
        await interaction.response.send_message("❌ Join a voice channel first.", ephemeral=True)
        return

    await interaction.response.defer()
    state = get_guild_state(interaction.guild_id)
    state.text_channel_id = interaction.channel_id

    connected = await _connect_voice(state, voice.channel)
    if not connected:
        await interaction.followup.send("❌ Failed to join your voice channel.")
        return

    await interaction.followup.send(
        f"🎶 Joining room **{code.upper()}** in **{voice.channel.name}**..."
    )
    await _connect_room(state, code.upper())


@bot.tree.command(name="leave", description="Leave the current room and voice channel")
async def cmd_leave(interaction: discord.Interaction):
    state = get_guild_state(interaction.guild_id)
    await _cleanup_state(state)
    await interaction.response.send_message("👋 Disconnected from room and voice channel.")


@bot.tree.command(name="queue", description="Show the current SpotiSync queue")
async def cmd_queue(interaction: discord.Interaction):
    state    = get_guild_state(interaction.guild_id)
    playback = state.playback or {}
    queue    = playback.get("queue", [])
    if not queue:
        await interaction.response.send_message("Queue is empty.")
        return
    lines = [
        f"{i + 1}. {item.get('title', 'Unknown')} — {item.get('artist', 'Unknown')}"
        for i, item in enumerate(queue[:10])
    ]
    extra = f"\n...and {len(queue) - 10} more" if len(queue) > 10 else ""
    await interaction.response.send_message(
        f"**Queue ({len(queue)}):**\n" + "\n".join(lines) + extra
    )


# Per-guild autocomplete track cache: { guild_id: { videoId: TrackObject } }
# Populated during autocomplete, consumed by cmd_add on submission.
# Avoids needing to encode full TrackObjects into Discord's 100-char value limit.
_track_cache: dict[int, dict[str, dict]] = {}

def _cache_tracks(guild_id: int, tracks: list[dict]):
    if guild_id not in _track_cache:
        _track_cache[guild_id] = {}
    for t in tracks:
        vid = t.get("videoId")
        if vid:
            _track_cache[guild_id][vid] = t

def _get_cached_track(guild_id: int, video_id: str) -> dict | None:
    return _track_cache.get(guild_id, {}).get(video_id)


@bot.tree.command(name="add", description="Search and add a track to the SpotiSync queue")
@app_commands.describe(query="Start typing a song name or artist")
async def cmd_add(interaction: discord.Interaction, query: str):
    state = get_guild_state(interaction.guild_id)
    if not state.ws:
        await interaction.response.send_message(
            "❌ Not connected to a room. Use /join or /create first.", ephemeral=True
        )
        return

    await interaction.response.defer()
    try:
        # Autocomplete choices pass videoId as value — do a cache lookup first.
        track = _get_cached_track(interaction.guild_id, query)

        if track is None:
            # Free-text fallback: user submitted without picking a suggestion.
            # GET /api/search/track/:videoId if it looks like a videoId,
            # otherwise fall back to a regular search.
            if query and len(query) <= 12 and " " not in query:
                # Might be a raw videoId — try direct track fetch first
                resp = await _api_fetch(
                    state.session or bot.session,
                    f"/api/search/track/{quote(query)}",
                )
                if resp.ok:
                    data  = await resp.json()
                    track = data.get("track")

            if track is None:
                resp = await _api_fetch(
                    state.session or bot.session,
                    f"/api/search?q={quote(query)}&limit=1",
                )
                if not resp.ok:
                    text = await resp.text()
                    raise RuntimeError(f"Search failed ({resp.status}): {text}")
                data    = await resp.json()
                results = data.get("results", [])
                if not results:
                    await interaction.followup.send(f"No results for: {query}")
                    return
                track = results[0]

        await _ws_send(state, "queue_add", {"item": track})
        await interaction.followup.send(
            f"➕ Added: **{track.get('title', '?')}** — {track.get('artist', '?')}"
        )
    except Exception as e:
        await interaction.followup.send(f"❌ Add failed: {e}")


@cmd_add.autocomplete("query")
async def autocomplete_add(
    interaction: discord.Interaction,
    current: str,
) -> list[app_commands.Choice[str]]:
    if not current.strip():
        return []
    try:
        resp = await _api_fetch(
            bot.session,
            f"/api/search?q={quote(current)}&limit=25",
        )
        if not resp.ok:
            return []
        data    = await resp.json()
        results = data.get("results", [])

        # Cache results so cmd_add can resolve videoId → full TrackObject
        # without a second network call.
        _cache_tracks(interaction.guild_id, results)

        choices = []
        for track in results:
            title  = track.get("title", "Unknown")
            artist = track.get("artist", "Unknown")
            video_id = track.get("videoId", "")
            if not video_id:
                continue
            # Label shown in Discord dropdown — max 100 chars
            label = f"{title} — {artist}"[:100]
            # Value is just the videoId (≤11 chars) — well within the 100-char limit
            choices.append(app_commands.Choice(name=label, value=video_id))

        return choices
    except Exception as e:
        print(f"[Autocomplete] Error: {e}")
        return []


@bot.tree.command(name="skip", description="Vote to skip the current track")
async def cmd_skip(interaction: discord.Interaction):
    state = get_guild_state(interaction.guild_id)
    if not state.ws:
        await interaction.response.send_message(
            "❌ Not connected to a room. Use /join or /create first.", ephemeral=True
        )
        return
    track_id = (state.playback or {}).get("currentItem", {}).get("videoId")
    if not track_id:
        await interaction.response.send_message("Nothing is playing.", ephemeral=True)
        return
    await _ws_send(state, "vote", {"action": "skip", "trackId": track_id})
    await interaction.response.send_message("✅ Voted to skip.")


@bot.tree.command(name="playback", description="Show the playback controller")
async def cmd_playback(interaction: discord.Interaction):
    state = get_guild_state(interaction.guild_id)
    if not state.voice_client or not state.voice_client.is_connected():
        await interaction.response.send_message(
            "❌ Not connected to a voice channel.", ephemeral=True
        )
        return
    controls = PlaybackControls(state)
    await interaction.response.send_message(controls._header(), view=controls)
    controls.message = await interaction.original_response()
    state._controls  = controls


# ── Run ────────────────────────────────────────────────────────────────────────
bot.run(DISCORD_TOKEN)