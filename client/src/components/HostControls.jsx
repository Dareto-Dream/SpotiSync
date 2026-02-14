import React from 'react';
import { Play, Pause, SkipForward, Wifi, WifiOff, Loader2 } from 'lucide-react';

export default function HostControls({
  isPlaying,
  connectionState,
  deviceId,
  onConnect,
  onPlay,
  onPause,
  onNext,
  onToggle,
  playerState,
  error,
}) {
  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';
  const isReady = connectionState === 'ready';
  const isDisconnected = connectionState === 'disconnected';

  return (
    <div className="mt-4 space-y-3">
      {/* Connection Status & Button */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03]">
          {isConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-spotify-green" />
              <span className="text-[11px] text-spotify-green/80 font-medium">Web Player Connected</span>
            </>
          ) : isConnecting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 text-yellow-500 animate-spin" />
              <span className="text-[11px] text-yellow-500/80 font-medium">Connecting...</span>
            </>
          ) : isReady ? (
            <>
              <WifiOff className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-[11px] text-yellow-500/80 font-medium">Ready to Connect</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-white/30" />
              <span className="text-[11px] text-white/30 font-medium">Initializing player...</span>
            </>
          )}
        </div>

        {/* Connect Button - only show when ready but not connected */}
        {(isReady || isDisconnected) && !isConnected && (
          <button
            onClick={onConnect}
            disabled={isDisconnected || isConnecting}
            className="w-full px-4 py-3 rounded-xl bg-spotify-green/20 text-spotify-green font-semibold text-sm transition-all hover:bg-spotify-green/30 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isConnecting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Wifi className="w-4 h-4" />
                Connect Web Player
              </>
            )}
          </button>
        )}

        {/* Error Message */}
        {error && (
          <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">
            {error}
          </div>
        )}
      </div>

      {/* Playback Controls */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={isPlaying ? (onToggle || onPause) : (onToggle || onPlay)}
          disabled={!isConnected}
          className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-black transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
        <button
          onClick={onNext}
          disabled={!isConnected}
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

      {/* Info */}
      {!isConnected && (
        <div className="px-3 py-2 rounded-xl bg-white/[0.02] text-[10px] text-white/30 text-center">
          Click "Connect Web Player" to start playback in your browser
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
