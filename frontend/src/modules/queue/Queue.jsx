import React from 'react';
import { Inbox, Music2, Play, X } from 'lucide-react';
import { useRoom } from '../../context/RoomContext';
import styles from './Queue.module.css';

export default function Queue() {
  const { queue, isHost, send, room } = useRoom();

  const formatDuration = (ms) => {
    if (!ms) return '';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const canRemove = isHost || room?.settings?.userRemoval;

  if (!queue || queue.length === 0) {
    return (
      <div className={styles.empty}>
        <Inbox className={styles.emptyIcon} />
        <p>Queue is empty</p>
        <p className={styles.hint}>Search for songs to add</p>
      </div>
    );
  }

  return (
    <div className={styles.queueWrap}>
      <div className={styles.header}>
        <span className={styles.title}>Up Next ({queue.length})</span>
      </div>
      <ul className={styles.list}>
        {queue.map((track, index) => (
          <li key={`${track.videoId}-${index}`} className={styles.item}>
            <span className={styles.pos}>{index + 1}</span>
            <div className={styles.thumb}>
              {track.thumbnailUrl
                ? <img src={track.thumbnailUrl} alt="" />
                : <Music2 size={16} />}
            </div>
            <div className={styles.info}>
              <div className={styles.itemTitle}>{track.title}</div>
              <div className={styles.itemArtist}>{track.artist}</div>
            </div>
            <span className={styles.dur}>{formatDuration(track.durationMs)}</span>
            {isHost && (
              <button
                className={styles.playNow}
                onClick={() => send('queue_play_now', { index })}
                title="Play now"
              >
                <Play size={14} />
              </button>
            )}
            {canRemove && (
              <button
                className={styles.removeBtn}
                onClick={() => send('queue_remove', { index })}
                title="Remove"
              >
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
