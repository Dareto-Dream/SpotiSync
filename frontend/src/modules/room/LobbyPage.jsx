import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRoom } from '../../context/RoomContext';
import { api } from '../auth/api';
import styles from './LobbyPage.module.css';

export default function LobbyPage() {
  const { user, logout } = useAuth();
  const { joinRoom, error: roomError } = useRoom();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await api.post('/api/rooms', {});
      // Join the created room
      joinRoom(data.room.joinCode);
      // Wait briefly then navigate
      setTimeout(() => navigate(`/room/${data.room.joinCode}`), 500);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await api.get(`/api/rooms/code/${code.trim().toUpperCase()}`);
      joinRoom(code.trim().toUpperCase());
      setTimeout(() => navigate(`/room/${code.trim().toUpperCase()}`), 500);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>🎵 Jam Mode</div>
        <div className={styles.user}>
          <span>{user?.username}</span>
          <button className="btn btn-ghost" onClick={logout}>Sign Out</button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Start Listening Together</h1>
        <p className={styles.sub}>Create a room or join with a code</p>

        {(error || roomError) && (
          <div className={styles.error}>{error || roomError}</div>
        )}

        <div className={styles.actions}>
          <div className={styles.card}>
            <div className={styles.cardIcon}>🎸</div>
            <h2>Create Room</h2>
            <p>Start a new jam session as host</p>
            <button className="btn btn-primary w-full" onClick={handleCreate} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Create Room'}
            </button>
          </div>

          <div className={styles.divider}>or</div>

          <div className={styles.card}>
            <div className={styles.cardIcon}>🔑</div>
            <h2>Join Room</h2>
            <p>Enter a room code to join friends</p>
            <form onSubmit={handleJoin} className={styles.joinForm}>
              <input
                type="text"
                placeholder="Enter 6-digit code"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase().slice(0, 6))}
                maxLength={6}
                className={styles.codeInput}
              />
              <button type="submit" className="btn btn-primary w-full" disabled={loading || code.length !== 6}>
                {loading ? <span className="spinner" /> : 'Join'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
