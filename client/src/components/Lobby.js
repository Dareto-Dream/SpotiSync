import React, { useState, useEffect } from 'react';
import api from '../services/api';

function Lobby({ user, ws, player, onCreateRoom, onJoinRoom }) {
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState(null);

  // Handle player connection - requires user gesture
  const handleConnectPlayer = async () => {
    if (player.playerState === 'connected') {
      return;
    }

    if (player.playerState !== 'ready') {
      setError('Player not ready. Please refresh the page.');
      return;
    }

    const connected = await player.connect();
    
    if (connected && player.deviceId) {
      // Transfer playback to this device
      try {
        await api.transferPlayback(player.deviceId);
        ws.notifyDeviceReady(player.deviceId);
        setError(null);
      } catch (err) {
        console.error('Failed to transfer playback:', err);
        setError('Failed to activate player');
      }
    }
  };

  const handleCreateRoom = async () => {
    if (player.playerState !== 'connected') {
      setError('Please connect the player first');
      return;
    }
    
    onCreateRoom();
  };

  const handleJoinRoom = () => {
    if (!joinCode.trim()) {
      setError('Please enter a room code');
      return;
    }
    
    if (player.playerState !== 'connected') {
      setError('Please connect the player first');
      return;
    }
    
    onJoinRoom(joinCode.trim().toUpperCase());
  };

  useEffect(() => {
    if (player.error) {
      setError(player.error);
    }
  }, [player.error]);

  useEffect(() => {
    if (ws.error) {
      setError(ws.error);
    }
  }, [ws.error]);

  const getPlayerStatusMessage = () => {
    switch (player.playerState) {
      case 'disconnected':
        return 'Initializing player...';
      case 'ready':
        return 'Player ready - click to connect';
      case 'connected':
        return 'Player connected ✓';
      default:
        return 'Loading...';
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-section">
        <h2>Player Status</h2>
        
        <div className="player-status">
          <div className={`status-indicator status-${player.playerState}`}>
            {getPlayerStatusMessage()}
          </div>
          
          {player.playerState === 'ready' && (
            <button 
              onClick={handleConnectPlayer}
              className="btn-primary"
            >
              Connect Player
            </button>
          )}
          
          {player.currentTrack && (
            <div className="current-track">
              <p className="track-name">{player.currentTrack.name}</p>
              <p className="track-artist">{player.currentTrack.artists}</p>
            </div>
          )}
        </div>
      </div>

      <div className="lobby-section">
        <h2>Create or Join a Room</h2>
        
        <div className="lobby-actions">
          <button 
            onClick={handleCreateRoom}
            className="btn-primary btn-large"
            disabled={player.playerState !== 'connected'}
          >
            Create New Room
          </button>
          
          <div className="join-room">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter room code"
              maxLength={10}
              disabled={player.playerState !== 'connected'}
            />
            <button 
              onClick={handleJoinRoom}
              className="btn-primary"
              disabled={player.playerState !== 'connected' || !joinCode.trim()}
            >
              Join Room
            </button>
          </div>
        </div>
        
        {error && (
          <div className="error-message">
            {error}
          </div>
        )}
      </div>

      <div className="lobby-info">
        <h3>How it works:</h3>
        <ol>
          <li>Connect your Spotify player</li>
          <li>Create a room or join with a code</li>
          <li>Share the code with friends</li>
          <li>Listen together in real-time</li>
        </ol>
      </div>
    </div>
  );
}

export default Lobby;
