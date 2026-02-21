const searchService = require('../search/service');

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'feat', 'official',
  'video', 'audio', 'music', 'lyrics', 'remix', 'version', 'radio', 'edit',
  'live', 'session', 'mix', 'song', 'full',
]);

function normalizeProfile(profile = {}) {
  return {
    artistWeights: { ...(profile.artistWeights || {}) },
    tokenWeights: { ...(profile.tokenWeights || {}) },
    recentTrackIds: Array.isArray(profile.recentTrackIds) ? [...profile.recentTrackIds] : [],
    recentArtists: Array.isArray(profile.recentArtists) ? [...profile.recentArtists] : [],
    recentAutoplayIds: Array.isArray(profile.recentAutoplayIds) ? [...profile.recentAutoplayIds] : [],
    lastUpdatedAt: profile.lastUpdatedAt || Date.now(),
  };
}

function splitArtists(artist = '') {
  return String(artist)
    .toLowerCase()
    .split(/,|&| x | feat\.?| ft\.?| and /gi)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t))
    .slice(0, 10);
}

function getTopKeys(weights = {}, limit = 5) {
  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

function decayWeights(weights, factor = 0.985) {
  const out = {};
  for (const [k, v] of Object.entries(weights || {})) {
    const next = Number(v) * factor;
    if (next >= 0.1) out[k] = Number(next.toFixed(4));
  }
  return out;
}

function learnFromTrack(profile, track, options = {}) {
  if (!track || !track.videoId) return normalizeProfile(profile);

  const p = normalizeProfile(profile);
  const baseWeight = Math.max(0.1, Number(options.weight ?? 1));
  // Autoplay selections should nudge taste lightly to avoid genre lock-in
  const weight = options.isAutoplay ? baseWeight * 0.25 : baseWeight;
  p.artistWeights = decayWeights(p.artistWeights);
  p.tokenWeights = decayWeights(p.tokenWeights);

  const artists = splitArtists(track.artist);
  artists.forEach((artist, i) => {
    p.artistWeights[artist] = Number(((p.artistWeights[artist] || 0) + weight * (1 - i * 0.18)).toFixed(4));
  });

  const tokens = tokenize(`${track.title || ''} ${track.album || ''}`);
  tokens.forEach((token, i) => {
    p.tokenWeights[token] = Number(((p.tokenWeights[token] || 0) + weight * (0.7 - i * 0.05)).toFixed(4));
  });

  if (options.isAutoplay) {
    p.recentAutoplayIds = [...p.recentAutoplayIds.filter(id => id !== track.videoId), track.videoId].slice(-50);
  }

  p.recentTrackIds = [...p.recentTrackIds.filter(id => id !== track.videoId), track.videoId].slice(-120);
  p.recentArtists = [...p.recentArtists, ...artists].slice(-80);
  p.lastUpdatedAt = Date.now();
  return p;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildQueries({ settings, profile, seedTrack }) {
  const variety = Math.max(0, Math.min(100, Number(settings?.autoplayVariety ?? 35)));
  const topArtists = getTopKeys(profile.artistWeights, 5);
  const topTokens = getTopKeys(profile.tokenWeights, 6);
  const seedArtists = splitArtists(seedTrack?.artist || '');
  const seedTokens = tokenize(`${seedTrack?.title || ''} ${seedTrack?.album || ''}`).slice(0, 4);

  const base = [];
  if (seedArtists.length) base.push(`${seedArtists[0]} radio`);
  if (seedArtists.length && topArtists.length) base.push(`${seedArtists[0]} ${topArtists[0]} mix`);
  if (topArtists.length >= 2) base.push(`${topArtists[0]} ${topArtists[1]} music mix`);
  if (topArtists.length && topTokens.length) base.push(`${topArtists[0]} ${topTokens[0]} playlist`);
  if (seedArtists.length && seedTokens.length) base.push(`${seedArtists[0]} ${seedTokens[0]}`);
  if (variety >= 60 && topTokens.length) base.push(`${topTokens[0]} ${topTokens[1] || ''} fresh music`);
  if (variety < 60 && topArtists.length) base.push(`${topArtists[0]} similar songs`);
  base.push('popular music mix');

  return unique(base).slice(0, 5);
}

function candidateScore(track, ctx) {
  const variety = Math.max(0, Math.min(100, Number(ctx.settings?.autoplayVariety ?? 35)));
  const varietyBias = variety / 100;
  const artists = splitArtists(track.artist);
  const tokens = tokenize(`${track.title || ''} ${track.album || ''}`);

  let artistAffinity = 0;
  let tokenAffinity = 0;
  artists.forEach(a => { artistAffinity += ctx.profile.artistWeights[a] || 0; });
  tokens.forEach(t => { tokenAffinity += ctx.profile.tokenWeights[t] || 0; });

  const recentlyUsedArtist = artists.some(a => ctx.recentArtists.has(a));
  const recentPenalty = recentlyUsedArtist ? (0.8 + varietyBias * 1.4) : 0;
  const noveltyBoost = recentlyUsedArtist ? 0 : (0.6 + varietyBias * 1.2);

  return artistAffinity * 1.8 + tokenAffinity * 0.9 + noveltyBoost - recentPenalty + Math.random() * 0.15;
}

async function findAutoplayTrack({ state, settings }) {
  if (!settings?.autoplayEnabled) return null;

  const candidates = await findAutoplayCandidates({ state, settings, limit: 12 });
  if (!candidates.length) return null;

  const variety = Math.max(0, Math.min(100, Number(settings.autoplayVariety ?? 35)));
  const topPoolSize = Math.max(1, Math.min(6, Math.round(1 + variety / 20)));
  const topPool = candidates.slice(0, topPoolSize);
  const selected = topPool[Math.floor(Math.random() * topPool.length)] || candidates[0];
  return selected || null;
}

async function findAutoplayCandidates({ state, settings, limit = 10 }) {
  if (!settings?.autoplayEnabled) return [];

  const profile = normalizeProfile(state?.autoplayProfile);
  const historySize = Math.max(5, Math.min(60, Number(settings.autoplayHistorySize ?? 20)));
  const disallowExplicit = settings.autoplayAllowExplicit === false;
  const recentIds = new Set([
    ...(state?.queue || []).map(t => t?.videoId).filter(Boolean),
    state?.currentItem?.videoId,
    ...profile.recentTrackIds.slice(-historySize),
    ...profile.recentAutoplayIds.slice(-25),
  ]);

  const queries = buildQueries({ settings, profile, seedTrack: state?.currentItem });
  const candidatesById = new Map();

  for (const query of queries) {
    let results = [];
    try {
      results = await searchService.search(query, 20);
    } catch {
      continue;
    }
    for (const track of results) {
      if (!track?.videoId || recentIds.has(track.videoId)) continue;
      if (disallowExplicit && track.isExplicit) continue;
      if (!candidatesById.has(track.videoId)) candidatesById.set(track.videoId, track);
    }
  }

  const candidates = [...candidatesById.values()];
  if (candidates.length === 0) return [];

  const scored = candidates
    .map(track => ({
      track,
      score: candidateScore(track, {
        settings,
        profile,
        recentArtists: new Set(profile.recentArtists.slice(-Math.max(8, historySize))),
      }),
    }))
    .sort((a, b) => b.score - a.score);

  return scored
    .slice(0, limit)
    .map(entry => ({ ...entry.track, source: 'autoplay' }));
}

module.exports = {
  normalizeProfile,
  learnFromTrack,
  findAutoplayTrack,
  findAutoplayCandidates,
};
