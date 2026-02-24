const searchService = require('../search/service');

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'feat', 'official',
  'video', 'audio', 'music', 'lyrics', 'remix', 'version', 'radio', 'edit',
  'live', 'session', 'mix', 'song', 'full',
  'i', 'me', 'my', 'you', 'your', 'yours', 'we', 'our', 'ours', 'us',
]);

function normalizeProfile(profile = {}) {
  return {
    artistWeights: { ...(profile.artistWeights || {}) },
    tokenWeights: { ...(profile.tokenWeights || {}) },
    genreWeights: { ...(profile.genreWeights || {}) },
    recentTrackIds: Array.isArray(profile.recentTrackIds) ? [...profile.recentTrackIds] : [],
    recentArtists: Array.isArray(profile.recentArtists) ? [...profile.recentArtists] : [],
    recentGenres: Array.isArray(profile.recentGenres) ? [...profile.recentGenres] : [],
    recentAutoplayIds: Array.isArray(profile.recentAutoplayIds) ? [...profile.recentAutoplayIds] : [],
    recentSignatures: Array.isArray(profile.recentSignatures) ? [...profile.recentSignatures] : [],
    autoplayExcludedIds: Array.isArray(profile.autoplayExcludedIds) ? [...profile.autoplayExcludedIds] : [],
    autoplayExcludedSignatures: Array.isArray(profile.autoplayExcludedSignatures)
      ? [...profile.autoplayExcludedSignatures]
      : [],
    autoplaySeeded: !!profile.autoplaySeeded,
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

function normalizeTitleForSignature(title = '') {
  return String(title)
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/feat\.?|ft\.?|featuring/gi, ' ')
    .replace(/[-–—].*$/g, ' ')
    .replace(/(remix|mix|dj|edit|version|live|acoustic|radio|cover|karaoke|instrumental|demo|alternate|deluxe|mono|stereo|remastered|re-?recorded|session|single|album|explicit|clean|extended|cut|intro|outro|solo|club|vip|bootleg|sped|slowed|nightcore|rework|dub|festival|mixshow)/gi, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTrackSignature(track) {
  if (!track) return null;
  const artist = splitArtists(track.artist || '')[0] || '';
  const title = normalizeTitleForSignature(track.title || '');
  if (!artist || !title) return null;
  return `${artist}::${title}`;
}

function getSignatureTokens(track) {
  const artist = splitArtists(track?.artist || '')[0] || '';
  const title = normalizeTitleForSignature(track?.title || '');
  if (!artist || !title) return null;
  const tokens = tokenize(title).slice(0, 8);
  if (!tokens.length) return null;
  return { artist, tokens };
}

function getTopKeys(weights = {}, limit = 5) {
  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => key);
}

function getGenre(track) {
  if (!track) return null;
  return (track.genre || '')
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+music$/, '') // normalize "pop music" -> "pop"
    || null;
}

function decayWeights(weights, factor = 0.985) {
  const out = {};
  for (const [k, v] of Object.entries(weights || {})) {
    const next = Number(v) * factor;
    if (Math.abs(next) >= 0.1) out[k] = Number(next.toFixed(4));
  }
  return out;
}

function learnFromTrack(profile, track, options = {}) {
  if (!track || !track.videoId) return normalizeProfile(profile);

  const p = normalizeProfile(profile);
  const rawWeight = Number(options.weight ?? 1);
  const clipped = Math.max(-2, Math.min(2, rawWeight));
  // Autoplay selections should nudge taste lightly to avoid genre lock-in
  const attenuated = options.isAutoplay ? clipped * 0.25 : clipped;
  const magnitude = Math.max(0.1, Math.abs(attenuated));
  const weight = Math.sign(attenuated) * magnitude;
  p.artistWeights = decayWeights(p.artistWeights);
  p.tokenWeights = decayWeights(p.tokenWeights);
  p.genreWeights = decayWeights(p.genreWeights);

  const artists = splitArtists(track.artist);
  artists.forEach((artist, i) => {
    p.artistWeights[artist] = Number(((p.artistWeights[artist] || 0) + weight * (1 - i * 0.18)).toFixed(4));
  });

  const tokens = tokenize(`${track.title || ''} ${track.album || ''}`);
  tokens.forEach((token, i) => {
    p.tokenWeights[token] = Number(((p.tokenWeights[token] || 0) + weight * (0.7 - i * 0.05)).toFixed(4));
  });

  const genre = getGenre(track);
  if (genre) {
    p.genreWeights[genre] = Number(((p.genreWeights[genre] || 0) + weight * 1.05).toFixed(4));
    p.recentGenres = [...p.recentGenres.filter(g => g !== genre), genre].slice(-60);
  }

  if (options.isAutoplay) {
    p.recentAutoplayIds = [...p.recentAutoplayIds.filter(id => id !== track.videoId), track.videoId].slice(-50);
  }

  const signatureTokens = getSignatureTokens(track);
  if (signatureTokens) {
    const recent = p.recentSignatures.filter(s => s?.artist && Array.isArray(s.tokens));
    recent.push(signatureTokens);
    p.recentSignatures = recent.slice(-120);
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
  const topGenres = getTopKeys(profile.genreWeights, 4);
  const seedArtists = splitArtists(seedTrack?.artist || '');
  const seedTokens = tokenize(`${seedTrack?.title || ''} ${seedTrack?.album || ''}`).slice(0, 4);
  const seedGenre = getGenre(seedTrack);

  const base = [];
  if (seedArtists.length) base.push(`${seedArtists[0]} radio`);
  if (seedArtists.length && topArtists.length) base.push(`${seedArtists[0]} ${topArtists[0]} mix`);
  if (topArtists.length >= 2) base.push(`${topArtists[0]} ${topArtists[1]} music mix`);
  if (topArtists.length && topTokens.length) base.push(`${topArtists[0]} ${topTokens[0]} playlist`);
  if (seedArtists.length && seedTokens.length) base.push(`${seedArtists[0]} ${seedTokens[0]}`);
  if (variety >= 60 && topTokens.length) base.push(`${topTokens[0]} ${topTokens[1] || ''} fresh music`);
  if (variety < 60 && topArtists.length) base.push(`${topArtists[0]} similar songs`);
  if (seedGenre) base.push(`${seedGenre} hits`);
  if (topGenres.length) base.push(`${topGenres[0]} mix`);
  base.push('popular music mix');

  return unique(base).slice(0, 5);
}

function candidateScore(track, ctx) {
  const variety = Math.max(0, Math.min(100, Number(ctx.settings?.autoplayVariety ?? 35)));
  const varietyBias = variety / 100;
  const artists = splitArtists(track.artist);
  const tokens = tokenize(`${track.title || ''} ${track.album || ''}`);
  const genre = getGenre(track);

  let artistAffinity = 0;
  let tokenAffinity = 0;
  let genreAffinity = 0;
  const queueBoost = ctx.queueBoost || {};
  artists.forEach(a => {
    artistAffinity += (ctx.profile.artistWeights[a] || 0) + (queueBoost.artistWeights?.[a] || 0);
  });
  tokens.forEach(t => {
    tokenAffinity += (ctx.profile.tokenWeights[t] || 0) + (queueBoost.tokenWeights?.[t] || 0);
  });
  if (genre) {
    genreAffinity += (ctx.profile.genreWeights[genre] || 0) + (queueBoost.genreWeights?.[genre] || 0);
  }

  const recentlyUsedArtist = artists.some(a => ctx.recentArtists.has(a));
  const recentlyUsedGenre = genre ? ctx.recentGenres.has(genre) : false;
  const recentPenalty = recentlyUsedArtist ? (0.8 + varietyBias * 1.4) : 0;
  const noveltyBoost = recentlyUsedArtist ? 0 : (0.6 + varietyBias * 1.2);
  const genreBoost = genre && !recentlyUsedGenre ? 0.35 * (1 + varietyBias) : 0;

  return genreAffinity * 2.2
    + artistAffinity * 1.7
    + tokenAffinity * 0.35
    + noveltyBoost
    + genreBoost
    - recentPenalty
    + Math.random() * 0.12;
}

function buildQueueWeights(state) {
  const queue = Array.isArray(state?.queue) ? state.queue : [];
  const current = state?.currentItem ? [state.currentItem] : [];
  const pool = [...current, ...queue].filter(Boolean);
  if (pool.length === 0) return null;

  const artistWeights = {};
  const tokenWeights = {};
  const genreWeights = {};

  pool.forEach((track, idx) => {
    const bias = idx === 0 && track === state.currentItem ? 0.45 : 0.35;
    const decay = Math.max(0.15, 1 - idx * 0.08);
    const weight = bias * decay;

    const artists = splitArtists(track.artist);
    artists.forEach((artist, i) => {
      const w = weight * (1 - i * 0.2);
      artistWeights[artist] = Number(((artistWeights[artist] || 0) + w).toFixed(4));
    });

    const tokens = tokenize(`${track.title || ''} ${track.album || ''}`);
    tokens.forEach((token, i) => {
      const w = weight * (0.6 - i * 0.05);
      if (w > 0) tokenWeights[token] = Number(((tokenWeights[token] || 0) + w).toFixed(4));
    });

    const genre = getGenre(track);
    if (genre) {
      genreWeights[genre] = Number(((genreWeights[genre] || 0) + weight * 0.9).toFixed(4));
    }
  });

  return { artistWeights, tokenWeights, genreWeights };
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
  const queueBoost = buildQueueWeights(state);
  const historySize = Math.max(5, Math.min(60, Number(settings.autoplayHistorySize ?? 20)));
  const disallowExplicit = settings.autoplayAllowExplicit === false;
  const excludedIds = new Set(profile.autoplayExcludedIds.slice(-200));
  const excludedSignatures = new Set(profile.autoplayExcludedSignatures.slice(-200));
  const recentSignaturePool = [
    ...(profile.recentSignatures || []),
  ];
  const currentSignature = getSignatureTokens(state?.currentItem);
  if (currentSignature) recentSignaturePool.push(currentSignature);
  for (const t of state?.queue || []) {
    const sig = getSignatureTokens(t);
    if (sig) recentSignaturePool.push(sig);
  }
  for (const t of state?.autoplayQueue || []) {
    const sig = getSignatureTokens(t);
    if (sig) recentSignaturePool.push(sig);
  }
  const recentIds = new Set([
    ...(state?.queue || []).map(t => t?.videoId).filter(Boolean),
    ...(state?.autoplayQueue || []).map(t => t?.videoId).filter(Boolean),
    state?.currentItem?.videoId,
    ...profile.recentTrackIds.slice(-historySize),
    ...profile.recentAutoplayIds.slice(-25),
  ]);
  const recentGenres = new Set(profile.recentGenres.slice(-Math.max(6, historySize / 2)));

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
      if (excludedIds.has(track.videoId)) continue;
      if (disallowExplicit && track.isExplicit) continue;
      const signature = getTrackSignature(track);
      if (signature && excludedSignatures.has(signature)) continue;
      const candidateSig = getSignatureTokens(track);
      if (candidateSig && recentSignaturePool.length) {
        const candidateSet = new Set(candidateSig.tokens);
        const hasOverlap = recentSignaturePool.some((sig) => {
          if (sig.artist !== candidateSig.artist) return false;
          let overlap = 0;
          for (const tok of sig.tokens) {
            if (candidateSet.has(tok)) overlap++;
            if (overlap >= 3) return true;
          }
          return false;
        });
        if (hasOverlap) continue;
      }
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
        queueBoost,
        recentArtists: new Set(profile.recentArtists.slice(-Math.max(8, historySize))),
        recentGenres,
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
  getTrackSignature,
  findAutoplayTrack,
  findAutoplayCandidates,
};
