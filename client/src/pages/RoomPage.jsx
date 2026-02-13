import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../context/SocketContext';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer';
import NowPlaying from '../components/NowPlaying';
import Queue from '../components/Queue';
import Search from '../components/Search';
import Participants from '../components/Participants';
import HostControls from '../components/HostControls';
import {
  Radio, Search as SearchIcon, ListMusic, Users, Settings,
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
  const { socket, connected, connect } = useSocket();

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

  // Spotify Web Playback SDK (host only)
  const { deviceId, playerState, isReady, togglePlay } = useSpotifyPlayer(
    isHost ? accessToken : null
  );

  // Connect socket if not connected
  useEffect(() => {
    if (!connected) connect();
  }, [connected, connect]);

  // Join session via socket
  useEffect(() => {
    if (!socket || !connected) return;

    socket.emit('session:join', { sessionId, name: userName, isHost });

    socket.on('session:state', (state) => {
      setQueue(state.queue || []);
      setNowPlaying(state.nowPlaying);
      setParticipants(state.participants || []);
    });

    socket.on('queue:updated', ({ queue: q }) => setQueue(q));

    socket.on('session:participants', ({ participants: p }) => setParticipants(p));

    socket.on('playback:state', ({ isPlaying: ip, nowPlaying: np }) => {
      setIsPlaying(ip);
      if (np) setNowPlaying(np);
    });

    socket.on('session:ended', () => {
      navigate('/', { replace: true });
    });

    socket.on('error', ({ message }) => {
      setError(message);
      setTimeout(() => setError(null), 5000);
    });

    return () => {
      socket.off('session:state');
      socket.off('queue:updated');
      socket.off('session:participants');
      socket.off('playback:state');
      socket.off('session:ended');
      socket.off('error');
    };
  }, [socket, connected, sessionId, userName, isHost, navigate]);

  // Fetch join code
  useEffect(() => {
    fetch(`/api/sessions/${sessionId}`)
      .then(r => r.json())
      .then(d => setJoinCode(d.joinCode || ''))
      .catch(() => {});
  }, [sessionId]);

  // Update now playing from player state
  useEffect(() => {
    if (playerState?.track_window?.current_track) {
      const ct = playerState.track_window.current_track;
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

  const addToQueue = useCallback((track) => {
    socket?.emit('queue:add', { sessionId, track });
  }, [socket, sessionId]);

  const removeFromQueue = useCallback((queueId) => {
    socket?.emit('queue:remove', { sessionId, queueId });
  }, [socket, sessionId]);

  const playTrack = useCallback((uri) => {
    socket?.emit('playback:play', { sessionId, uri, deviceId });
  }, [socket, sessionId, deviceId]);

  const playNext = useCallback(() => {
    socket?.emit('playback:next', { sessionId, deviceId });
  }, [socket, sessionId, deviceId]);

  const pausePlayback = useCallback(() => {
    socket?.emit('playback:pause', { sessionId });
  }, [socket, sessionId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-spotify-green animate-spin" />
          <p className="text-white/40">Connecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Sidebar / Header */}
      <div className="lg:w-80 lg:min-h-screen lg:border-r border-white/[0.06] bg-black/30 shrink-0">
        <div className="p-6">
          {/* Logo + Code */}
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg bg-spotify-green/20 border border-spotify-green/30 flex items-center justify-center">
              <Radio className="w-4 h-4 text-spotify-green" />
            </div>
            <span className="font-['Outfit'] font-bold tracking-tight">SpotiSync</span>
            {isHost && (
              <span className="ml-auto px-2 py-0.5 rounded-md bg-spotify-green/10 text-spotify-green text-[10px] font-bold uppercase tracking-wider">
                Host
              </span>
            )}
          </div>

          {/* Join Code */}
          {joinCode && (
            <button
              onClick={handleCopy}
              className="w-full mb-6 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between group hover:bg-white/[0.05] transition-all"
            >
              <div className="text-left">
                <p className="text-[10px] uppercase tracking-[0.15em] text-white/25 font-medium">Room Code</p>
                <p className="font-['JetBrains_Mono'] font-bold tracking-[0.2em] text-white/80">{joinCode}</p>
              </div>
              {copied ? <Check className="w-4 h-4 text-spotify-green" /> : <Copy className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors" />}
            </button>
          )}

          {/* Now Playing */}
          <NowPlaying track={nowPlaying} isPlaying={isPlaying} />

          {/* Host Controls */}
          {isHost && (
            <HostControls
              isPlaying={isPlaying}
              isReady={isReady}
              deviceId={deviceId}
              sessionId={sessionId}
              onPlay={() => playTrack(nowPlaying?.uri)}
              onPause={pausePlayback}
              onNext={playNext}
              onToggle={togglePlay}
              playerState={playerState}
            />
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-h-screen lg:min-h-0">
        {/* Error Toast */}
        {error && (
          <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2 animate-slide-up">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-white/[0.06] px-4">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-4 text-sm font-medium transition-all relative
                ${activeTab === tab.id ? 'text-white' : 'text-white/30 hover:text-white/60'}`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.id === 'queue' && queue.length > 0 && (
                <span className="ml-1 w-5 h-5 rounded-full bg-spotify-green/20 text-spotify-green text-[10px] font-bold flex items-center justify-center">
                  {queue.length}
                </span>
              )}
              {tab.id === 'people' && participants.length > 0 && (
                <span className="ml-1 w-5 h-5 rounded-full bg-white/[0.08] text-white/50 text-[10px] font-bold flex items-center justify-center">
                  {participants.length}
                </span>
              )}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-spotify-green rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === 'search' && (
            <Search sessionId={sessionId} onAddToQueue={addToQueue} />
          )}
          {activeTab === 'queue' && (
            <Queue
              queue={queue}
              isHost={isHost}
              onRemove={removeFromQueue}
              onPlay={playTrack}
            />
          )}
          {activeTab === 'people' && (
            <Participants participants={participants} />
          )}
        </div>
      </div>
    </div>
  );
}
