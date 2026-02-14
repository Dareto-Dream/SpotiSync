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

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ---------- DEVICE POLLING ----------
  const waitForSpotifyDevice = useCallback(async () => {
    console.log('[Spotify] Waiting for device registration...');

    for (let i = 0; i < 15; i++) {
      await sleep(1000);

      const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!res.ok) continue;

      const data = await res.json();

      const found = data.devices?.find(
        d => d.name === 'SpotiSync Party'
      );

      if (found) {
        console.log('[Spotify] Device discovered:', found);
        return found.id;
      }
    }

    console.warn('[Spotify] Device never appeared in device list');
    return null;
  }, [accessToken]);

  // ---------- TRANSFER PLAYBACK ----------
  const transferPlayback = useCallback(async (id) => {
    console.log('[Spotify] Transferring playback to device:', id);

    await fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        device_ids: [id],
        play: false
      })
    });
  }, [accessToken]);

  // ---------- INIT SDK ----------
  useEffect(() => {
    if (!accessToken || sdkLoadedRef.current) return;

    let mounted = true;

    window.onSpotifyWebPlaybackSDKReady = () => {
      if (!mounted || !accessToken) return;

      console.log('[SDK] Creating Spotify.Player');

      const p = new window.Spotify.Player({
        name: 'SpotiSync Party',
        getOAuthToken: (cb) => cb(accessToken),
        volume: 0.8,
      });

      // READY
      p.addListener('ready', ({ device_id }) => {
        console.log('[SDK] READY event received:', device_id);
        if (!mounted) return;
        setDeviceId(device_id);
        setConnectionState('ready');
      });

      // NOT READY
      p.addListener('not_ready', ({ device_id }) => {
        console.log('[SDK] NOT_READY:', device_id);
        if (!mounted) return;
        setDeviceId(null);
        setConnectionState('disconnected');
      });

      // STATE CHANGES
      p.addListener('player_state_changed', (state) => {
        if (mounted && state) {
          setPlayerState(state);
        }
      });

      // ERRORS
      p.addListener('initialization_error', ({ message }) => {
        console.error('[SDK] initialization_error:', message);
        setError(message);
      });

      p.addListener('authentication_error', ({ message }) => {
        console.error('[SDK] authentication_error:', message);
        setError('Spotify authentication failed');
      });

      p.addListener('account_error', ({ message }) => {
        console.error('[SDK] account_error:', message);
        setError('Spotify Premium required');
      });

      p.addListener('playback_error', ({ message }) => {
        console.error('[SDK] playback_error:', message);
        setError(message);
      });

      playerRef.current = p;
      setPlayer(p);
    };

    // load sdk
    if (!window.Spotify) {
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      document.body.appendChild(script);
      sdkLoadedRef.current = true;
    } else {
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

  // ---------- ACTIVATE ----------
  const activateElement = useCallback(() => {
    if (playerRef.current && !activatedRef.current) {
      try {
        playerRef.current.activateElement();
        activatedRef.current = true;
      } catch (e) {
        console.warn('activateElement failed', e);
      }
    }
  }, []);

  // ---------- CONNECT ----------
  const connect = useCallback(async () => {
    if (!playerRef.current) {
      setError('Player not initialized');
      return false;
    }

    setConnectionState('connecting');
    setError(null);

    activateElement();

    const success = await playerRef.current.connect();

    if (!success) {
      setConnectionState('disconnected');
      setError('Spotify connect() failed');
      return false;
    }

    console.log('[Spotify] SDK connected. Waiting for device...');

    // IMPORTANT PART — THIS FIXES YOUR ISSUE
    const id = await waitForSpotifyDevice();

    if (!id) {
      setConnectionState('disconnected');
      setError('Spotify device never registered');
      return false;
    }

    await transferPlayback(id);

    setDeviceId(id);
    setConnectionState('connected');

    console.log('[Spotify] Web player fully activated');

    return true;
  }, [activateElement, waitForSpotifyDevice, transferPlayback]);

  // ---------- CONTROLS ----------
  const togglePlay = useCallback(() => {
    if (connectionState === 'connected' && playerRef.current) {
      playerRef.current.togglePlay();
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

  const disconnect = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.disconnect();
      setDeviceId(null);
      setConnectionState('disconnected');
    }
  }, []);

  return {
    player,
    deviceId,
    playerState,
    connectionState,
    error,
    connect,
    disconnect,
    togglePlay,
    nextTrack,
    previousTrack,
    seek,
    setVolume,
    activateElement,
    isReady: connectionState === 'ready' || connectionState === 'connected',
  };
}
