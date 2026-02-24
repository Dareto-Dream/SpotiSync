const searchService = require('../search/service');

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'feat', 'official',
  'video', 'audio', 'music', 'lyrics', 'version', 'radio', 'edit',
  'live', 'session', 'mix', 'song', 'full',
  'i', 'me', 'my', 'you', 'your', 'yours', 'we', 'our', 'ours', 'us',
]);

function normalizeProfile(profile = {}) {
  return {
    artistWeights: { ...(profile.artistWeights || {}) },
    tokenWeights: { ...(profile.tokenWeights || {}) },
    genreWeights: { ...(profile.genreWeights || {}) },
    eraWeights: { ...(profile.eraWeights || {}) },
    artistGraph: { ...(profile.artistGraph || {}) },
    recentTrackIds: Array.isArray(profile.recentTrackIds) ? [...profile.recentTrackIds] : [],
    recentArtists: Array.isArray(profile.recentArtists) ? [...profile.recentArtists] : [],
    recentGenres: Array.isArray(profile.recentGenres) ? [...profile.recentGenres] : [],
    recentEras: Array.isArray(profile.recentEras) ? [...profile.recentEras] : [],
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

function getEra(track) {
  if (!track) return null;
  const text = `${track.title || ''} ${track.album || ''}`.toLowerCase();
  const yearMatch = text.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    const decade = Math.floor(year / 10) * 10;
    return `${decade}s`;
  }
  const decadeMatch = text.match(/\b(50s|60s|70s|80s|90s|2000s|2010s|2020s)\b/);
  if (decadeMatch) return decadeMatch[1];
  const altMatch = text.match(/\b(80s|90s|00s|10s|20s)\b/);
  if (altMatch) {
    const mapped = altMatch[1] === '00s' ? '2000s'
      : altMatch[1] === '10s' ? '2010s'
        : altMatch[1] === '20s' ? '2020s'
          : altMatch[1];
    return mapped;
  }
  return null;
}

function decayWeights(weights, factor = 0.985) {
  const out = {};
  for (const [k, v] of Object.entries(weights || {})) {
    const next = Number(v) * factor;
    if (Math.abs(next) >= 0.1) out[k] = Number(next.toFixed(4));
  }
  return out;
}

function getAdaptiveDecay(profile) {
  const recentGenres = Array.isArray(profile?.recentGenres) ? profile.recentGenres.slice(-6) : [];
  const uniqueGenres = new Set(recentGenres.filter(Boolean));
  return uniqueGenres.size >= 4 ? 0.94 : 0.985;
}

function buildRecentWindow(profile, windowSize = 5) {
  const recent = Array.isArray(profile?.recentSignatures) ? profile.recentSignatures.slice(-windowSize) : [];
  const recentGenres = Array.isArray(profile?.recentGenres) ? profile.recentGenres.slice(-windowSize) : [];
  const recentEras = Array.isArray(profile?.recentEras) ? profile.recentEras.slice(-windowSize) : [];
  const artistWeights = {};
  const tokenWeights = {};
  const genreWeights = {};
  const eraWeights = {};

  recent.forEach((sig, idx) => {
    if (!sig?.artist || !Array.isArray(sig.tokens)) return;
    const weight = 1 - idx * 0.12;
    artistWeights[sig.artist] = Number(((artistWeights[sig.artist] || 0) + weight).toFixed(4));
    sig.tokens.slice(0, 6).forEach((token, i) => {
      const w = weight * (0.7 - i * 0.05);
      tokenWeights[token] = Number(((tokenWeights[token] || 0) + w).toFixed(4));
    });
  });

  recentGenres.forEach((genre, idx) => {
    if (!genre) return;
    const weight = 1 - idx * 0.12;
    genreWeights[genre] = Number(((genreWeights[genre] || 0) + weight * 0.9).toFixed(4));
  });

  recentEras.forEach((era, idx) => {
    if (!era) return;
    const weight = 1 - idx * 0.12;
    eraWeights[era] = Number(((eraWeights[era] || 0) + weight * 0.9).toFixed(4));
  });

  return { artistWeights, tokenWeights, genreWeights, eraWeights };
}

function pruneArtistGraph(graph) {
  const entries = Object.entries(graph || {});
  const capped = {};
  entries.forEach(([artist, neighbors]) => {
    const topNeighbors = Object.entries(neighbors || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .reduce((acc, [key, val]) => {
        acc[key] = val;
        return acc;
      }, {});
    capped[artist] = topNeighbors;
  });

  const artistScores = Object.entries(capped)
    .map(([artist, neighbors]) => ({
      artist,
      score: Object.values(neighbors || {}).reduce((sum, v) => sum + v, 0),
    }))
    .sort((a, b) => b.score - a.score);

  const keep = new Set(artistScores.slice(0, 200).map(entry => entry.artist));
  const pruned = {};
  keep.forEach((artist) => {
    pruned[artist] = capped[artist];
  });
  return pruned;
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
  const decay = getAdaptiveDecay(p);
  p.artistWeights = decayWeights(p.artistWeights, decay);
  p.tokenWeights = decayWeights(p.tokenWeights, decay);
  p.genreWeights = decayWeights(p.genreWeights, decay);
  p.eraWeights = decayWeights(p.eraWeights, decay);

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

  const era = getEra(track);
  if (era) {
    p.eraWeights[era] = Number(((p.eraWeights[era] || 0) + weight * 0.8).toFixed(4));
    p.recentEras = [...p.recentEras.filter(e => e !== era), era].slice(-40);
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

  if (artists.length && p.recentArtists.length) {
    const recentArtistWindow = p.recentArtists.slice(-12);
    const graph = { ...(p.artistGraph || {}) };
    artists.forEach((artist) => {
      if (!graph[artist]) graph[artist] = {};
      recentArtistWindow.forEach((other) => {
        if (!other || other === artist) return;
        graph[artist][other] = (graph[artist][other] || 0) + 1;
        if (!graph[other]) graph[other] = {};
        graph[other][artist] = (graph[other][artist] || 0) + 1;
      });
    });
    p.artistGraph = pruneArtistGraph(graph);
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

const ENERGY_HIGH_TOKENS = new Set([
  'remix', 'bass', 'phonk', 'trap', 'hardstyle', 'festival', 'hype', 'rave',
]);
const ENERGY_LOW_TOKENS = new Set([
  'acoustic', 'piano', 'instrumental', 'ambient', 'lofi', 'chill', 'downtempo',
]);

function energyScore(tokens = []) {
  let score = 0;
  tokens.forEach((token) => {
    if (ENERGY_HIGH_TOKENS.has(token)) score += 1;
    if (ENERGY_LOW_TOKENS.has(token)) score -= 1;
  });
  return score;
}

function artistSimilarityBoost(artists, ctx) {
  const graph = ctx.profile.artistGraph || {};
  if (!artists.length || !ctx.recentArtists.size) return 0;
  let total = 0;
  artists.forEach((artist) => {
    const neighbors = graph[artist] || {};
    ctx.recentArtists.forEach((recent) => {
      total += neighbors[recent] || 0;
    });
  });
  return Math.min(3, total * 0.08);
}

function candidateScore(track, ctx) {
  const variety = Math.max(0, Math.min(100, Number(ctx.settings?.autoplayVariety ?? 35)));
  const varietyBias = variety / 100;
  const artists = splitArtists(track.artist);
  const tokens = tokenize(`${track.title || ''} ${track.album || ''}`);
  const genre = getGenre(track);
  const era = getEra(track);

  let artistAffinity = 0;
  let tokenAffinity = 0;
  let genreAffinity = 0;
  let eraAffinity = 0;
  let recentArtistAffinity = 0;
  let recentTokenAffinity = 0;
  let recentGenreAffinity = 0;
  let recentEraAffinity = 0;
  let queueArtistAffinity = 0;
  let queueTokenAffinity = 0;
  let queueGenreAffinity = 0;
  const queueBoost = ctx.queueBoost || {};
  artists.forEach(a => {
    artistAffinity += (ctx.profile.artistWeights[a] || 0);
    queueArtistAffinity += (queueBoost.artistWeights?.[a] || 0);
    recentArtistAffinity += ctx.recentWindow.artistWeights?.[a] || 0;
  });
  tokens.forEach(t => {
    tokenAffinity += (ctx.profile.tokenWeights[t] || 0);
    queueTokenAffinity += (queueBoost.tokenWeights?.[t] || 0);
    recentTokenAffinity += ctx.recentWindow.tokenWeights?.[t] || 0;
  });
  if (genre) {
    genreAffinity += (ctx.profile.genreWeights[genre] || 0);
    queueGenreAffinity += (queueBoost.genreWeights?.[genre] || 0);
    recentGenreAffinity += ctx.recentWindow.genreWeights?.[genre] || 0;
  }
  if (era) {
    eraAffinity += (ctx.profile.eraWeights?.[era] || 0);
    recentEraAffinity += (ctx.recentWindow.eraWeights?.[era] || 0);
  }

  const recentlyUsedArtist = artists.some(a => ctx.recentArtists.has(a));
  const recentlyUsedGenre = genre ? ctx.recentGenres.has(genre) : false;
  const recentPenalty = recentlyUsedArtist ? (0.8 + varietyBias * 1.4) : 0;
  const noveltyBoost = recentlyUsedArtist ? 0 : (0.6 + varietyBias * 1.2);
  const genreBoost = genre && !recentlyUsedGenre ? 0.35 * (1 + varietyBias) : 0;

  const profileScore = genreAffinity * 2.2
    + artistAffinity * 1.7
    + tokenAffinity * 0.35
    + eraAffinity * 0.6;

  const recentWindowScore = recentGenreAffinity * 2.2
    + recentArtistAffinity * 1.7
    + recentTokenAffinity * 0.35
    + recentEraAffinity * 0.6;

  const queueScore = queueGenreAffinity * 1.6
    + queueArtistAffinity * 1.2
    + queueTokenAffinity * 0.3;

  const similarityBoost = artistSimilarityBoost(artists, ctx);

  const candidateEnergy = energyScore(tokens);
  const energyDistance = Math.abs(candidateEnergy - (ctx.recentEnergy || 0));
  const energyPenalty = energyDistance * 0.35;

  const hasArtistOverlap = artists.some(a => ctx.overlapArtists.has(a));
  const hasTokenOverlap = tokens.some(t => ctx.overlapTokens.has(t));
  const hasGenreOverlap = genre ? ctx.overlapGenres.has(genre) : false;
  const noveltySpikePenalty = (!hasArtistOverlap && !hasTokenOverlap && !hasGenreOverlap) ? 2.25 : 0;

  const score = (profileScore * 0.55)
    + (recentWindowScore * 1.35)
    + (queueScore * 0.6)
    + similarityBoost
    + noveltyBoost
    + genreBoost
    - recentPenalty
    - energyPenalty
    - noveltySpikePenalty
    + Math.random() * 0.12;

  return {
    score,
    meta: {
      primaryArtist: artists[0] || null,
      genre,
      era,
      profileArtistAffinity: artistAffinity,
      profileGenreAffinity: genreAffinity,
      recentGenreAffinity,
      similarityBoost,
    },
  };
}

function buildQueueWeights(state, scale = 1) {
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
    const weight = bias * decay * scale;

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

function detectSessionTakeover(state) {
  const queue = Array.isArray(state?.queue) ? state.queue : [];
  const recent = queue.slice(-6).filter(Boolean);
  if (recent.length < 4) return false;

  const counts = {};
  recent.forEach((track) => {
    const id = track?.addedBy?.id;
    if (!id) return;
    counts[id] = (counts[id] || 0) + 1;
  });

  return Object.values(counts).some(count => count >= 4);
}

async function findAutoplayTrack({ state, settings }) {
  if (!settings?.autoplayEnabled) return null;

  const scored = await buildAutoplayScoredCandidates({ state, settings });
  if (!scored.length) return null;

  const variety = Math.max(0, Math.min(100, Number(settings.autoplayVariety ?? 35)));
  const topPoolSize = Math.max(1, Math.min(6, Math.round(1 + variety / 20)));
  const topPool = scored.slice(0, topPoolSize);
  const profile = normalizeProfile(state?.autoplayProfile);
  const shouldDiscover = profile.recentAutoplayIds.length > 0 && profile.recentAutoplayIds.length % 5 === 0;

  if (shouldDiscover) {
    const discovery = scored
      .filter(entry => (entry.meta.profileArtistAffinity || 0) <= 0.2
        && ((entry.meta.profileGenreAffinity || 0) + (entry.meta.recentGenreAffinity || 0)) >= 0.8)
      .sort((a, b) => b.score - a.score)[0];
    if (discovery) return { ...discovery.track, source: 'autoplay' };
  }

  const selected = topPool[Math.floor(Math.random() * topPool.length)] || scored[0];
  return selected ? { ...selected.track, source: 'autoplay' } : null;
}

async function findAutoplayCandidates({ state, settings, limit = 10 }) {
  if (!settings?.autoplayEnabled) return [];

  const scored = await buildAutoplayScoredCandidates({ state, settings });
  if (!scored.length) return [];

  const reranked = rerankForVariety(scored, limit);
  return reranked.map(entry => ({ ...entry.track, source: 'autoplay' }));
}

async function buildAutoplayScoredCandidates({ state, settings }) {
  const profile = normalizeProfile(state?.autoplayProfile);
  const takeover = detectSessionTakeover(state);
  const queueBoost = buildQueueWeights(state, takeover ? 0.5 : 1);
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
  const recentArtistsWindow = profile.recentArtists.slice(-Math.max(8, historySize));
  const recentArtists = new Set(recentArtistsWindow);
  const hardArtistBlock = new Set(profile.recentArtists.slice(-3));
  const artistCooldown = new Set(profile.recentArtists.slice(-8));
  const genreCooldown = new Set(profile.recentGenres.slice(-3));
  const recentWindow = buildRecentWindow(profile, 5);
  const recentEnergy = energyScore(Object.keys(recentWindow.tokenWeights || {})) / Math.max(1, Object.keys(recentWindow.tokenWeights || {}).length);

  const queries = buildQueries({ settings, profile, seedTrack: state?.currentItem });
  const candidatesById = new Map();

  const seedResults = [];
  for (const query of queries) {
    let results = [];
    try {
      results = await searchService.search(query, 20);
    } catch {
      continue;
    }
    seedResults.push(...results);
  }

  const expandedSearches = new Set();
  const enqueueCandidate = (track) => {
    if (!track?.videoId || recentIds.has(track.videoId)) return;
    if (excludedIds.has(track.videoId)) return;
    if (disallowExplicit && track.isExplicit) return;
    const signature = getTrackSignature(track);
    if (signature && excludedSignatures.has(signature)) return;
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
      if (hasOverlap) return;
    }
    const artists = splitArtists(track.artist);
    if (artists.some(a => hardArtistBlock.has(a))) return;
    if (artists.some(a => artistCooldown.has(a))) return;
    const genre = getGenre(track);
    if (genre && genreCooldown.has(genre)) return;
    if (!candidatesById.has(track.videoId)) candidatesById.set(track.videoId, track);
  };

  seedResults.forEach(enqueueCandidate);

  const seedLimit = Math.min(35, seedResults.length);
  for (let i = 0; i < seedLimit; i++) {
    const seed = seedResults[i];
    if (!seed) continue;
    const artist = splitArtists(seed.artist)[0];
    const genre = getGenre(seed);

    if (artist && expandedSearches.size < 60) {
      const key = `artist:${artist}`;
      if (!expandedSearches.has(key)) {
        expandedSearches.add(key);
        try {
          const results = await searchService.search(`${artist} mix`, 20);
          results.forEach(enqueueCandidate);
        } catch {}
      }
    }

    if (genre && expandedSearches.size < 60) {
      const key = `genre:${genre}`;
      if (!expandedSearches.has(key)) {
        expandedSearches.add(key);
        try {
          const results = await searchService.search(`${genre} music`, 20);
          results.forEach(enqueueCandidate);
        } catch {}
      }
    }

    if (candidatesById.size >= 700) break;
  }

  const candidates = [...candidatesById.values()];
  if (candidates.length === 0) return [];

  const overlapArtists = new Set([
    ...Object.keys(profile.artistWeights || {}),
    ...Object.keys(recentWindow.artistWeights || {}),
  ]);
  const overlapTokens = new Set([
    ...Object.keys(profile.tokenWeights || {}),
    ...Object.keys(recentWindow.tokenWeights || {}),
  ]);
  const overlapGenres = new Set([
    ...Object.keys(profile.genreWeights || {}),
    ...Object.keys(recentWindow.genreWeights || {}),
  ]);

  return candidates
    .map(track => {
      const scored = candidateScore(track, {
        settings,
        profile,
        queueBoost,
        recentWindow,
        recentEnergy,
        recentArtists,
        recentGenres,
        overlapArtists,
        overlapTokens,
        overlapGenres,
      });
      return { track, score: scored.score, meta: scored.meta };
    })
    .sort((a, b) => b.score - a.score);
}

function rerankForVariety(scored, limit) {
  const picked = [];
  const usedIds = new Set();
  const usedArtists = new Set();
  const genreCounts = {};
  const topGenreWindow = 5;
  const maxGenreInTopWindow = 2;
  const maxSameArtistWindow = 10;

  for (const entry of scored) {
    if (picked.length >= limit) break;
    if (usedIds.has(entry.track.videoId)) continue;
    const { genre, primaryArtist } = entry.meta || {};
    if (picked.length < topGenreWindow && genre) {
      const count = genreCounts[genre] || 0;
      if (count >= maxGenreInTopWindow) continue;
    }
    if (picked.length < maxSameArtistWindow && primaryArtist && usedArtists.has(primaryArtist)) {
      continue;
    }
    picked.push(entry);
    usedIds.add(entry.track.videoId);
    if (primaryArtist) usedArtists.add(primaryArtist);
    if (genre) genreCounts[genre] = (genreCounts[genre] || 0) + 1;
  }

  if (picked.length < limit) {
    for (const entry of scored) {
      if (picked.length >= limit) break;
      if (usedIds.has(entry.track.videoId)) continue;
      picked.push(entry);
      usedIds.add(entry.track.videoId);
    }
  }

  return picked;
}

module.exports = {
  normalizeProfile,
  learnFromTrack,
  getTrackSignature,
  findAutoplayTrack,
  findAutoplayCandidates,
};
