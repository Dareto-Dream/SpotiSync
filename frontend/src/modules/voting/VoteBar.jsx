import React from 'react';
import { useRoom } from '../../context/RoomContext';
import styles from './VoteBar.module.css';

export default function VoteBar() {
  const { votes, members, room } = useRoom();
  if (!votes || !room) return null;

  const threshold = room.settings?.voteThreshold || 0.5;
  const memberCount = members.length;
  const needed = Math.ceil(memberCount * threshold);
  const skipVotes = votes.voteCount || 0;
  const pct = memberCount > 0 ? Math.min(1, skipVotes / memberCount) : 0;

  return (
    <div className={styles.voteBar}>
      <span className={styles.label}>
        🗳 Skip vote: {skipVotes}/{needed}
      </span>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pct * 100}%` }} />
      </div>
      {votes.passed && <span className={styles.passed}>Vote passed!</span>}
    </div>
  );
}
