import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import NowPlaying from '../components/NowPlaying';
import Queue from '../components/Queue';
import Search from '../components/Search';
import Participants from '../components/Participants';
import HostControls from '../components/HostControls';
import {
  Radio, Search as SearchIcon, ListMusic, Users,
  AlertCircle, Loader2, Copy, Check
} from 'lucide-react';

const TABS = [
  { id: 'search', label: 'Search', icon: SearchIcon },
  { id: 'queue', label: 'Queue', icon: ListMusic },
  { id: 'people', label: 'People', icon: Users },
];

export default function RoomPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { socket, connected, connect: connectSocket } = useSocket();

  console.log('[RoomPage] Rendered:', {
    sessionId,
    socketConnected: connected,
    hasSocket: !!socket,
    timestamp: new Date().toISOString()
  });

  const [activeTab, setActiveTab] = useState('search');
  const [queue, setQueue] = useState([]);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);

  // Determine role
  const hostData = JSON.parse(sessionStorage.getItem('spotisync_host') || 'null');
  const guestData = JSON.parse(sessionStorage.getItem('spotisync_guest') || 'null');
  const isHost = hostData?.sessionId === sessionId;
  const accessToken = isHost ? hostData?.accessToken : null;
  const userName = isHost ? 'Host' : (guestData?.name || 'Guest');

  console.log('[RoomPage] Role determined:', {
    isHost,
    userName,
    hasAccessToken: !!accessToken,
    tokenPreview: accessToken?.substring(0, 20) + '...',
    hostDataSession: hostData?.sessionId,
    currentSessionId: sessionId
  });

  // Spotify Web Playback SDK (host only)
  const {
    deviceId,
    playerState,
    connectionState,
    error: playerError,
    connect: connectPlayer,
    togglePlay,
  } = useSpotifyPlayer(isHost ? accessToken : null);

  const deviceTransferredRef = useRef(false);

  console.log('[RoomPage] Player state:', {
    deviceId,
    connectionState,
    playerError,
    deviceTransferred: deviceTransferredRef.current,
    hasPlayerState: !!playerState
  });

  // Connect socket
  useEffect(() => {
    console.log('[RoomPage] Socket connection effect:', { connected });
    if (!connected) {
      console.log('[RoomPage] Connecting socket...');
      connectSocket();
    }
  }, [connected, connectSocket]);

  // Join session
  useEffect(() => {
    console.log('[RoomPage] Session join effect:', {
      hasSocket: !!socket,
      connected,
      sessionId
    });

    if (!socket || !connected) {
      console.log('[RoomPage] Waiting for socket connection...');
      return;
    }

    console.log('[RoomPage] Emitting session:join:', {
      sessionId,
      userName,
      isHost,
      timestamp: new Date().toISOString()
    });

    socket.emit('session:join', { sessionId, name: userName, isHost });

    socket.on('session:state', (state) => {
      console.log('[Socket] session:state received:', state);
      setQueue(state.queue || []);
      setNowPlaying(state.nowPlaying);
      setParticipants(state.participants || []);
    });

    socket.on('queue:updated', ({ queue: q }) => {
      console.log('[Socket] queue:updated:', q);
      setQueue(q);
    });

    socket.on('session:participants', ({ participants: p }) => {
      console.log('[Socket] session:participants:', p);
      setParticipants(p);
    });

    socket.on('playback:state', ({ isPlaying: ip, nowPlaying: np }) => {
      console.log('[Socket] playback:state:', { isPlaying: ip, nowPlaying: np });
      setIsPlaying(ip);
      if (np) setNowPlaying(np);
    });

    socket.on('session:ended', ({ reason }) => {
      console.log('[Socket] session:ended:', reason);
      alert(reason || 'Session ended');
      navigate('/', { replace: true });
    });

    socket.on('error', ({ message }) => {
      console.error('[Socket] error:', message);
      setError(message);
      setTimeout(() => setError(null), 5000);
    });

    socket.on('playback:deviceTransferred', () => {
      console.log('[Socket] playback:deviceTransferred confirmed');
    });

    return () => {
      console.log('[RoomPage] Cleaning up socket listeners');
      socket.off('session:state');
      socket.off('queue:updated');
      socket.off('session:participants');
      socket.off('playback:state');
      socket.off('session:ended');
      socket.off('error');
      socket.off('playback:deviceTransferred');
    };
  }, [socket, connected, sessionId, userName, isHost, navigate]);

  // Fetch join code
  useEffect(() => {
    console.log('[RoomPage] Fetching join code for session:', sessionId);
    fetch(`/api/sessions/${sessionId}`)
      .then(r => {
        console.log('[RoomPage] Session fetch response status:', r.status);
        return r.json();
      })
      .then(d => {
        console.log('[RoomPage] Session data:', d);
        setJoinCode(d.joinCode || '');
      })
      .catch(err => {
        console.error('[RoomPage] Failed to fetch session:', err);
      });
  }, [sessionId]);

  // Update now playing from player state
  useEffect(() => {
    if (playerState?.track_window?.current_track) {
      const ct = playerState.track_window.current_track;
      console.log('[RoomPage] Updating now playing from player state:', {
        name: ct.name,
        uri: ct.uri,
        paused: playerState.paused
      });
      setNowPlaying({
        uri: ct.uri,
        name: ct.name,
        artists: ct.artists?.map(a => ({ name: a.name })),
        album: { name: ct.album?.name, images: ct.album?.images },
        duration_ms: ct.duration_ms,
      });
      setIsPlaying(!playerState.paused);
    }
  }, [playerState]);

  // Transfer playback to Web SDK device
  useEffect(() => {
    console.log('[RoomPage] Device transfer effect:', {
      isHost,
      deviceId,
      connectionState,
      deviceTransferred: deviceTransferredRef.current,
      hasSocket: !!socket
    });

    if (
      isHost &&
      deviceId &&
      connectionState === 'connected' &&
      !deviceTransferredRef.current &&
      socket
    ) {
      console.log('[RoomPage] 🎯 TRANSFERRING PLAYBACK:', {
        sessionId,
        deviceId,
        timestamp: new Date().toISOString()
      });

      socket.emit('playback:transferDevice', { sessionId, deviceId });
      deviceTransferredRef.current = true;
      
      console.log('[RoomPage] Device transfer emit completed');
    }
  }, [isHost, deviceId, connectionState, sessionId, socket]);

  // Handle connect button click
  const handleConnect = useCallback(async () => {
    console.log('[RoomPage] handleConnect called');
    const success = await connectPlayer();
    console.log('[RoomPage] connectPlayer result:', success);
    
    if (!success) {
      setError('Failed to connect Web Player. Please try again.');
      console.error('[RoomPage] Connection failed');
    } else {
      console.log('[RoomPage] Connection successful!');
    }
  }, [connectPlayer]);

  const handleAddToQueue = useCallback(async (track) => {
    console.log('[RoomPage] handleAddToQueue:', track);
    if (!socket) {
      console.error('[RoomPage] Cannot add to queue - no socket');
      return;
    }

    socket.emit('queue:add', { sessionId, track });
    console.log('[RoomPage] Emitted queue:add');
  }, [socket, sessionId]);

  const handleRemoveFromQueue = useCallback((queueId) => {
    console.log('[RoomPage] handleRemoveFromQueue:', queueId);
    if (!socket) return;
    socket.emit('queue:remove', { sessionId, queueId });
  }, [socket, sessionId]);

  const handlePlayTrack = useCallback(async (uri) => {
    console.log('[RoomPage] handlePlayTrack:', uri);
    if (!socket) return;
    socket.emit('playback:play', { sessionId, uri });
  }, [socket, sessionId]);

  const handleNextTrack = useCallback(() => {
    console.log('[RoomPage] handleNextTrack called');
    if (!socket) return;
    socket.emit('playback:next', { sessionId });
  }, [socket, sessionId]);

  const copyJoinCode = useCallback(() => {
    console.log('[RoomPage] Copying join code:', joinCode);
    navigator.clipboard.writeText(joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [joinCode]);

  if (!connected) {
    console.log('[RoomPage] Rendering loading state');
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-spotify-green" />
          <p className="text-white/60">Connecting to session...</p>
        </div>
      </div>
    );
  }

  console.log('[RoomPage] Rendering main UI');

  return (
    <div className="min-h-screen bg-[#0a0a0a] pb-20">
      <div className="px-4 pt-6 pb-4 border-b border-white/[0.08]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-spotify-green to-accent-lime flex items-center justify-center">
              <Radio className="w-5 h-5 text-black" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">SpotiSync</h1>
              <p className="text-xs text-white/40">{isHost ? 'Host' : 'Guest'} Mode</p>
            </div>
          </div>
          {joinCode && (
            <button
              onClick={copyJoinCode}
              className="px-4 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] flex items-center gap-2 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-spotify-green" /> : <Copy className="w-4 h-4" />}
              <span className="font-mono font-semibold text-sm">{joinCode}</span>
            </button>
          )}
        </div>

        {(error || playerError) && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-400">{error || playerError}</p>
          </div>
        )}
      </div>

      {nowPlaying && (
        <div className="px-4 py-4 border-b border-white/[0.08]">
          <NowPlaying track={nowPlaying} isPlaying={isPlaying} />
        </div>
      )}

      {isHost && (
        <div className="px-4 py-4 border-b border-white/[0.08]">
          <HostControls
            isPlaying={isPlaying}
            connectionState={connectionState}
            deviceId={deviceId}
            onConnect={handleConnect}
            onToggle={togglePlay}
            onNext={handleNextTrack}
            playerState={playerState}
            error={playerError}
          />
        </div>
      )}

      <div className="px-4 pt-4">
        <div className="flex gap-2 mb-4">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all ${
                  isActive
                    ? 'bg-white/[0.08] text-white'
                    : 'bg-white/[0.02] text-white/40 hover:bg-white/[0.04]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div>
          {activeTab === 'search' && <Search onAddTrack={handleAddToQueue} />}
          {activeTab === 'queue' && (
            <Queue
              queue={queue}
              onRemove={isHost ? handleRemoveFromQueue : undefined}
              onPlay={isHost ? handlePlayTrack : undefined}
            />
          )}
          {activeTab === 'people' && <Participants participants={participants} />}
        </div>
      </div>
    </div>
  );
}
