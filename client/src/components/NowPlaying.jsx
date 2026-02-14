import React from 'react';
import { Music2 } from 'lucide-react';

function EqBar({ className }) {
  return <div className={`w-[3px] bg-spotify-green rounded-full ${className}`} />;
}

export default function NowPlaying({ track, isPlaying }) {
  if (!track) {
    return (
      <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-white/[0.04] flex items-center justify-center">
            <Music2 className="w-6 h-6 text-white/15" />
          </div>
          <div>
            <p className="text-sm text-white/30">Nothing playing</p>
            <p className="text-xs text-white/15">Search for tracks to get started</p>
          </div>
        </div>
      </div>
    );
  }

  const image = track.album?.images?.[0]?.url || track.albumArt;
  const artists = track.artists?.map(a => a.name).join(', ') || 'Unknown';

  return (
    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] relative overflow-hidden">
      {/* Blurred album art background */}
      {image && (
        <div
          className="absolute inset-0 opacity-20 blur-2xl scale-150"
          style={{ backgroundImage: `url(${image})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      )}

      <div className="relative flex items-center gap-3">
        {/* Album Art */}
        <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 shadow-lg">
          {image ? (
            <img src={image} alt="" className={`w-full h-full object-cover ${isPlaying ? '' : 'opacity-60'}`} />
          ) : (
            <div className="w-full h-full bg-white/[0.04] flex items-center justify-center">
              <Music2 className="w-6 h-6 text-white/15" />
            </div>
          )}
          {isPlaying && (
            <div className="absolute inset-0 bg-black/30 flex items-end justify-center gap-[2px] pb-1.5">
              <EqBar className="animate-eq-1" />
              <EqBar className="animate-eq-2" />
              <EqBar className="animate-eq-3" />
              <EqBar className="animate-eq-4" />
            </div>
          )}
        </div>

        {/* Track Info */}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.15em] text-spotify-green/70 font-medium mb-0.5">
            {isPlaying ? 'Now Playing' : 'Paused'}
          </p>
          <p className="text-sm font-semibold text-white truncate">{track.name}</p>
          <p className="text-xs text-white/40 truncate">{artists}</p>
        </div>
      </div>
    </div>
  );
}
