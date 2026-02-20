import React, { useState, useCallback, useRef } from 'react';
import { Search as SearchIcon, Music2, Plus } from 'lucide-react';
import { api } from '../auth/api';
import { useRoom } from '../../context/RoomContext';
import styles from './Search.module.css';

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { send } = useRoom();
  const debounceRef = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/search?q=${encodeURIComponent(q)}&limit=15`);
      setResults(data.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 500);
  };

  const addToQueue = (track) => {
    send('queue_add', { item: track });
  };

  const formatDuration = (ms) => {
    if (!ms) return '';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className={styles.searchWrap}>
      <div className={styles.inputWrap}>
        <span className={styles.icon}><SearchIcon size={16} strokeWidth={1.75} /></span>
        <input
          type="text"
          placeholder="Search YouTube Music..."
          value={query}
          onChange={handleChange}
          className={styles.input}
        />
        {loading && <span className="spinner" style={{ marginRight: 8 }} />}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((track) => (
            <li key={track.videoId} className={styles.result}>
              <div className={styles.thumb}>
                {track.thumbnailUrl
                  ? <img src={track.thumbnailUrl} alt="" />
                  : <Music2 size={18} />}
              </div>
              <div className={styles.trackInfo}>
                <div className={styles.title}>{track.title}</div>
                <div className={styles.meta}>{track.artist}{track.album ? ` - ${track.album}` : ''}</div>
              </div>
              <div className={styles.duration}>{formatDuration(track.durationMs)}</div>
              <button
                className={styles.addBtn}
                onClick={() => addToQueue(track)}
                title="Add to queue"
                aria-label="Add to queue"
              >
                <Plus size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
