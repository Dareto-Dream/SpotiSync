import { useEffect, useState, useRef, useCallback } from 'react';
import ws from '../api/websocket';

export const PlayerState = {
  DISCONNECTED: 'disconnected',
  INITIALIZING: 'initializing',
  READY: 'ready',
  CONNECTED: 'connected',
  ERROR: 'error'
};

export function useSpotifyPlayer(userId, isHost, roomCode) {
  const [playerState, setPlayerState] = useState(PlayerState.DISCONNECTED);
  const [deviceId, setDeviceId] = useState(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState(null);

  const playerRef = useRef(null);
  const sdkReadyRef = useRef(false);
  const initializingRef = useRef(false);

  // Load Spotify SDK script
  useEffect(() => {
    if (!userId || !isHost) {
      return;
    }

    // Check if SDK is already loaded
    if (window.Spotify) {
      sdkReadyRef.current = true;
      return;
    }

    // Define the ready callback BEFORE loading the script
    window.onSpotifyWebPlaybackSDKReady = () => {
      console.log('Spotify Web Playback SDK Ready');
      sdkReadyRef.current = true;
      setPlayerState(PlayerState.READY);
    };

    // Load the SDK script
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    
    script.onerror = () => {
      console.error('Failed to load Spotify SDK');
      setError('Failed to load Spotify SDK');
      setPlayerState(PlayerState.ERROR);
    };

    document.body.appendChild(script);

    return () => {
      // Cleanup on unmount
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
    };
  }, [userId, isHost]);

  // Initialize player (without connecting)
  const initializePlayer = useCallback(async () => {
    if (!sdkReadyRef.current || !window.Spotify || initializingRef.current || playerRef.current) {
      return;
    }

    initializingRef.current = true;
    setPlayerState(PlayerState.INITIALIZING);

    try {
      // Request token from backend via WebSocket
      ws.requestToken();

      // Wait for token response
      const token = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Token request timeout'));
        }, 10000);

        const handler = (data) => {
          clearTimeout(timeout);
          ws.off('token_response', handler);
          resolve(data.accessToken);
        };

        ws.on('token_response', handler);
      });

      // Create player instance
      const player = new window.Spotify.Player({
        name: `Spotify Jam - ${roomCode}`,
        getOAuthToken: async (cb) => {
          // Always fetch fresh token from backend
          try {
            ws.requestToken();
            const freshToken = await new Promise((resolve) => {
              const handler = (data) => {
                ws.off('token_response', handler);
                resolve(data.accessToken);
              };
              ws.on('token_response', handler);
            });
            cb(freshToken);
          } catch (error) {
            console.error('Failed to get fresh token:', error);
            cb(token); // Fallback to last known token
          }
        },
        volume: 0.5
      });

      // Error handling
      player.addListener('initialization_error', ({ message }) => {
        console.error('Initialization error:', message);
        setError(`Initialization error: ${message}`);
        setPlayerState(PlayerState.ERROR);
      });

      player.addListener('authentication_error', ({ message }) => {
        console.error('Authentication error:', message);
        setError(`Authentication error: ${message}`);
        setPlayerState(PlayerState.ERROR);
      });

      player.addListener('account_error', ({ message }) => {
        console.error('Account error:', message);
        setError(`Account error: ${message}. Please upgrade to Spotify Premium.`);
        setPlayerState(PlayerState.ERROR);
      });

      player.addListener('playback_error', ({ message }) => {
        console.error('Playback error:', message);
        setError(`Playback error: ${message}`);
      });

      // Ready event
      player.addListener('ready', ({ device_id }) => {
        console.log('Player ready with device ID:', device_id);
        setDeviceId(device_id);
        setPlayerState(PlayerState.READY);
        setError(null);
      });

      player.addListener('not_ready', ({ device_id }) => {
        console.log('Player not ready:', device_id);
        setPlayerState(PlayerState.READY);
      });

      // Playback state updates
      player.addListener('player_state_changed', (state) => {
        if (!state) {
          return;
        }

        const track = state.track_window.current_track;
        setCurrentTrack({
          uri: track.uri,
          name: track.name,
          artists: track.artists.map(a => a.name).join(', '),
          album: track.album.name,
          albumArt: track.album.images[0]?.url,
          durationMs: track.duration_ms
        });

        setIsPlaying(!state.paused);
        setPosition(state.position);

        // Sync state to other clients (host only)
        if (isHost) {
          ws.syncPlayback({
            trackUri: track.uri,
            positionMs: state.position,
            isPlaying: !state.paused,
            deviceId: deviceId
          });
        }
      });

      playerRef.current = player;
      initializingRef.current = false;
      
      console.log('Player initialized (not connected yet)');
    } catch (error) {
      console.error('Failed to initialize player:', error);
      setError(error.message);
      setPlayerState(PlayerState.ERROR);
      initializingRef.current = false;
    }
  }, [userId, isHost, roomCode, deviceId]);

  // Connect player - MUST be called from user gesture
  const connect = useCallback(async () => {
    if (!playerRef.current) {
      throw new Error('Player not initialized');
    }

    if (playerState === PlayerState.CONNECTED) {
      console.log('Already connected');
      return;
    }

    try {
      console.log('Connecting player...');
      const connected = await playerRef.current.connect();
      
      if (connected) {
        console.log('Player connected successfully');
        setPlayerState(PlayerState.CONNECTED);
        
        // Resume AudioContext if suspended (required for Safari)
        if (playerRef.current._options?.getAudioElement) {
          const audioElement = playerRef.current._options.getAudioElement();
          if (audioElement?.context?.state === 'suspended') {
            await audioElement.context.resume();
            console.log('Resumed AudioContext');
          }
        }
        
        return true;
      } else {
        throw new Error('Failed to connect player');
      }
    } catch (error) {
      console.error('Connection error:', error);
      setError(`Connection error: ${error.message}`);
      setPlayerState(PlayerState.ERROR);
      throw error;
    }
  }, [playerState]);

  // Transfer playback to this device
  const transferPlayback = useCallback(async () => {
    if (!deviceId) {
      throw new Error('No device ID available');
    }

    try {
      console.log('Transferring playback to device:', deviceId);
      ws.transferDevice(deviceId);
      return true;
    } catch (error) {
      console.error('Transfer error:', error);
      setError(`Transfer error: ${error.message}`);
      throw error;
    }
  }, [deviceId]);

  // Disconnect player
  const disconnect = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.disconnect();
      setPlayerState(PlayerState.DISCONNECTED);
      setDeviceId(null);
    }
  }, []);

  // Playback controls
  const play = useCallback(() => {
    if (!deviceId) return;
    ws.controlPlayback('play', deviceId);
  }, [deviceId]);

  const pause = useCallback(() => {
    if (!deviceId) return;
    ws.controlPlayback('pause', deviceId);
  }, [deviceId]);

  const skipToNext = useCallback(() => {
    if (!deviceId) return;
    ws.controlPlayback('next', deviceId);
  }, [deviceId]);

  const skipToPrevious = useCallback(() => {
    if (!deviceId) return;
    ws.controlPlayback('previous', deviceId);
  }, [deviceId]);

  const seek = useCallback((positionMs) => {
    if (!deviceId) return;
    ws.controlPlayback('seek', deviceId, null, positionMs);
  }, [deviceId]);

  return {
    playerState,
    deviceId,
    currentTrack,
    isPlaying,
    position,
    error,
    initializePlayer,
    connect,
    disconnect,
    transferPlayback,
    play,
    pause,
    skipToNext,
    skipToPrevious,
    seek
  };
}
