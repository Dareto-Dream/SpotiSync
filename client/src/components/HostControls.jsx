import React from 'react';
import { Play, Pause, SkipForward, Volume2, Wifi, WifiOff } from 'lucide-react';

export default function HostControls({
  isPlaying,
  isReady,
  deviceId,
  onPlay,
  onPause,
  onNext,
  onToggle,
  playerState,
}) {
  return (
    <div className="mt-4 space-y-3">
      {/* SDK Status */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03]">
        {isReady ? (
          <>
            <Wifi className="w-3.5 h-3.5 text-spotify-green" />
            <span className="text-[11px] text-spotify-green/80 font-medium">Web Player Connected</span>
          </>
        ) : (
          <>
            <WifiOff className="w-3.5 h-3.5 text-white/30" />
            <span className="text-[11px] text-white/30 font-medium">Connecting player...</span>
          </>
        )}
      </div>

      {/* Playback Controls */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={isPlaying ? (onToggle || onPause) : (onToggle || onPlay)}
          disabled={!isReady}
          className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-black transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
        <button
          onClick={onNext}
          disabled={!isReady}
          className="w-10 h-10 rounded-full bg-white/[0.06] flex items-center justify-center text-white/60 transition-all hover:bg-white/[0.1] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>

      {/* Progress */}
      {playerState && (
        <div className="space-y-1">
          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full bg-spotify-green rounded-full transition-all duration-1000"
              style={{
                width: `${playerState.duration ? (playerState.position / playerState.duration) * 100 : 0}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-white/25 font-['JetBrains_Mono']">
            <span>{formatMs(playerState.position)}</span>
            <span>{formatMs(playerState.duration)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatMs(ms) {
  if (!ms) return '0:00';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
