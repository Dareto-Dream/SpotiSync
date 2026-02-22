import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Lightweight HTMLAudio-based player that consumes proxied audio streams.
 * Exposes the same surface as the previous YouTube hook for minimal UI churn.
 */
export function useAudioStreamPlayer({ onEnded, onReady }) {
  const audioRef = useRef(null);
  const readyRef = useRef(false);
  const [playerState, setPlayerState] = useState('locked');
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';

    const handleCanPlay = () => {
      if (!readyRef.current) {
        readyRef.current = true;
        setPlayerState('locked');
        onReady?.();
      }
    };

    const handlePlay = () => setPlayerState('playing');
    const handlePause = () => setPlayerState('paused');
    const handleWaiting = () => setPlayerState('buffering');
    const handleEnded = () => {
      setPlayerState('ready');
      onEnded?.();
    };
    const handleError = (e) => {
      console.error('[Player] audio error', e?.message || e?.type);
      setPlayerState('error');
    };

    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audioRef.current = null;
      readyRef.current = false;
    };
  }, [onEnded, onReady]);

  const loadVideo = useCallback((src, startMs = 0) => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    audio.src = src;
    try { audio.currentTime = Math.max(0, startMs / 1000); } catch {}
    audio.load();
    setPlayerState('locked');
  }, []);

  const unlockAndPlay = useCallback((src, startMs = 0) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (src) {
      audio.src = src;
      try { audio.currentTime = Math.max(0, startMs / 1000); } catch {}
      audio.load();
    }
    audio.play().catch(() => {});
    setPlayerState('playing');
  }, []);

  const play = useCallback(() => {
    audioRef.current?.play().catch(() => {});
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const seekTo = useCallback((ms) => {
    const audio = audioRef.current;
    if (!audio) return;
    try { audio.currentTime = Math.max(0, ms / 1000); } catch {}
  }, []);

  const getCurrentTimeMs = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return 0;
    return Math.round((audio.currentTime || 0) * 1000);
  }, []);

  const mute = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = true;
    setIsMuted(true);
  }, []);

  const unmute = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = false;
    setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) unmute();
    else mute();
  }, [isMuted, mute, unmute]);

  const syncToServer = useCallback((positionMs, isPlaying, threshold = 3000) => {
    const audio = audioRef.current;
    if (!audio || playerState === 'locked') return;

    const localMs = getCurrentTimeMs();
    const drift = Math.abs(localMs - positionMs);
    if (drift > threshold) {
      seekTo(positionMs);
    }

    const currentlyPlaying = !audio.paused && !audio.ended;
    if (isPlaying && !currentlyPlaying) {
      audio.play().catch(() => {});
    } else if (!isPlaying && currentlyPlaying) {
      audio.pause();
    }
  }, [getCurrentTimeMs, playerState, seekTo]);

  return {
    playerState,
    isMuted,
    loadVideo,
    unlockAndPlay,
    play,
    pause,
    seekTo,
    getCurrentTimeMs,
    mute,
    unmute,
    toggleMute,
    syncToServer,
    isReady: readyRef.current,
  };
}
