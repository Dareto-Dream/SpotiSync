import React, { useEffect, useState } from 'react';
import './App.css';
import api from './services/api';
import useSpotifyPlayer from './hooks/useSpotifyPlayer';
import useWebSocket from './hooks/useWebSocket';
import LoginScreen from './components/LoginScreen';
import Lobby from './components/Lobby';
import Room from './components/Room';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('lobby'); // lobby, room

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const currentUser = await api.getCurrentUser();
      setUser(currentUser);
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      const { url } = await api.getLoginUrl();
      window.location.href = url;
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
      setUser(null);
      setView('lobby');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const getAccessToken = async () => {
    try {
      return await api.getAccessToken();
    } catch (error) {
      console.error('Failed to get access token:', error);
      throw error;
    }
  };

  const player = useSpotifyPlayer(getAccessToken);
  const ws = useWebSocket(user);

  const handleCreateRoom = () => {
    ws.createRoom();
    setView('room');
  };

  const handleJoinRoom = (roomId) => {
    ws.joinRoom(roomId);
    setView('room');
  };

  const handleLeaveRoom = () => {
    ws.leaveRoom();
    setView('lobby');
  };

  // Handle room closed event
  useEffect(() => {
    if (!ws.connected) return;
    
    return ws.on('room_closed', () => {
      setView('lobby');
    });
  }, [ws]);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎵 Spotify Rooms</h1>
        <div className="user-info">
          <span>{user.displayName}</span>
          <button onClick={handleLogout} className="btn-secondary">
            Logout
          </button>
        </div>
      </header>

      <main className="app-main">
        {view === 'lobby' && (
          <Lobby
            user={user}
            ws={ws}
            player={player}
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
          />
        )}

        {view === 'room' && ws.roomState && (
          <Room
            user={user}
            ws={ws}
            player={player}
            roomState={ws.roomState}
            onLeave={handleLeaveRoom}
          />
        )}
      </main>
    </div>
  );
}

export default App;
