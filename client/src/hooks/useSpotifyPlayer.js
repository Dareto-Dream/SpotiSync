import { useState, useEffect, useRef, useCallback } from 'react';

export function useSpotifyPlayer(accessToken) {
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [connectionState, setConnectionState] = useState('disconnected'); // 'disconnected' | 'connecting' | 'ready' | 'connected'
  const [error, setError] = useState(null);
  
  const playerRef = useRef(null);
  const sdkReadyRef = useRef(false);

  // Initialize SDK and create player (but don't connect yet)
  useEffect(() => {
    if (!accessToken) return;

    let mounted = true;

    const initPlayer = () => {
      if (!mounted) return;

      try {
        const p = new window.Spotify.Player({
          name: 'SpotiSync Party',
          getOAuthToken: (cb) => {
            // Always provide fresh token - this addresses Issue #4
            cb(accessToken);
          },
          volume: 0.8,
        });

        p.addListener('ready', ({ device_id }) => {
          if (!mounted) return;
          console.log('Spotify Player ready, device:', device_id);
          setDeviceId(device_id);
          setConnectionState('ready');
        });

        p.addListener('not_ready', ({ device_id }) => {
          console.log('Device went offline:', device_id);
          if (mounted) {
            setConnectionState('disconnected');
            setDeviceId(null);
          }
        });

        p.addListener('player_state_changed', (state) => {
          if (mounted && state) {
            setPlayerState(state);
          }
        });

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

        playerRef.current = p;
        if (mounted) {
          setPlayer(p);
          sdkReadyRef.current = true;
        }
      } catch (err) {
        console.error('Player creation error:', err);
        if (mounted) {
          setError(err.message);
          setConnectionState('disconnected');
        }
      }
    };

    // Define the callback BEFORE the SDK script loads (fixes Issue #1)
    if (!window.onSpotifyWebPlaybackSDKReady) {
      window.onSpotifyWebPlaybackSDKReady = () => {
        console.log('Spotify Web Playback SDK ready');
        initPlayer();
      };
    }

    // Check if SDK is already loaded
    if (window.Spotify) {
      initPlayer();
    }

    return () => {
      mounted = false;
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
    };
  }, [accessToken]);

  // Explicit connect method - must be called from a user gesture (fixes Issue #2)
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
      // Connect the player - this creates AudioContext
      const success = await playerRef.current.connect();
      
      if (success) {
        console.log('Successfully connected to Spotify Web Playback');
        setConnectionState('connected');
        
        // Resume AudioContext if suspended (browser autoplay policy)
        if (playerRef.current._options?.getAudioContext) {
          const audioContext = playerRef.current._options.getAudioContext();
          if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
            console.log('AudioContext resumed');
          }
        }
        
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
  }, [connectionState]);

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
    // For backward compatibility
    isReady: connectionState === 'ready' || connectionState === 'connected',
  };
}
