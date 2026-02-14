import { useState, useEffect, useRef, useCallback } from 'react';

export function useSpotifyPlayer(accessToken) {
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [playerState, setPlayerState] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const playerRef = useRef(null);

  useEffect(() => {
    if (!accessToken) return;

    let mounted = true;

    // Wait for Spotify SDK to load
    const initPlayer = () => {
      if (!window.Spotify) {
        window.onSpotifyWebPlaybackSDKReady = initPlayer;
        return;
      }

      const p = new window.Spotify.Player({
        name: 'SpotiSync Party',
        getOAuthToken: (cb) => cb(accessToken),
        volume: 0.8,
      });

      p.addListener('ready', ({ device_id }) => {
        if (!mounted) return;
        console.log('Spotify Player ready, device:', device_id);
        setDeviceId(device_id);
        setIsReady(true);
      });

      p.addListener('not_ready', ({ device_id }) => {
        console.log('Device went offline:', device_id);
        if (mounted) setIsReady(false);
      });

      p.addListener('player_state_changed', (state) => {
        if (mounted) setPlayerState(state);
      });

      p.addListener('initialization_error', ({ message }) => {
        console.error('Init error:', message);
      });

      p.addListener('authentication_error', ({ message }) => {
        console.error('Auth error:', message);
      });

      p.addListener('account_error', ({ message }) => {
        console.error('Account error:', message);
      });

      p.connect();
      playerRef.current = p;
      if (mounted) setPlayer(p);
    };

    if (window.Spotify) {
      initPlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = initPlayer;
    }

    return () => {
      mounted = false;
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
    };
  }, [accessToken]);

  const togglePlay = useCallback(() => {
    playerRef.current?.togglePlay();
  }, []);

  const seek = useCallback((posMs) => {
    playerRef.current?.seek(posMs);
  }, []);

  const setVolume = useCallback((vol) => {
    playerRef.current?.setVolume(vol);
  }, []);

  return { player, deviceId, playerState, isReady, togglePlay, seek, setVolume };
}
