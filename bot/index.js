require('dotenv').config();

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');
const WebSocket = require('ws');
const fetch = global.fetch || require('node-fetch');
const { Readable } = require('node:stream');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';

const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/$/, '');
const BACKEND_WS_URL = process.env.BACKEND_WS_URL || toWsUrl(BACKEND_URL);
const BOT_COOKIE_METHOD = process.env.BOT_COOKIE_METHOD || '';

const BOT_BACKEND_USERNAME = process.env.BOT_BACKEND_USERNAME || '';
const BOT_BACKEND_PASSWORD = process.env.BOT_BACKEND_PASSWORD || '';

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('[Bot] Missing DISCORD_TOKEN or DISCORD_CLIENT_ID');
  process.exit(1);
}

if (!BOT_BACKEND_USERNAME || !BOT_BACKEND_PASSWORD) {
  console.error('[Bot] Missing BOT_BACKEND_USERNAME or BOT_BACKEND_PASSWORD');
  process.exit(1);
}

if (!ffmpegPath) {
  console.error('[Bot] ffmpeg-static not available. Install dependencies.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const guildStates = new Map();

let backendToken = null;
let backendTokenExp = 0;

function toWsUrl(httpUrl) {
  if (httpUrl.startsWith('https://')) return httpUrl.replace(/^https:/, 'wss:') + '/ws';
  if (httpUrl.startsWith('http://')) return httpUrl.replace(/^http:/, 'ws:') + '/ws';
  return `ws://${httpUrl.replace(/\/$/, '')}/ws`;
}

function parseJwtExp(token) {
  try {
    const payload = token.split('.')[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf8');
    const data = JSON.parse(decoded);
    return data.exp ? data.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function loginBackend() {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: BOT_BACKEND_USERNAME, password: BOT_BACKEND_PASSWORD }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend login failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  // Backend auth routes respond with { token, user }
  backendToken = data.token || data.accessToken || null;
  backendTokenExp = backendToken ? parseJwtExp(backendToken) : 0;
  return backendToken;
}

async function getBackendToken() {
  const now = Date.now();
  if (!backendToken || (backendTokenExp && now > backendTokenExp - 30_000)) {
    return loginBackend();
  }
  return backendToken;
}

async function apiFetch(path, options = {}) {
  const token = await getBackendToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const res = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });
  if (res.status === 401) {
    await loginBackend();
    const retry = await fetch(`${BACKEND_URL}${path}`, { ...options, headers: { ...headers, Authorization: `Bearer ${backendToken}` } });
    return retry;
  }
  return res;
}

function getGuildState(guildId) {
  if (!guildStates.has(guildId)) {
    guildStates.set(guildId, {
      guildId,
      roomCode: null,
      room: null,
      playback: null,
      members: [],
      ws: null,
      pendingJoinCode: null,
      voiceConnection: null,
      player: null,
      textChannelId: null,
      lastTrackId: null,
      lastIsPlaying: null,
    });
  }
  return guildStates.get(guildId);
}

async function sendChannelMessage(state, content) {
  if (!state.textChannelId) return;
  try {
    const channel = await client.channels.fetch(state.textChannelId);
    if (channel && channel.isTextBased()) {
      await channel.send({ content });
    }
  } catch (err) {
    console.error('[Bot] Failed to send message:', err.message);
  }
}

function ensurePlayer(state) {
  if (state.player) return state.player;
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });

  player.on(AudioPlayerStatus.Idle, () => {
    console.log('[Audio] Player status: Idle');
  });
  player.on(AudioPlayerStatus.Playing, () => {
    console.log('[Audio] Player status: Playing');
  });
  player.on(AudioPlayerStatus.Paused, () => {
    console.log('[Audio] Player status: Paused');
  });
  player.on(AudioPlayerStatus.Buffering, () => {
    console.log('[Audio] Player status: Buffering');
  });
  player.on('error', (err) => {
    console.error('[Audio] Player error:', err.message);
    sendChannelMessage(state, `Audio error: ${err.message}`);
  });

  state.player = player;
  if (state.voiceConnection) {
    state.voiceConnection.subscribe(player);
  }
  return player;
}

function connectVoice(state, channel) {
  if (state.voiceConnection) {
    try { state.voiceConnection.destroy(); } catch {}
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  state.voiceConnection = connection;
  console.log(`[Voice] Joining channel ${channel.name} (${channel.id}) in guild ${channel.guild.id}`);

  connection.on(VoiceConnectionStatus.Signalling, () => {
    console.log('[Voice] Connection status: Signalling');
  });
  connection.on(VoiceConnectionStatus.Connecting, () => {
    console.log('[Voice] Connection status: Connecting');
  });
  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log('[Voice] Connection status: Ready');
  });
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    console.log('[Voice] Connection status: Disconnected');
  });
  connection.on(VoiceConnectionStatus.Destroyed, () => {
    console.log('[Voice] Connection status: Destroyed');
  });
  connection.on('error', (err) => {
    console.error('[Voice] Connection error:', err.message);
  });

  const player = ensurePlayer(state);
  connection.subscribe(player);
  return connection;
}

async function connectRoom(state, roomCode) {
  if (state.ws) {
    try { state.ws.close(1000, 'Reconnecting'); } catch {}
  }

  const ws = new WebSocket(BACKEND_WS_URL);
  state.ws = ws;
  state.pendingJoinCode = roomCode;
  state.roomCode = roomCode;

  ws.on('open', async () => {
    try {
      const token = await getBackendToken();
      ws.send(JSON.stringify({ event: 'auth', data: { token } }));
    } catch (err) {
      sendChannelMessage(state, `Backend auth failed: ${err.message}`);
    }
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleWsMessage(state, msg);
    } catch (err) {
      console.error('[WS] Invalid message:', err.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Closed (${code}) ${reason}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
    sendChannelMessage(state, `WebSocket error: ${err.message}`);
  });
}

function wsSend(state, event, data) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  state.ws.send(JSON.stringify({ event, data }));
  return true;
}

async function resolveAudioSource(videoId) {
  const cookieParam = BOT_COOKIE_METHOD ? `?cookieMethod=${encodeURIComponent(BOT_COOKIE_METHOD)}` : '';
  const res = await apiFetch(`/api/media/resolve/${encodeURIComponent(videoId)}${cookieParam}`, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Relay error (${res.status}): ${text}`);
  }
  const data = await res.json();
  if (!data) {
    throw new Error('Relay unavailable (empty response)');
  }

  if (data.source === 'worker') {
    const streamUrl = data.streamProxyUrl || data.streamEndpoint || null;
    if (!streamUrl) {
      throw new Error('Relay did not return a stream URL');
    }
    return {
      url: streamUrl,
      source: 'worker',
      contentType: data.contentType || null,
      streamMode: data.streamMode || null,
    };
  }

  if (data.audioUrl) {
    return { url: data.audioUrl, source: data.source || 'legacy', contentType: data.contentType || null };
  }

  if (data.streamUrl) {
    throw new Error(`Relay fell back to legacy source (${data.reason || 'no worker available'}); bot cannot stream legacy URLs`);
  }

  throw new Error('Relay did not return a usable stream URL');
}

async function playTrack(state, track, positionMs) {
  if (!track || !track.videoId) return;
  if (!state.voiceConnection) return;

  const startSeconds = Math.max(0, Math.floor((positionMs || 0) / 1000));

  try {
    const source = await resolveAudioSource(track.videoId);
    console.log(`[Audio] Resolved source: ${source.source} ${source.url}`);
    const res = await fetch(source.url);
    if (!res.ok || !res.body) {
      throw new Error(`Audio fetch failed (${res.status})`);
    }
    console.log(`[Audio] Fetch ok. status=${res.status} content-type=${res.headers.get('content-type') || 'unknown'}`);

    const ffmpeg = new prism.FFmpeg({
      args: [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-ss', String(startSeconds),
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
      ],
      executable: ffmpegPath,
    });

    ffmpeg.on('error', (err) => {
      console.error('[Audio] FFmpeg error:', err.message);
    });
    ffmpeg.on('close', (code, signal) => {
      console.log(`[Audio] FFmpeg closed: code=${code} signal=${signal || 'none'}`);
    });

    const inputStream = typeof res.body.on === 'function'
      ? res.body
      : Readable.fromWeb(res.body);

    console.log(`[Audio] Input stream type: ${typeof res.body.on === 'function' ? 'node' : 'web'}`);
    inputStream.on('error', (err) => {
      console.error('[Audio] Input stream error:', err.message);
    });
    inputStream.on('close', () => {
      console.log('[Audio] Input stream closed');
    });

    const player = ensurePlayer(state);
    const resource = createAudioResource(inputStream.pipe(ffmpeg), { inputType: StreamType.Raw });
    player.play(resource);

    state.lastTrackId = track.videoId;
    state.lastIsPlaying = true;

    if (state.playback && state.playback.isPlaying === false) {
      player.pause();
      state.lastIsPlaying = false;
    }
  } catch (err) {
    console.error('[Audio] Playback failed:', err.message);
    sendChannelMessage(state, `Relay failed: ${err.message}`);
  }
}

function syncPlayback(state) {
  const playback = state.playback;
  if (!playback || !playback.currentItem) return;

  const currentId = playback.currentItem.videoId;
  if (!currentId) return;

  if (state.lastTrackId !== currentId) {
    playTrack(state, playback.currentItem, playback.positionMs || 0);
    return;
  }

  const player = ensurePlayer(state);
  if (playback.isPlaying !== state.lastIsPlaying) {
    if (playback.isPlaying) player.unpause();
    else player.pause();
    state.lastIsPlaying = playback.isPlaying;
  }
}

function handleWsMessage(state, msg) {
  const { event, data } = msg || {};

  switch (event) {
    case 'auth_required':
      getBackendToken().then((token) => {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ event: 'auth', data: { token } }));
        }
      }).catch((err) => sendChannelMessage(state, `Auth failed: ${err.message}`));
      break;

    case 'connected':
      if (state.pendingJoinCode) {
        wsSend(state, 'join_room', { code: state.pendingJoinCode });
      }
      break;

    case 'room_state':
      state.room = data.room || null;
      state.playback = data.playback || null;
      state.members = data.members || [];
      syncPlayback(state);
      break;

    case 'now_playing':
      state.playback = data || state.playback;
      syncPlayback(state);
      break;

    case 'playback_state':
      state.playback = data || state.playback;
      syncPlayback(state);
      break;

    case 'playback_seek':
      state.playback = data || state.playback;
      if (state.playback && state.playback.currentItem) {
        playTrack(state, state.playback.currentItem, state.playback.positionMs || 0);
      }
      break;

    case 'queue_updated':
      if (!state.playback) state.playback = {};
      state.playback.queue = data.queue || [];
      state.playback.autoplayQueue = data.autoplayQueue || [];
      break;

    case 'room_closed':
      sendChannelMessage(state, `Room closed: ${data?.reason || 'unknown reason'}`);
      cleanupState(state);
      break;

    case 'error':
      sendChannelMessage(state, `Backend error: ${data?.message || 'unknown error'}`);
      break;

    default:
      break;
  }
}

function cleanupState(state) {
  if (state.ws) {
    try { state.ws.close(1000, 'Leaving'); } catch {}
  }
  if (state.voiceConnection) {
    try { state.voiceConnection.destroy(); } catch {}
  }
  state.ws = null;
  state.voiceConnection = null;
  state.roomCode = null;
  state.room = null;
  state.playback = null;
  state.members = [];
  state.pendingJoinCode = null;
  state.lastTrackId = null;
  state.lastIsPlaying = null;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('join')
      .setDescription('Join a SpotiSync room and your current voice channel')
      .addStringOption((opt) => opt.setName('code').setDescription('Room join code').setRequired(true)),
    new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Leave the current room and voice channel'),
    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('Show the current queue'),
    new SlashCommandBuilder()
      .setName('add')
      .setDescription('Search and add a track to the queue')
      .addStringOption((opt) => opt.setName('query').setDescription('Search query').setRequired(true)),
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Vote to skip the current track'),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  if (DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: commands });
    console.log('[Bot] Registered guild commands');
  } else {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), { body: commands });
    console.log('[Bot] Registered global commands');
  }
}

client.once('ready', async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error('[Bot] Command registration failed:', err.message);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const guildId = interaction.guildId;
  if (!guildId) return;

  const state = getGuildState(guildId);
  state.textChannelId = interaction.channelId;

  if (interaction.commandName === 'join') {
    const code = interaction.options.getString('code', true).trim().toUpperCase();
    const member = interaction.member;
    const voice = member && member.voice && member.voice.channel ? member.voice.channel : null;

    if (!voice) {
      await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
      return;
    }

    connectVoice(state, voice);
    await interaction.reply(`Joining room ${code} and voice channel ${voice.name}...`);
    await connectRoom(state, code);
    return;
  }

  if (interaction.commandName === 'leave') {
    cleanupState(state);
    await interaction.reply('Disconnected from room and voice channel.');
    return;
  }

  if (interaction.commandName === 'queue') {
    const queue = state.playback && Array.isArray(state.playback.queue) ? state.playback.queue : [];
    if (queue.length === 0) {
      await interaction.reply('Queue is empty.');
      return;
    }
    const lines = queue.slice(0, 10).map((item, i) => {
      const title = item.title || 'Unknown Title';
      const artist = item.artist || 'Unknown Artist';
      return `${i + 1}. ${title} - ${artist}`;
    });
    const extra = queue.length > 10 ? `\n...and ${queue.length - 10} more` : '';
    await interaction.reply(`Queue (${queue.length}):\n${lines.join('\n')}${extra}`);
    return;
  }

  if (interaction.commandName === 'add') {
    const query = interaction.options.getString('query', true).trim();
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      await interaction.reply('Not connected to a room. Use /join first.');
      return;
    }

    try {
      const res = await apiFetch(`/api/search?q=${encodeURIComponent(query)}&limit=1`, { method: 'GET' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Search failed (${res.status}): ${text}`);
      }
      const data = await res.json();
      const track = data.results && data.results[0];
      if (!track) {
        await interaction.reply(`No results for: ${query}`);
        return;
      }

      const ok = wsSend(state, 'queue_add', { item: track });
      if (!ok) throw new Error('WebSocket not ready');
      await interaction.reply(`Added to queue: ${track.title} - ${track.artist}`);
    } catch (err) {
      await interaction.reply(`Add failed: ${err.message}`);
    }
    return;
  }

  if (interaction.commandName === 'skip') {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      await interaction.reply('Not connected to a room. Use /join first.');
      return;
    }
    const trackId = state.playback && state.playback.currentItem ? state.playback.currentItem.videoId : null;
    if (!trackId) {
      await interaction.reply('Nothing is playing.');
      return;
    }
    const ok = wsSend(state, 'vote', { action: 'skip', trackId });
    if (!ok) {
      await interaction.reply('Failed to send vote.');
      return;
    }
    await interaction.reply('Voted to skip.');
  }
});

client.login(DISCORD_TOKEN);
