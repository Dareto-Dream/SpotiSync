import React, { useState, useCallback, useRef } from 'react';
import { Search as SearchIcon, Plus, Check, Loader2, Music2 } from 'lucide-react';

export default function Search({ sessionId, onAddToQueue }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [addedUris, setAddedUris] = useState(new Set());
  const debounceRef = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/spotify/search?q=${encodeURIComponent(q)}&sessionId=${sessionId}`
      );
      const data = await res.json();
      setResults(data.tracks?.items || []);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 350);
  };

  const handleAdd = (track) => {
    const simplified = {
      uri: track.uri,
      name: track.name,
      artists: track.artists.map(a => ({ name: a.name })),
      album: {
        name: track.album.name,
        images: track.album.images,
      },
      duration_ms: track.duration_ms,
      albumArt: track.album.images?.[0]?.url,
    };
    onAddToQueue(simplified);
    setAddedUris(prev => new Set([...prev, track.uri]));
    setTimeout(() => {
      setAddedUris(prev => {
        const next = new Set(prev);
        next.delete(track.uri);
        return next;
      });
    }, 3000);
  };

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <div className="relative">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/25" />
        <input
          type="text"
          value={query}
          onChange={handleInput}
          placeholder="Search for songs, artists, albums..."
          className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-white/25 outline-none focus:border-spotify-green/30 focus:bg-white/[0.06] transition-all"
          autoFocus
        />
        {loading && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/25 animate-spin" />
        )}
      </div>

      {/* Results */}
      {results.length === 0 && query && !loading && (
        <div className="text-center py-12">
          <Music2 className="w-8 h-8 text-white/10 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No tracks found</p>
        </div>
      )}

      {results.length === 0 && !query && (
        <div className="text-center py-16">
          <SearchIcon className="w-10 h-10 text-white/[0.06] mx-auto mb-4" />
          <p className="text-white/20 text-sm">Search Spotify's catalog to add tracks to the queue</p>
        </div>
      )}

      <div className="space-y-1">
        {results.map((track, i) => {
          const added = addedUris.has(track.uri);
          const image = track.album?.images?.[track.album.images.length - 1]?.url;
          const artists = track.artists?.map(a => a.name).join(', ');
          const duration = formatMs(track.duration_ms);

          return (
            <div
              key={track.id}
              className="group flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.04] transition-all animate-slide-up"
              style={{ animationDelay: `${i * 0.03}s` }}
            >
              <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-white/[0.04]">
                {image ? (
                  <img src={image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Music2 className="w-4 h-4 text-white/15" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">{track.name}</p>
                <p className="text-xs text-white/35 truncate">{artists}</p>
              </div>

              <span className="text-xs text-white/20 font-['JetBrains_Mono'] mr-2">{duration}</span>

              <button
                onClick={() => handleAdd(track)}
                disabled={added}
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all
                  ${added
                    ? 'bg-spotify-green/20 text-spotify-green'
                    : 'bg-white/[0.04] text-white/30 opacity-0 group-hover:opacity-100 hover:bg-spotify-green/20 hover:text-spotify-green'
                  }`}
              >
                {added ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatMs(ms) {
  if (!ms) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
