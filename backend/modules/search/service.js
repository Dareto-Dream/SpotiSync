/**
 * Search module using ytmusic-api (community reverse-engineered library).
 * Dependency: https://www.npmjs.com/package/ytmusic-api
 * Risks: May break without notice if YouTube Music changes its internal API.
 * Not officially supported by Google/YouTube.
 */
let ytmusicClient = null;
let initPromise = null;

async function getClient() {
  if (ytmusicClient) return ytmusicClient;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const YTMusic = (await import('ytmusic-api')).default;
    const client = new YTMusic();
    await client.initialize();
    ytmusicClient = client;
    return client;
  })();

  return initPromise;
}

async function search(query, limit = 20) {
  try {
    const client = await getClient();
    const results = await client.searchSongs(query);
    return results.slice(0, limit).map(normalizeTrack);
  } catch (err) {
    console.error('[Search] ytmusic-api error:', err.message);
    throw Object.assign(new Error('Search failed: ' + err.message), { status: 503 });
  }
}

async function getTrack(videoId) {
  try {
    const client = await getClient();
    const results = await client.getSong(videoId);
    if (!results) return null;
    return normalizeTrack(results);
  } catch (err) {
    console.error('[Search] getTrack error:', err.message);
    return null;
  }
}

function normalizeTrack(raw) {
  return {
    videoId: raw.videoId || raw.id,
    title: raw.name || raw.title || 'Unknown Title',
    artist: Array.isArray(raw.artist)
      ? raw.artist.map(a => a.name || a).join(', ')
      : (raw.artist?.name || raw.artist || 'Unknown Artist'),
    album: raw.album?.name || raw.album || null,
    genre: raw.genre || raw.category || (Array.isArray(raw.categories) ? raw.categories[0] : null) || null,
    durationMs: (raw.duration?.totalSeconds || raw.duration || 0) * 1000,
    thumbnailUrl: pickThumbnail(raw.thumbnails || raw.thumbnail),
    isExplicit: raw.isExplicit || false,
  };
}

function pickThumbnail(thumbnails) {
  if (!thumbnails) return null;
  if (typeof thumbnails === 'string') return thumbnails;
  if (Array.isArray(thumbnails)) {
    // Pick largest available
    return thumbnails.sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;
  }
  return thumbnails.url || null;
}

module.exports = { search, getTrack, normalizeTrack };
