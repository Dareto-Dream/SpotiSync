import React, { useMemo, useState } from 'react';
import { ListPlus, Music2, Plus } from 'lucide-react';
import { api } from '../auth/api';
import { useRoom } from '../../context/RoomContext';
import styles from './PlaylistImport.module.css';

export default function PlaylistImport() {
  const [input, setInput] = useState('');
  const [playlist, setPlaylist] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { send } = useRoom();

  const selectedCount = selected.size;
  const allSelected = tracks.length > 0 && selectedCount === tracks.length;

  const formattedCount = useMemo(() => {
    if (!playlist?.itemCount && tracks.length === 0) return null;
    const count = playlist?.itemCount || tracks.length;
    return `${count} track${count === 1 ? '' : 's'}`;
  }, [playlist, tracks.length]);

  const formatDuration = (ms) => {
    if (!ms) return '';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const loadPlaylist = async () => {
    if (!input.trim()) {
      setError('Enter a YouTube playlist URL or ID.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/api/search/playlist?url=${encodeURIComponent(input.trim())}`);
      setPlaylist(data.playlist || null);
      setTracks(Array.isArray(data.tracks) ? data.tracks : []);
      setSelected(new Set());
    } catch (err) {
      setError(err.message);
      setPlaylist(null);
      setTracks([]);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  };

  const toggleSelected = (videoId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(tracks.map(t => t.videoId)));
  const clearAll = () => setSelected(new Set());

  const queueTracks = (items) => {
    items.forEach((track) => send('queue_add', { item: track }));
  };

  const queueSelected = () => {
    if (selected.size === 0) return;
    const items = tracks.filter(t => selected.has(t.videoId));
    queueTracks(items);
  };

  const queueAll = () => {
    if (tracks.length === 0) return;
    queueTracks(tracks);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.inputRow}>
        <div className={styles.inputWrap}>
          <span className={styles.icon}><ListPlus size={16} strokeWidth={1.75} /></span>
          <input
            type="text"
            placeholder="Paste YouTube playlist URL or ID..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className={styles.input}
          />
        </div>
        <button className="btn btn-primary" onClick={loadPlaylist} disabled={loading || !input.trim()}>
          {loading ? 'Loading...' : 'Load'}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {playlist && (
        <div className={styles.meta}>
          <div className={styles.thumb}>
            {playlist.thumbnailUrl ? <img src={playlist.thumbnailUrl} alt="" /> : <Music2 size={18} />}
          </div>
          <div className={styles.metaInfo}>
            <div className={styles.metaTitle}>{playlist.title}</div>
            <div className={styles.metaSub}>
              {playlist.author ? `${playlist.author} · ` : ''}{formattedCount || ''}
            </div>
          </div>
        </div>
      )}

      {tracks.length > 0 && (
        <div className={styles.actions}>
          <label className={styles.selectAll}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => (allSelected ? clearAll() : selectAll())}
            />
            Select all ({tracks.length})
          </label>
          <div className={styles.actionBtns}>
            <button
              className="btn btn-secondary"
              onClick={queueSelected}
              disabled={selected.size === 0}
            >
              Queue selected ({selectedCount})
            </button>
            <button
              className="btn btn-primary"
              onClick={queueAll}
            >
              Queue all
            </button>
          </div>
        </div>
      )}

      {tracks.length > 0 && (
        <ul className={styles.list}>
          {tracks.map((track) => (
            <li key={track.videoId} className={styles.row}>
              <input
                type="checkbox"
                checked={selected.has(track.videoId)}
                onChange={() => toggleSelected(track.videoId)}
                className={styles.check}
              />
              <div className={styles.trackThumb}>
                {track.thumbnailUrl
                  ? <img src={track.thumbnailUrl} alt="" />
                  : <Music2 size={18} />}
              </div>
              <div className={styles.trackInfo}>
                <div className={styles.title}>{track.title}</div>
                <div className={styles.metaText}>{track.artist}{track.album ? ` - ${track.album}` : ''}</div>
              </div>
              <div className={styles.duration}>{formatDuration(track.durationMs)}</div>
              <button
                className={styles.addBtn}
                onClick={() => queueTracks([track])}
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
