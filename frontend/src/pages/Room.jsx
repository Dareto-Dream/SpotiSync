import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useSpotifyPlayer, PlayerState } from '../hooks/useSpotifyPlayer';
import ws from '../api/websocket';
import NowPlaying from '../components/NowPlaying';
import Queue from '../components/Queue';
import Search from '../components/Search';
import Members from '../components/Members';
import '../styles/Room.css';

export default function Room() {
  const { user, room, isHost, leaveRoom: leaveRoomContext } = useApp();
  const navigate = useNavigate();

  const [members, setMembers] = useState([]);
  const [queue, setQueue] = useState([]);
  const [syncedPlaybackState, setSyncedPlaybackState] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [showSearch, setShowSearch] = useState(false);
  
  const heartbeatInterval = useRef(null);
  const hasConnectedPlayer = useRef(false);

  // Spotify player hook (only for host)
  const player = useSpotifyPlayer(
    isHost ? user?.userId : null,
    isHost,
    room?.code
  );

  // Redirect if not in a room
  useEffect(() => {
    if (!user || !room) {
      navigate('/');
    }
  }, [user, room, navigate]);

  // Connect to WebSocket
  useEffect(() => {
    if (!user || !room) return;

    const connectWs = async () => {
      try {
        await ws.connect();
        ws.joinRoom(room.code, user.userId, user.displayName, isHost);
        setConnectionStatus('connected');
      } catch (error) {
        console.error('WebSocket connection failed:', error);
        setConnectionStatus('error');
      }
    };

    connectWs();

    // Set up WebSocket event handlers
    ws.on('room_joined', handleRoomJoined);
    ws.on('member_joined', handleMemberJoined);
    ws.on('member_left', handleMemberLeft);
    ws.on('queue_updated', handleQueueUpdated);
    ws.on('playback_state', handlePlaybackState);
    ws.on('playback_changed', handlePlaybackChanged);
    ws.on('room_closed', handleRoomClosed);
    ws.on('error', handleWsError);

    // Host heartbeat
    if (isHost) {
      heartbeatInterval.current = setInterval(() => {
        ws.sendHeartbeat();
      }, 5000);
    }

    return () => {
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
      }
      
      ws.leaveRoom();
      ws.off('room_joined', handleRoomJoined);
      ws.off('member_joined', handleMemberJoined);
      ws.off('member_left', handleMemberLeft);
      ws.off('queue_updated', handleQueueUpdated);
      ws.off('playback_state', handlePlaybackState);
      ws.off('playback_changed', handlePlaybackChanged);
      ws.off('room_closed', handleRoomClosed);
      ws.off('error', handleWsError);
    };
  }, [user, room, isHost]);

  // Initialize player when ready (host only)
  useEffect(() => {
    if (isHost && player.playerState === PlayerState.READY && !hasConnectedPlayer.current) {
      player.initializePlayer();
    }
  }, [isHost, player.playerState]);

  const handleRoomJoined = (data) => {
    console.log('Joined room:', data);
    setMembers(data.members || []);
    setQueue(data.queue || []);
    
    if (data.room?.current_track_uri) {
      setSyncedPlaybackState({
        trackUri: data.room.current_track_uri,
        positionMs: data.room.current_track_position_ms,
        isPlaying: data.room.is_playing
      });
    }
  };

  const handleMemberJoined = (data) => {
    console.log('Member joined:', data);
    setMembers(prev => [...prev, {
      user_id: data.userId,
      display_name: data.displayName,
      is_host: data.isHost
    }]);
  };

  const handleMemberLeft = (data) => {
    console.log('Member left:', data);
    setMembers(prev => prev.filter(m => m.user_id !== data.userId));
  };

  const handleQueueUpdated = (data) => {
    console.log('Queue updated:', data.queue.length, 'items');
    setQueue(data.queue);
  };

  const handlePlaybackState = (state) => {
    console.log('Playback state received:', state);
    setSyncedPlaybackState(state);
  };

  const handlePlaybackChanged = (data) => {
    console.log('Playback changed:', data.action);
  };

  const handleRoomClosed = (data) => {
    console.log('Room closed:', data.reason);
    alert(`Room closed: ${data.reason}`);
    handleLeaveRoom();
  };

  const handleWsError = (data) => {
    console.error('WebSocket error:', data);
  };

  const handleLeaveRoom = () => {
    if (player && isHost) {
      player.disconnect();
    }
    
    leaveRoomContext();
    navigate('/');
  };

  const handleAddToQueue = (track) => {
    ws.addToQueue(track);
  };

  const handleRemoveFromQueue = (queueItemId) => {
    if (!isHost) return;
    ws.removeFromQueue(queueItemId);
  };

  // Host connects player - REQUIRES USER GESTURE
  const handleConnectPlayer = async () => {
    if (!isHost || !player) return;

    try {
      await player.connect();
      hasConnectedPlayer.current = true;
      
      // Transfer playback to this device
      if (player.deviceId) {
        await player.transferPlayback();
      }
    } catch (error) {
      console.error('Failed to connect player:', error);
      alert('Failed to connect player: ' + error.message);
    }
  };

  if (!user || !room) {
    return null;
  }

  return (
    <div className="room-page">
      <div className="room-header">
        <div className="room-info">
          <h1>Room: {room.code}</h1>
          <span className={`status status-${connectionStatus}`}>
            {connectionStatus}
          </span>
        </div>
        
        <button onClick={handleLeaveRoom} className="btn btn-danger">
          Leave Room
        </button>
      </div>

      <div className="room-content">
        <div className="main-panel">
          {isHost && (
            <div className="player-section">
              <h2>Host Controls</h2>
              
              {player.error && (
                <div className="error-message">{player.error}</div>
              )}

              {player.playerState === PlayerState.DISCONNECTED && (
                <div className="player-status">
                  <p>Player not initialized</p>
                </div>
              )}

              {player.playerState === PlayerState.READY && (
                <div className="player-status">
                  <p>Player ready to connect</p>
                  <button
                    onClick={handleConnectPlayer}
                    className="btn btn-primary"
                  >
                    Connect Player
                  </button>
                </div>
              )}

              {player.playerState === PlayerState.INITIALIZING && (
                <div className="player-status">
                  <p>Initializing player...</p>
                </div>
              )}

              {player.playerState === PlayerState.CONNECTED && (
                <div className="player-controls">
                  <p className="device-info">
                    Connected • Device ID: {player.deviceId?.substring(0, 8)}...
                  </p>
                  
                  <div className="control-buttons">
                    <button onClick={player.skipToPrevious} className="btn-control">⏮</button>
                    <button
                      onClick={player.isPlaying ? player.pause : player.play}
                      className="btn-control btn-control-large"
                    >
                      {player.isPlaying ? '⏸' : '▶'}
                    </button>
                    <button onClick={player.skipToNext} className="btn-control">⏭</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <NowPlaying
            track={isHost ? player.currentTrack : syncedPlaybackState?.trackUri}
            isPlaying={isHost ? player.isPlaying : syncedPlaybackState?.isPlaying}
            position={isHost ? player.position : syncedPlaybackState?.positionMs}
          />

          <div className="queue-section">
            <div className="section-header">
              <h2>Queue ({queue.length})</h2>
              <button
                onClick={() => setShowSearch(!showSearch)}
                className="btn btn-secondary"
              >
                {showSearch ? 'Hide Search' : 'Add Music'}
              </button>
            </div>

            {showSearch && (
              <Search
                onAddToQueue={handleAddToQueue}
                userId={user.userId}
              />
            )}

            <Queue
              items={queue}
              onRemove={isHost ? handleRemoveFromQueue : null}
            />
          </div>
        </div>

        <div className="side-panel">
          <Members members={members} />
        </div>
      </div>
    </div>
  );
}
