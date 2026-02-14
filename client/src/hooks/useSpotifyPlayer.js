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

  console.log('[useSpotifyPlayer] Hook rendered:', {
    hasAccessToken: !!accessToken,
    tokenLength: accessToken?.length,
    tokenPreview: accessToken?.substring(0, 20) + '...',
    connectionState,
    deviceId,
    hasPlayer: !!player
  });

  // Initialize SDK
  useEffect(() => {
    console.log('[useSpotifyPlayer] Init effect running:', {
      hasAccessToken: !!accessToken,
      sdkLoaded: sdkLoadedRef.current,
      windowSpotify: !!window.Spotify
    });

    if (!accessToken || sdkLoadedRef.current) {
      console.log('[useSpotifyPlayer] Skipping init:', { 
        reason: !accessToken ? 'no token' : 'already loaded' 
      });
      return;
    }

    let mounted = true;

    // Define callback FIRST
    window.onSpotifyWebPlaybackSDKReady = () => {
      console.log('[SDK] onSpotifyWebPlaybackSDKReady called!', {
        mounted,
        hasAccessToken: !!accessToken,
        windowSpotify: !!window.Spotify
      });

      if (!mounted || !accessToken) {
        console.warn('[SDK] Callback aborted:', { mounted, hasAccessToken: !!accessToken });
        return;
      }
      
      try {
        console.log('[SDK] Creating Spotify.Player instance...');
        const p = new window.Spotify.Player({
          name: 'SpotiSync Party',
          getOAuthToken: (cb) => {
            console.log('[SDK] getOAuthToken called, providing token');
            cb(accessToken);
          },
          volume: 0.8,
        });

        console.log('[SDK] Player instance created:', p);

        // Ready event
        p.addListener('ready', ({ device_id }) => {
          console.log('[SDK Event] READY:', {
            device_id,
            mounted,
            timestamp: new Date().toISOString()
          });
          if (!mounted) return;
          setDeviceId(device_id);
          setConnectionState('ready');
        });

        // Not ready
        p.addListener('not_ready', ({ device_id }) => {
          console.log('[SDK Event] NOT_READY:', {
            device_id,
            mounted,
            timestamp: new Date().toISOString()
          });
          if (mounted) {
            setConnectionState('disconnected');
            setDeviceId(null);
          }
        });

        // Player state changed
        p.addListener('player_state_changed', (state) => {
          console.log('[SDK Event] PLAYER_STATE_CHANGED:', {
            state,
            mounted,
            paused: state?.paused,
            position: state?.position,
            duration: state?.duration,
            track: state?.track_window?.current_track?.name,
            timestamp: new Date().toISOString()
          });
          if (mounted && state) {
            setPlayerState(state);
          }
        });

        // Autoplay failed
        p.addListener('autoplay_failed', () => {
          console.warn('[SDK Event] AUTOPLAY_FAILED - user interaction required');
          if (mounted) {
            setError('Autoplay blocked. Please click Connect Web Player.');
          }
        });

        // Error handlers
        p.addListener('initialization_error', ({ message }) => {
          console.error('[SDK Event] INITIALIZATION_ERROR:', message);
          if (mounted) {
            setError(message);
            setConnectionState('disconnected');
          }
        });

        p.addListener('authentication_error', ({ message }) => {
          console.error('[SDK Event] AUTHENTICATION_ERROR:', message);
          if (mounted) {
            setError('Auth failed - token may be expired or invalid');
            setConnectionState('disconnected');
          }
        });

        p.addListener('account_error', ({ message }) => {
          console.error('[SDK Event] ACCOUNT_ERROR:', message);
          if (mounted) {
            setError(message + ' - Spotify Premium required');
            setConnectionState('disconnected');
          }
        });

        p.addListener('playback_error', ({ message }) => {
          console.error('[SDK Event] PLAYBACK_ERROR:', message);
          if (mounted) {
            setError(message);
          }
        });

        playerRef.current = p;
        if (mounted) {
          setPlayer(p);
          console.log('[SDK] Player state updated, ready for connection');
        }
      } catch (err) {
        console.error('[SDK] Player creation FAILED:', err);
        if (mounted) {
          setError(err.message);
          setConnectionState('disconnected');
        }
      }
    };

    // Load SDK script
    if (!window.Spotify) {
      console.log('[SDK] Loading Spotify SDK script...');
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.onload = () => {
        console.log('[SDK] Script loaded successfully');
      };
      script.onerror = (err) => {
        console.error('[SDK] Script loading failed:', err);
      };
      document.body.appendChild(script);
      sdkLoadedRef.current = true;
    } else {
      console.log('[SDK] Spotify already exists, calling callback directly');
      window.onSpotifyWebPlaybackSDKReady();
    }

    return () => {
      console.log('[useSpotifyPlayer] Cleanup running');
      mounted = false;
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
    };
  }, [accessToken]);

  // Activate element for mobile
  const activateElement = useCallback(() => {
    console.log('[Player] activateElement called:', {
      hasPlayer: !!playerRef.current,
      alreadyActivated: activatedRef.current
    });

    if (playerRef.current && !activatedRef.current) {
      try {
        playerRef.current.activateElement();
        activatedRef.current = true;
        console.log('[Player] Element activated successfully');
      } catch (err) {
        console.error('[Player] activateElement failed:', err);
      }
    }
  }, []);

  // Connect method
  const connect = useCallback(async () => {
    console.log('[Player] connect() called:', {
      hasPlayer: !!playerRef.current,
      connectionState,
      timestamp: new Date().toISOString()
    });

    if (!playerRef.current) {
      console.error('[Player] connect() failed - player not initialized');
      setError('Player not initialized');
      return false;
    }

    if (connectionState === 'connected') {
      console.log('[Player] Already connected, returning true');
      return true;
    }

    if (connectionState === 'connecting') {
      console.log('[Player] Already connecting, returning true');
      return true;
    }

    setConnectionState('connecting');
    setError(null);
    console.log('[Player] State set to connecting...');

    try {
      // Activate for mobile
      activateElement();

      console.log('[Player] Calling player.connect()...');
      const success = await playerRef.current.connect();
      
      console.log('[Player] connect() result:', {
        success,
        timestamp: new Date().toISOString()
      });

      if (success) {
        setConnectionState('connected');
        console.log('[Player] Connection successful!');
        return true;
      } else {
        setError('Failed to connect to Spotify');
        setConnectionState('ready');
        console.error('[Player] Connection failed - connect() returned false');
        return false;
      }
    } catch (err) {
      console.error('[Player] connect() exception:', err);
      setError(err.message);
      setConnectionState('ready');
      return false;
    }
  }, [connectionState, activateElement]);

  const disconnect = useCallback(() => {
    console.log('[Player] disconnect() called');
    if (playerRef.current) {
      playerRef.current.disconnect();
      setConnectionState('disconnected');
      setDeviceId(null);
    }
  }, []);

  const togglePlay = useCallback(() => {
    console.log('[Player] togglePlay() called:', {
      connectionState,
      hasPlayer: !!playerRef.current
    });

    if (connectionState === 'connected' && playerRef.current) {
      playerRef.current.togglePlay();
    } else {
      console.warn('[Player] togglePlay() ignored - not connected');
    }
  }, [connectionState]);

  const seek = useCallback((posMs) => {
    console.log('[Player] seek() called:', { posMs, connectionState });
    if (connectionState === 'connected' && playerRef.current) {
      playerRef.current.seek(posMs);
    }
  }, [connectionState]);

  const setVolume = useCallback((vol) => {
    console.log('[Player] setVolume() called:', { vol, connectionState });
    if (connectionState === 'connected' && playerRef.current) {
      playerRef.current.setVolume(vol);
    }
  }, [connectionState]);

  const nextTrack = useCallback(() => {
    console.log('[Player] nextTrack() called:', { connectionState });
    if (connectionState === 'connected' && playerRef.current) {
      playerRef.current.nextTrack();
    }
  }, [connectionState]);

  const previousTrack = useCallback(() => {
    console.log('[Player] previousTrack() called:', { connectionState });
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
