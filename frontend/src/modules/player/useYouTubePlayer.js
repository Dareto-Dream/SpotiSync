import { useRef, useEffect, useCallback, useState } from 'react';

/**
 * Manages YouTube IFrame Player API instance.
 * Handles: autoplay policy, drift correction, sync with server state.
 */
export function useYouTubePlayer({ containerId, onEnded, onReady }) {
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const [playerState, setPlayerState] = useState('unloaded'); // unloaded|locked|ready|playing|paused|buffering
  const [isMuted, setIsMuted] = useState(false);
  const syncTimerRef = useRef(null);

  // Initialize player once YT API is available
  useEffect(() => {
    let retries = 0;
    const maxRetries = 30;

    function tryInit() {
      if (typeof window.YT !== 'undefined' && window.YT.Player) {
        createPlayer();
      } else if (retries < maxRetries) {
        retries++;
        setTimeout(tryInit, 500);
      } else {
        console.error('[Player] YouTube IFrame API failed to load');
        setPlayerState('error');
      }
    }

    function createPlayer() {
      if (playerRef.current) return;

      playerRef.current = new window.YT.Player(containerId, {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          playsinline: 1, // Required for iOS
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            readyRef.current = true;
            setPlayerState('locked'); // locked until user gesture
            onReady?.();
          },
          onStateChange: (e) => {
            const YT = window.YT.PlayerState;
            if (e.data === YT.PLAYING) setPlayerState('playing');
            else if (e.data === YT.PAUSED) setPlayerState('paused');
            else if (e.data === YT.BUFFERING) setPlayerState('buffering');
            else if (e.data === YT.ENDED) {
              setPlayerState('ready');
              onEnded?.();
            }
          },
          onError: (e) => {
            console.error('[Player] YT error', e.data);
            // Codes: 2=invalid id, 5=html5 not supported, 100=not found, 101/150=embedding disabled
            setPlayerState('error');
          },
        },
      });
    }

    tryInit();

    return () => {
      clearInterval(syncTimerRef.current);
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch {}
        playerRef.current = null;
        readyRef.current = false;
      }
    };
  }, []); // Only once

  const loadVideo = useCallback((videoId, startSeconds = 0) => {
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    p.loadVideoById({ videoId, startSeconds: Math.max(0, Math.floor(startSeconds / 1000)) });
  }, []);

  // "Unlock" after user gesture - required by browser autoplay policy
  const unlockAndPlay = useCallback((videoId, startSeconds = 0) => {
    const p = playerRef.current;
    if (!p) return;
    if (videoId) {
      p.loadVideoById({ videoId, startSeconds: Math.max(0, Math.floor(startSeconds / 1000)) });
    } else {
      p.playVideo();
    }
    setPlayerState('playing');
  }, []);

  const play = useCallback(() => {
    playerRef.current?.playVideo();
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo();
  }, []);

  const seekTo = useCallback((ms) => {
    playerRef.current?.seekTo(Math.max(0, ms / 1000), true);
  }, []);

  const getCurrentTimeMs = useCallback(() => {
    if (!playerRef.current || !readyRef.current) return 0;
    try {
      return Math.round((playerRef.current.getCurrentTime() || 0) * 1000);
    } catch { return 0; }
  }, []);

  const mute = useCallback(() => {
    playerRef.current?.mute();
    setIsMuted(true);
  }, []);

  const unmute = useCallback(() => {
    playerRef.current?.unMute();
    setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    if (isMuted) unmute();
    else mute();
  }, [isMuted, mute, unmute]);

  /**
   * Sync to server playback state.
   * positionMs: expected current position (already drift-adjusted from server)
   * Applies correction if drift > threshold.
   */
  const syncToServer = useCallback((positionMs, isPlaying, threshold = 3000) => {
    const p = playerRef.current;
    if (!p || !readyRef.current || playerState === 'locked') return;

    const localMs = getCurrentTimeMs();
    const drift = Math.abs(localMs - positionMs);

    if (drift > threshold) {
      seekTo(positionMs);
    }

    const ytState = p.getPlayerState?.();
    const YT = window.YT?.PlayerState;
    const currentlyPlaying = ytState === YT?.PLAYING || ytState === YT?.BUFFERING;

    if (isPlaying && !currentlyPlaying) {
      p.playVideo();
    } else if (!isPlaying && currentlyPlaying) {
      p.pauseVideo();
    }
  }, [playerState, getCurrentTimeMs, seekTo]);

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
