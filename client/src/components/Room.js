import React, { useEffect, useState } from 'react';

function Room({ user, ws, player, roomState, onLeave }) {
  const [syncing, setSyncing] = useState(false);
  
  const isHost = roomState.hostId === user.userId;

  // Sync playback state for host
  useEffect(() => {
    if (!isHost || !player.player) return;

    const interval = setInterval(() => {
      player.player.getCurrentState().then(state => {
        if (!state) return;

        ws.updatePlaybackState({
          track_uri: state.track_window?.current_track?.uri,
          position_ms: state.position,
          is_playing: !state.paused
        });
      });
    }, 2000); // Sync every 2 seconds

    return () => clearInterval(interval);
  }, [isHost, player.player, ws]);

  // Apply playback updates for members
  useEffect(() => {
    if (isHost || !roomState.playbackState) return;

    const applyPlaybackState = async () => {
      if (!player.player) return;

      const { track_uri, position_ms, is_playing } = roomState.playbackState;
      
      if (!track_uri) return;

      setSyncing(true);

      try {
        const state = await player.player.getCurrentState();
        
        // Check if we need to change track
        if (!state || state.track_window?.current_track?.uri !== track_uri) {
          // Play the track
          await player.player.activateElement();
          // Note: Actual track loading requires Spotify Web API
          // This would need to be implemented via backend endpoint
        }

        // Sync position (if difference > 3 seconds)
        if (state && Math.abs(state.position - position_ms) > 3000) {
          await player.player.seek(position_ms);
        }

        // Sync play/pause state
        if (state && state.paused !== !is_playing) {
          if (is_playing) {
            await player.player.resume();
          } else {
            await player.player.pause();
          }
        }
      } catch (err) {
        console.error('Failed to sync playback:', err);
      } finally {
        setSyncing(false);
      }
    };

    applyPlaybackState();
  }, [roomState.playbackState, isHost, player.player]);

  const handleLeave = () => {
    if (window.confirm('Are you sure you want to leave the room?')) {
      onLeave();
    }
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomState.roomId);
    alert('Room code copied to clipboard!');
  };

  return (
    <div className="room">
      <div className="room-header">
        <div className="room-info">
          <h2>Room: {roomState.roomId}</h2>
          {isHost && <span className="host-badge">Host</span>}
          <button onClick={copyRoomCode} className="btn-secondary btn-small">
            Copy Code
          </button>
        </div>
        <button onClick={handleLeave} className="btn-danger">
          Leave Room
        </button>
      </div>

      <div className="room-content">
        <div className="room-section">
          <h3>Members ({roomState.members?.length || 0})</h3>
          <div className="members-list">
            {roomState.members?.map((member) => (
              <div key={member.user_id} className="member-item">
                <span className="member-name">{member.display_name}</span>
                {member.is_host && <span className="member-badge">Host</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="room-section">
          <h3>Now Playing</h3>
          
          {syncing && (
            <div className="sync-indicator">
              Syncing playback...
            </div>
          )}
          
          {player.currentTrack ? (
            <div className="now-playing">
              <div className="track-info">
                <p className="track-name">{player.currentTrack.name}</p>
                <p className="track-artist">{player.currentTrack.artists}</p>
                <p className="track-album">{player.currentTrack.album}</p>
              </div>
              
              <div className="playback-controls">
                <div className="playback-status">
                  {player.isPaused ? '⏸ Paused' : '▶ Playing'}
                </div>
                
                {isHost && (
                  <div className="host-controls">
                    <p className="control-note">
                      Use your Spotify app to control playback
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="no-track">
              <p>No track playing</p>
              {isHost && (
                <p className="hint">Start playing music from your Spotify app</p>
              )}
            </div>
          )}
        </div>

        {isHost && (
          <div className="room-section host-info">
            <h3>Host Controls</h3>
            <p>
              As the host, your playback is synchronized to all members.
              Use your Spotify app or the web player to control what everyone hears.
            </p>
            <p className="warning">
              If you disconnect, the room will close.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Room;
