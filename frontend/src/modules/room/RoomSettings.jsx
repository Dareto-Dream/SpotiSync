import React, { useState } from 'react';
import { useRoom } from '../../context/RoomContext';
import styles from './RoomSettings.module.css';

export default function RoomSettings({ onClose }) {
  const { room, send } = useRoom();
  const [settings, setSettings] = useState({ ...room?.settings });

  if (!room) return null;

  const update = (key, value) => {
    setSettings(s => ({ ...s, [key]: value }));
  };

  const save = () => {
    send('settings_update', { settings });
    onClose?.();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3>Room Settings</h3>
        <button className="btn-icon" onClick={onClose}>✕</button>
      </div>

      <div className={styles.field}>
        <label>User Skip Mode</label>
        <select value={settings.userSkipMode} onChange={e => update('userSkipMode', e.target.value)}>
          <option value="vote">Vote required</option>
          <option value="instant">Instant</option>
        </select>
      </div>

      <div className={styles.field}>
        <label>User Previous Mode</label>
        <select value={settings.userPrevMode} onChange={e => update('userPrevMode', e.target.value)}>
          <option value="vote">Vote required</option>
          <option value="instant">Instant</option>
        </select>
      </div>

      <div className={styles.field}>
        <label>Vote Threshold ({Math.round((settings.voteThreshold || 0.5) * 100)}%)</label>
        <input
          type="range" min="10" max="100" step="5"
          value={Math.round((settings.voteThreshold || 0.5) * 100)}
          onChange={e => update('voteThreshold', parseInt(e.target.value) / 100)}
        />
      </div>

      <div className={styles.field}>
        <label>Vote Cooldown (seconds)</label>
        <input
          type="number" min="0" max="60"
          value={settings.voteCooldownSec || 0}
          onChange={e => update('voteCooldownSec', parseInt(e.target.value))}
        />
      </div>

      <div className={styles.toggle}>
        <label>Users can add to queue</label>
        <input type="checkbox" checked={settings.userQueueing}
          onChange={e => update('userQueueing', e.target.checked)} />
      </div>

      <div className={styles.toggle}>
        <label>Users can remove from queue</label>
        <input type="checkbox" checked={settings.userRemoval}
          onChange={e => update('userRemoval', e.target.checked)} />
      </div>

      <div className={styles.toggle}>
        <label>Users can reorder queue</label>
        <input type="checkbox" checked={settings.userReordering}
          onChange={e => update('userReordering', e.target.checked)} />
      </div>

      <div className={styles.actions}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save Settings</button>
      </div>
    </div>
  );
}
