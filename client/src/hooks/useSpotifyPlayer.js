import { useEffect, useState, useRef } from 'react';

// CRITICAL: Define the SDK ready callback BEFORE loading the script
if (!window.onSpotifyWebPlaybackSDKReady) {
  window.spotifySDKReady = new Promise((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = () => {
      console.log('Spotify SDK loaded');
      resolve();
    };
  });
}

// Load SDK script only once
let sdkScriptLoaded = false;

const loadSpotifySDK = () => {
  if (sdkScriptLoaded) return;
  sdkScriptLoaded = true;
  
  const script = document.createElement('script');
  script.src = 'https://sdk.scdn.co/spotify-player.js';
  script.async = true;
  document.body.appendChild(script);
};

const useSpotifyPlayer = (getAccessToken) => {
  const [player, setPlayer] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [playerState, setPlayerState] = useState('disconnected'); // disconnected, ready, connected
  const [isPaused, setIsPaused] = useState(true);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [error, setError] = useState(null);
  
  const playerRef = useRef(null);
  const getAccessTokenRef = useRef(getAccessToken);
  
  useEffect(() => {
    getAccessTokenRef.current = getAccessToken;
  }, [getAccessToken]);

  useEffect(() => {
    let mounted = true;
    
    const initializePlayer = async () => {
      try {
        // Load SDK script
        loadSpotifySDK();
        
        // Wait for SDK to be ready
        await window.spotifySDKReady;
        
        if (!mounted) return;
        
        // Create player instance
        const playerInstance = new window.Spotify.Player({
          name: 'Spotify Rooms Web Player',
          getOAuthToken: async (cb) => {
            try {
              const token = await getAccessTokenRef.current();
              cb(token);
            } catch (err) {
              console.error('Failed to get access token:', err);
              setError('Failed to get access token');
            }
          },
          volume: 0.8
        });

        if (!mounted) return;
        
        // Error handling
        playerInstance.addListener('initialization_error', ({ message }) => {
          console.error('Initialization error:', message);
          setError('Player initialization failed');
        });

        playerInstance.addListener('authentication_error', ({ message }) => {
          console.error('Authentication error:', message);
          setError('Authentication failed. Please log in again.');
        });

        playerInstance.addListener('account_error', ({ message }) => {
          console.error('Account error:', message);
          setError('Premium account required');
        });

        playerInstance.addListener('playback_error', ({ message }) => {
          console.error('Playback error:', message);
          setError('Playback error: ' + message);
        });

        // Ready event - device is ready but NOT connected
        playerInstance.addListener('ready', ({ device_id }) => {
          console.log('Player ready with device ID:', device_id);
          if (mounted) {
            setDeviceId(device_id);
            setPlayerState('ready');
            setError(null);
          }
        });

        // Not ready event
        playerInstance.addListener('not_ready', ({ device_id }) => {
          console.log('Player not ready:', device_id);
          if (mounted) {
            setPlayerState('disconnected');
          }
        });

        // Player state changes
        playerInstance.addListener('player_state_changed', (state) => {
          if (!state || !mounted) return;
          
          setIsPaused(state.paused);
          
          if (state.track_window?.current_track) {
            setCurrentTrack({
              name: state.track_window.current_track.name,
              artists: state.track_window.current_track.artists.map(a => a.name).join(', '),
              album: state.track_window.current_track.album.name,
              uri: state.track_window.current_track.uri,
              position: state.position,
              duration: state.duration
            });
          }
        });

        playerRef.current = playerInstance;
        setPlayer(playerInstance);
        
      } catch (err) {
        console.error('Failed to initialize player:', err);
        if (mounted) {
          setError('Failed to initialize player');
        }
      }
    };

    initializePlayer();

    return () => {
      mounted = false;
      if (playerRef.current) {
        playerRef.current.disconnect();
        playerRef.current = null;
      }
    };
  }, []);

  // Connect method - must be called after user interaction
  const connect = async () => {
    if (!player) {
      setError('Player not initialized');
      return false;
    }
    
    if (playerState === 'connected') {
      console.log('Player already connected');
      return true;
    }
    
    try {
      const success = await player.connect();
      
      if (success) {
        console.log('Player connected successfully');
        setPlayerState('connected');
        
        // Resume audio context if needed
        if (player._options?.getAudioContext) {
          const audioContext = player._options.getAudioContext();
          if (audioContext?.state === 'suspended') {
            await audioContext.resume();
          }
        }
        
        return true;
      } else {
        setError('Failed to connect player');
        return false;
      }
    } catch (err) {
      console.error('Connection error:', err);
      setError('Connection failed');
      return false;
    }
  };

  // Disconnect method
  const disconnect = () => {
    if (player) {
      player.disconnect();
      setPlayerState('disconnected');
      setDeviceId(null);
    }
  };

  return {
    player,
    deviceId,
    playerState,
    isPaused,
    currentTrack,
    error,
    connect,
    disconnect
  };
};

export default useSpotifyPlayer;
