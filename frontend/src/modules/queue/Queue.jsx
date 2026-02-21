import React from 'react';
import { Inbox, Music2, Play, X, Sparkles } from 'lucide-react';
import { useRoom } from '../../context/RoomContext';
import styles from './Queue.module.css';

export default function Queue() {
  const { queue, autoplaySuggestions, isHost, send, room } = useRoom();

  const formatDuration = (ms) => {
    if (!ms) return '';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const canRemove = isHost || room?.settings?.userRemoval;
  const hasQueue = queue && queue.length > 0;
  const offset = queue?.length || 0;

  return (
    <div className={styles.queueWrap}>
      <div className={styles.header}>
        <span className={styles.title}>Up Next ({offset})</span>
      </div>

      {hasQueue ? (
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
      ) : (
        <div className={styles.empty}>
          <Inbox className={styles.emptyIcon} />
          <p>Queue is empty</p>
          <p className={styles.hint}>Add a song—autoplay only kicks in after the queue.</p>
        </div>
      )}

      {autoplaySuggestions?.length > 0 && (
        <div className={styles.autoplaySection}>
          <div className={styles.autoplayHeader}>
            <span className={styles.title}><Sparkles size={14} /> Autoplay preview</span>
            <span className={styles.badge}>{autoplaySuggestions.length}</span>
          </div>
          <p className={styles.subHint}>These will play after the queue unless someone adds a song.</p>
          <ul className={`${styles.list} ${styles.autoplayList}`}>
            {autoplaySuggestions.slice(0, 10).map((track, index) => (
              <li key={`${track.videoId}-auto-${index}`} className={`${styles.item} ${styles.autoplayItem}`}>
                <span className={styles.pos}>{offset + index + 1}</span>
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
                <span className={styles.pill}>Autoplay</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
