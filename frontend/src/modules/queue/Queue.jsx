import React from 'react';
import { Inbox, Music2, Play, X, Sparkles, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
import { useRoom } from '../../context/RoomContext';
import styles from './Queue.module.css';

export default function Queue() {
  const { queue = [], autoplayQueue = [], isHost, send, room } = useRoom();

  const formatDuration = (ms) => {
    if (!ms) return '';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const canRemove = isHost || room?.settings?.userRemoval;
  const canReorder = isHost || room?.settings?.userReordering;
  const hasQueue = queue && queue.length > 0;
  const offset = queue?.length || 0;

  const moveQueue = (from, delta) => {
    const to = from + delta;
    if (to < 0 || to >= queue.length) return;
    send('queue_reorder', { fromIndex: from, toIndex: to });
  };

  const moveAutoplay = (from, delta) => {
    const to = from + delta;
    if (to < 0 || to >= autoplayQueue.length) return;
    send('autoplay_reorder', { fromIndex: from, toIndex: to });
  };

  const promoteAutoplay = (index, toIndex = queue.length) => {
    send('autoplay_promote', { index, toIndex });
  };

  const removeAutoplay = (index) => {
    send('autoplay_remove', { index });
  };

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
              <div className={styles.controls}>
                {canReorder && (
                  <>
                    <button
                      className={styles.iconBtn}
                      onClick={() => moveQueue(index, -1)}
                      disabled={index === 0}
                      title="Move up"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      className={styles.iconBtn}
                      onClick={() => moveQueue(index, 1)}
                      disabled={index === queue.length - 1}
                      title="Move down"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </>
                )}
                {isHost && (
                  <button
                    className={styles.iconBtn}
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
              </div>
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

      {autoplayQueue?.length > 0 && (
        <div className={styles.autoplaySection}>
          <div className={styles.autoplayHeader}>
            <span className={styles.title}><Sparkles size={14} /> Autoplay queue</span>
            <span className={styles.badge}>{autoplayQueue.length}</span>
          </div>
          <p className={styles.subHint}>Always kept at 10. Normal queue plays first.</p>
          <ul className={`${styles.list} ${styles.autoplayList}`}>
            {autoplayQueue.map((track, index) => (
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
                <div className={styles.controls}>
                  {canReorder && (
                    <>
                      <button
                        className={styles.iconBtn}
                        onClick={() => moveAutoplay(index, -1)}
                        disabled={index === 0}
                        title="Move up in autoplay"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className={styles.iconBtn}
                        onClick={() => moveAutoplay(index, 1)}
                        disabled={index === autoplayQueue.length - 1}
                        title="Move down in autoplay"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className={styles.iconBtn}
                        onClick={() => promoteAutoplay(index)}
                        title="Move into main queue"
                      >
                        <ArrowRight size={14} />
                      </button>
                    </>
                  )}
                  {canRemove && (
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeAutoplay(index)}
                      title="Remove autoplay track"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
