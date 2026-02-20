import React from 'react';
import { useRoom } from '../../context/RoomContext';
import { useAuth } from '../../context/AuthContext';
import styles from './Members.module.css';

export default function Members() {
  const { members, room } = useRoom();
  const { user } = useAuth();

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>Members ({members.length})</span>
      </div>
      <ul className={styles.list}>
        {members.map(m => (
          <li key={m.id} className={styles.member}>
            <div className={styles.avatar}>
              {(m.username || '?')[0].toUpperCase()}
            </div>
            <span className={styles.name}>
              {m.username}
              {m.id === user?.id && ' (you)'}
            </span>
            {m.id === room?.hostId && (
              <span className="badge badge-host">Host</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
