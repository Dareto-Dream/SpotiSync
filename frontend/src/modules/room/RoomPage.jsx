import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Music4, Search as SearchIcon, ListMusic, Users, Copy, Settings, DoorOpen, Info, PlayCircle } from 'lucide-react';
import { useRoom } from '../../context/RoomContext';
import { useAuth } from '../../context/AuthContext';
import Player from '../player/Player';
import Search from '../search/Search';
import Queue from '../queue/Queue';
import Members from './Members';
import VoteBar from '../voting/VoteBar';
import RoomSettings from './RoomSettings';
import styles from './RoomPage.module.css';

export default function RoomPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { room, isHost, error, joinRoom, leaveRoom, votes } = useRoom();
  const [tab, setTab] = useState('queue');
  const [showSettings, setShowSettings] = useState(false);
  const isPlayerOnly = tab === 'player';

  useEffect(() => {
    if (!room && code) {
      joinRoom(code);
    }
  }, []);

  useEffect(() => {
    if (error && error.toLowerCase().includes('closed')) {
      alert(error);
      navigate('/');
    }
  }, [error]);

  const handleLeave = () => {
    leaveRoom();
    navigate('/');
  };

  if (!room && !error) {
    return (
      <div className={styles.loadingPage}>
        <span className="spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
        <p>Connecting to room...</p>
      </div>
    );
  }

  if (error && !room) {
    return (
      <div className={styles.loadingPage}>
        <p style={{ color: 'var(--error)' }}>{error}</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>Back to Lobby</button>
      </div>
    );
  }

  const renderTabs = (className) => (
    <div className={className}>
      <button
        className={`${styles.tabBtn} ${tab === 'search' ? styles.active : ''}`}
        onClick={() => setTab('search')}
      >
        <SearchIcon size={15} /> Search
      </button>
      <button
        className={`${styles.tabBtn} ${tab === 'queue' ? styles.active : ''}`}
        onClick={() => setTab('queue')}
      >
        <ListMusic size={15} /> Queue
      </button>
      <button
        className={`${styles.tabBtn} ${tab === 'members' ? styles.active : ''}`}
        onClick={() => setTab('members')}
      >
        <Users size={15} /> People
      </button>
      <button
        className={`${styles.tabBtn} ${tab === 'player' ? styles.active : ''}`}
        onClick={() => setTab('player')}
      >
        <PlayCircle size={15} /> Player
      </button>
    </div>
  );

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.roomInfo}>
          <span className={styles.brand}><Music4 size={18} /> Jam Mode</span>
          <div className={styles.code}>
            <span className={styles.codeLabel}>Code</span>
            <span className={styles.codeValue}>{room?.joinCode}</span>
            <button
              className="btn-icon"
              onClick={() => navigator.clipboard?.writeText(room?.joinCode)}
              title="Copy code"
            >
              <Copy size={16} />
            </button>
          </div>
        </div>
        <div className={styles.headerRight}>
          {isHost && (
            <button
              className="btn btn-secondary"
              onClick={() => setShowSettings(s => !s)}
            >
              <Settings size={16} /> Settings
            </button>
          )}
          <button className="btn btn-secondary" onClick={handleLeave}>
            <DoorOpen size={16} /> {isHost ? 'Close Room' : 'Leave'}
          </button>
        </div>
      </header>

      {/* Settings overlay */}
      {showSettings && isHost && (
        <div className={styles.settingsOverlay} onClick={e => e.target === e.currentTarget && setShowSettings(false)}>
          <div className={styles.settingsPanel}>
            <RoomSettings onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}

      {/* Main layout */}
      <div className={`${styles.layout} ${isPlayerOnly ? styles.playerOnly : ''}`}>
        {/* Left: Player */}
        <div className={`${styles.playerCol} ${isPlayerOnly ? styles.playerExpanded : ''}`}>
          <Player large={isPlayerOnly} />
          {votes && <VoteBar />}
          {!isHost && (
            <div className={styles.muteNote}>
              <Info size={14} style={{ marginRight: 6 }} />
              Use the mute button for local silence. Only the host can pause.
            </div>
          )}

          {isPlayerOnly && (
            <div className={styles.playerTabs}>
              {renderTabs(styles.playerTabBar)}
            </div>
          )}
        </div>

        {/* Right: Tabs */}
        {!isPlayerOnly && (
          <div className={styles.sideCol}>
            {renderTabs(styles.tabs)}

            <div className={styles.tabContent}>
              {tab === 'search' && <Search />}
              {tab === 'queue' && <Queue />}
              {tab === 'members' && <Members />}
              {tab === 'player' && <div className={styles.playerTabPlaceholder}>Player tab is open</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
