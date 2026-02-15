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
  const deviceIdRef = useRef(null);

  /* -------------------- LOAD SPOTIFY SDK -------------------- */

  useEffect(() => {
    if (!userId || !isHost) return;

    if (window.Spotify) {
      sdkReadyRef.current = true;
      return;
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
      console.log('Spotify Web Playback SDK Ready');
      sdkReadyRef.current = true;
      setPlayerState(PlayerState.READY);
    };

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
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
    };
  }, [userId, isHost]);

  /* -------------------- INITIALIZE PLAYER -------------------- */

  const initializePlayer = useCallback(() => {
    if (!sdkReadyRef.current || !window.Spotify || initializingRef.current || playerRef.current) {
      return;
    }

    initializingRef.current = true;
    setPlayerState(PlayerState.INITIALIZING);

    try {
      const player = new window.Spotify.Player({
        name: `Spotify Jam - ${roomCode}`,

        // *** THE IMPORTANT FIX ***
        // Spotify asks for a token → we request via websocket → respond immediately
        getOAuthToken: (cb) => {
          const handler = (data) => {
            ws.off('token_response', handler);
            console.log('Received Spotify token');
            cb(data.accessToken);
          };

          ws.on('token_response', handler);
          ws.requestToken();
        },

        volume: 0.5
      });

      /* ---------- ERROR HANDLING ---------- */

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
        setError(`Account error: ${message}. Spotify Premium required.`);
        setPlayerState(PlayerState.ERROR);
      });

      player.addListener('playback_error', ({ message }) => {
        console.error('Playback error:', message);
        setError(`Playback error: ${message}`);
      });

      /* ---------- READY ---------- */

      player.addListener('ready', ({ device_id }) => {
        console.log('Player ready with device ID:', device_id);
        deviceIdRef.current = device_id;
        setDeviceId(device_id);
        setPlayerState(PlayerState.READY);
        setError(null);
      });

      player.addListener('not_ready', ({ device_id }) => {
        console.log('Player not ready:', device_id);
      });

      /* ---------- STATE SYNC ---------- */

      player.addListener('player_state_changed', (state) => {
        if (!state) return;

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

        // Host sync — uses ref to avoid stale deviceId
        if (isHost && deviceIdRef.current) {
          ws.syncPlayback({
            trackUri: track.uri,
            positionMs: state.position,
            isPlaying: !state.paused,
            deviceId: deviceIdRef.current
          });
        }
      });

      playerRef.current = player;
      initializingRef.current = false;

      console.log('Player initialized (awaiting connect)');
    } catch (err) {
      console.error('Failed to initialize player:', err);
      setError(err.message);
      setPlayerState(PlayerState.ERROR);
      initializingRef.current = false;
    }
  }, [roomCode, isHost]);

  /* -------------------- CONNECT (USER GESTURE REQUIRED) -------------------- */

  const connect = useCallback(async () => {
    if (!playerRef.current) {
      throw new Error('Player not initialized');
    }

    if (playerState === PlayerState.CONNECTED) return;

    try {
      console.log('Connecting player...');
      const connected = await playerRef.current.connect();

      if (!connected) throw new Error('Spotify refused connection');

      setPlayerState(PlayerState.CONNECTED);
      console.log('Player connected successfully');
      return true;
    } catch (err) {
      console.error('Connection error:', err);
      setError(`Connection error: ${err.message}`);
      setPlayerState(PlayerState.ERROR);
      throw err;
    }
  }, [playerState]);

  /* -------------------- PLAYBACK CONTROL -------------------- */

  const transferPlayback = useCallback(() => {
    if (!deviceIdRef.current) throw new Error('No device ID available');
    ws.transferDevice(deviceIdRef.current);
  }, []);

  const play = useCallback(() => {
    if (!deviceIdRef.current) return;
    ws.controlPlayback('play', deviceIdRef.current);
  }, []);

  const pause = useCallback(() => {
    if (!deviceIdRef.current) return;
    ws.controlPlayback('pause', deviceIdRef.current);
  }, []);

  const skipToNext = useCallback(() => {
    if (!deviceIdRef.current) return;
    ws.controlPlayback('next', deviceIdRef.current);
  }, []);

  const skipToPrevious = useCallback(() => {
    if (!deviceIdRef.current) return;
    ws.controlPlayback('previous', deviceIdRef.current);
  }, []);

  const seek = useCallback((positionMs) => {
    if (!deviceIdRef.current) return;
    ws.controlPlayback('seek', deviceIdRef.current, null, positionMs);
  }, []);

  const disconnect = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.disconnect();
      setPlayerState(PlayerState.DISCONNECTED);
      setDeviceId(null);
      deviceIdRef.current = null;
    }
  }, []);

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
