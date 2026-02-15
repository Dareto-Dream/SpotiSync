import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import api from '../api/client';
import '../styles/Home.css';

export default function Home() {
  const [joinCode, setJoinCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const navigate = useNavigate();
  const { login, joinRoom } = useApp();

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    
    if (!joinCode.trim() || !displayName.trim()) {
      setError('Please enter both room code and display name');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Generate temporary user ID for guests
      const userId = `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Join the room
      const result = await api.joinRoom(joinCode.toUpperCase(), userId, displayName);
      
      // Update app state
      login(userId, displayName);
      joinRoom(joinCode.toUpperCase(), result.room, false);
      
      // Navigate to room
      navigate('/room');
    } catch (error) {
      console.error('Join error:', error);
      setError(error.message || 'Failed to join room');
    } finally {
      setLoading(false);
    }
  };

  const handleHostClick = () => {
    navigate('/host');
  };

  return (
    <div className="home-page">
      <div className="home-container">
        <div className="home-header">
          <h1 className="title">🎵 Spotify Jam</h1>
          <p className="subtitle">Listen together, anywhere</p>
        </div>

        <div className="home-content">
          <div className="join-section">
            <h2>Join a Jam</h2>
            <form onSubmit={handleJoinRoom} className="join-form">
              <div className="form-group">
                <label htmlFor="displayName">Your Name</label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your name"
                  maxLength={30}
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="joinCode">Room Code</label>
                <input
                  id="joinCode"
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="ABCD12"
                  maxLength={6}
                  disabled={loading}
                  className="code-input"
                />
              </div>

              {error && <div className="error-message">{error}</div>}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading ? 'Joining...' : 'Join Room'}
              </button>
            </form>
          </div>

          <div className="divider">
            <span>OR</span>
          </div>

          <div className="host-section">
            <h2>Host a Jam</h2>
            <p className="host-description">
              Create your own room and control the music
            </p>
            <button
              onClick={handleHostClick}
              className="btn btn-secondary"
            >
              Start Hosting
            </button>
          </div>
        </div>

        <div className="home-footer">
          <p className="feature-text">
            ✨ Collaborative queue • Real-time sync • Spotify Premium required for hosts
          </p>
        </div>
      </div>
    </div>
  );
}
