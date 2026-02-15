import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import api from '../api/client';
import '../styles/Host.css';

export default function Host() {
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const navigate = useNavigate();
  const { user, login, joinRoom } = useApp();

  const handleLogin = async () => {
    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await api.getAuthUrl('host');
      window.location.href = result.authUrl;
    } catch (error) {
      console.error('Auth error:', error);
      setError('Failed to start authentication');
      setLoading(false);
    }
  };

  const handleCreateRoom = async () => {
    if (!user) {
      setError('Please authenticate with Spotify first');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await api.createRoom(user.userId, user.displayName);
      
      joinRoom(result.roomCode, result, true);
      navigate('/room');
    } catch (error) {
      console.error('Create room error:', error);
      setError('Failed to create room');
      setLoading(false);
    }
  };

  // If user is already authenticated, show create room button
  if (user) {
    return (
      <div className="host-page">
        <div className="host-container">
          <div className="host-header">
            <h1>Create Your Jam</h1>
            <p>Welcome, {user.displayName}!</p>
          </div>

          <div className="host-content">
            <div className="host-info">
              <div className="info-item">
                <span className="icon">🎵</span>
                <div>
                  <h3>You're the DJ</h3>
                  <p>Control playback and manage the queue</p>
                </div>
              </div>

              <div className="info-item">
                <span className="icon">🔗</span>
                <div>
                  <h3>Share the Code</h3>
                  <p>Guests can join with a simple 6-character code</p>
                </div>
              </div>

              <div className="info-item">
                <span className="icon">🎧</span>
                <div>
                  <h3>Listen Together</h3>
                  <p>Everyone hears the same thing at the same time</p>
                </div>
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <button
              onClick={handleCreateRoom}
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Room'}
            </button>

            <button
              onClick={() => navigate('/')}
              className="btn btn-text"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="host-page">
      <div className="host-container">
        <div className="host-header">
          <h1>Host a Jam</h1>
          <p>Connect your Spotify account to get started</p>
        </div>

        <div className="host-content">
          <div className="auth-section">
            <div className="requirements">
              <h3>Requirements:</h3>
              <ul>
                <li>Spotify Premium account</li>
                <li>Active internet connection</li>
                <li>Modern web browser</li>
              </ul>
            </div>

            <div className="form-group">
              <label htmlFor="hostName">Your Display Name</label>
              <input
                id="hostName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                maxLength={30}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleLogin();
                  }
                }}
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <button
              onClick={handleLogin}
              className="btn btn-spotify"
              disabled={loading}
            >
              {loading ? 'Connecting...' : 'Connect with Spotify'}
            </button>

            <button
              onClick={() => navigate('/')}
              className="btn btn-text"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
