import { useState, useEffect, useRef, useCallback } from 'react';

export function useSpotifyPlayer(accessToken) {
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [connectionState, setConnectionState] = useState('disconnected');
  const [error, setError] = useState(null);
  
  const playerRef = useRef(null);
  const sdkLoadedRef = useRef(false);
  const activatedRef = useRef(false);

  // Initialize SDK - define callback BEFORE loading script
  useEffect(() => {
    if (!accessToken || sdkLoadedRef.current) return;

    let mounted = true;

    // Define the callback FIRST (this is critical!)
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (!mounted || !accessToken) return;
      
      console.log('Spotify Web Playback SDK loaded');
      
      try {
        const p = new window.Spotify.Player({
          name: 'SpotiSync Party',
          getOAuthToken: (cb) => {
            cb(accessToken);
          },
          volume: 0.8,
        });

        // Ready event - SDK connected
        p.addListener('ready', ({ device_id }) => {
          if (!mounted) return;
          console.log('Spotify Player ready, device:', device_id);
          setDeviceId(device_id);
          setConnectionState('ready');
        });

        // Not ready - device went offline
        p.addListener('not_ready', ({ device_id }) => {
          console.log('Device went offline:', device_id);
          if (mounted) {
            setConnectionState('disconnected');
            setDeviceId(null);
          }
        });

        // Player state changed
        p.addListener('player_state_changed', (state) => {
          if (mounted && state) {
            setPlayerState(state);
          }
        });

        // Autoplay failed (mobile browsers)
        p.addListener('autoplay_failed', () => {
          console.log('Autoplay failed - user interaction required');
          if (mounted) {
            setError('Autoplay blocked. Please click Connect Web Player.');
          }
        });

        // Error handlers
        p.addListener('initialization_error', ({ message }) => {
          console.error('Init error:', message);
          if (mounted) {
            setError(message);
            setConnectionState('disconnected');
          }
        });

        p.addListener('authentication_error', ({ message }) => {
          console.error('Auth error:', message);
          if (mounted) {
            setError(message);
            setConnectionState('disconnected');
          }
        });

        p.addListener('account_error', ({ message }) => {
          console.error('Account error:', message);
          if (mounted) {
            setError(message);
            setConnectionState('disconnected');
          }
        });

        p.addListener('playback_error', ({ message }) => {
          console.error('Playback error:', message);
          if (mounted) {
            setError(message);
          }
        });

        playerRef.current = p;
        if (mounted) {
          setPlayer(p);
        }
      } catch (err) {
        console.error('Player creation error:', err);
        if (mounted) {
          setError(err.message);
          setConnectionState('disconnected');
        }
      }
    };

    // NOW load the SDK script (after callback is defined)
    if (!window.Spotify) {
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      document.body.appendChild(script);
      sdkLoadedRef.current = true;
    } else {
      // SDK already loaded, trigger callback
      window.onSpotifyWebPlaybackSDKReady();
    }

    return () => {
      mounted = false;
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
    };
  }, [accessToken]);

  // Activate element for mobile browsers (must be called from user gesture)
  const activateElement = useCallback(() => {
    if (playerRef.current && !activatedRef.current) {
      playerRef.current.activateElement();
      activatedRef.current = true;
      console.log('Player element activated for mobile playback');
    }
  }, []);

  // Connect method - must be called from user gesture
  const connect = useCallback(async () => {
    if (!playerRef.current) {
      setError('Player not initialized');
      return false;
    }

    if (connectionState === 'connected' || connectionState === 'connecting') {
      return true;
    }

    setConnectionState('connecting');
    setError(null);

    try {
      // Activate element for mobile browsers BEFORE connecting
      activateElement();

      const success = await playerRef.current.connect();
      
      if (success) {
        console.log('Successfully connected to Spotify Web Playback');
        setConnectionState('connected');
        return true;
      } else {
        setError('Failed to connect to Spotify');
        setConnectionState('ready');
        return false;
      }
    } catch (err) {
      console.error('Connect error:', err);
      setError(err.message);
      setConnectionState('ready');
      return false;
    }
  }, [connectionState, activateElement]);

  const disconnect = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.disconnect();
      setConnectionState('disconnected');
      setDeviceId(null);
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (connectionState === 'connected' && playerRef.current) {
      playerRef.current.togglePlay();
    }
  }, [connectionState]);

  const seek = useCallback((posMs) => {
    if (connectionState === 'connected' && playerRef.current) {
      playerRef.current.seek(posMs);
    }
  }, [connectionState]);

  const setVolume = useCallback((vol) => {
    if (connectionState === 'connected' && playerRef.current) {
      playerRef.current.setVolume(vol);
    }
  }, [connectionState]);

  const nextTrack = useCallback(() => {
    if (connectionState === 'connected' && playerRef.current) {
      playerRef.current.nextTrack();
    }
  }, [connectionState]);

  const previousTrack = useCallback(() => {
    if (connectionState === 'connected' && playerRef.current) {
      playerRef.current.previousTrack();
    }
  }, [connectionState]);

  return {
    player,
    deviceId,
    playerState,
    connectionState,
    error,
    connect,
    disconnect,
    togglePlay,
    seek,
    setVolume,
    nextTrack,
    previousTrack,
    activateElement,
    isReady: connectionState === 'ready' || connectionState === 'connected',
  };
}