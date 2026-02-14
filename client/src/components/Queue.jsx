import React from 'react';
import { Play, Trash2, Music2, ListMusic } from 'lucide-react';

export default function Queue({ queue, isHost, onRemove, onPlay }) {
  if (queue.length === 0) {
    return (
      <div className="text-center py-16">
        <ListMusic className="w-10 h-10 text-white/[0.06] mx-auto mb-4" />
        <p className="text-white/20 text-sm">The queue is empty</p>
        <p className="text-white/10 text-xs mt-1">Search for tracks and add them here</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-[0.15em] text-white/20 font-medium px-3 mb-3">
        Up Next — {queue.length} {queue.length === 1 ? 'track' : 'tracks'}
      </p>

      {queue.map((track, i) => {
        const image = track.album?.images?.[track.album.images.length - 1]?.url || track.albumArt;
        const artists = track.artists?.map(a => a.name).join(', ') || 'Unknown';

        return (
          <div
            key={track.queueId}
            className="group flex items-center gap-3 p-3 rounded-xl hover:bg-white/[0.04] transition-all animate-slide-in"
            style={{ animationDelay: `${i * 0.05}s` }}
          >
            <span className="w-6 text-center text-xs text-white/15 font-['JetBrains_Mono'] font-medium shrink-0">
              {i + 1}
            </span>
            <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-white/[0.04]">
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
            {isHost && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onPlay(track.uri)}
                  className="w-8 h-8 rounded-lg bg-spotify-green/20 text-spotify-green flex items-center justify-center hover:bg-spotify-green/30 transition-colors"
                  title="Play now"
                >
                  <Play className="w-3.5 h-3.5 ml-0.5" />
                </button>
                <button
                  onClick={() => onRemove(track.queueId)}
                  className="w-8 h-8 rounded-lg bg-red-500/10 text-red-400 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                  title="Remove"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
