import { useEffect, useState } from 'react';

export default function NowPlaying({ track, isPlaying, position }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!track || !isPlaying) return;

    const interval = setInterval(() => {
      setProgress(prev => {
        const next = prev + 1000;
        return next < (track.durationMs || 0) ? next : track.durationMs;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [track, isPlaying]);

  useEffect(() => {
    if (position !== undefined) {
      setProgress(position);
    }
  }, [position]);

  if (!track) {
    return (
      <div className="now-playing">
        <div className="now-playing-empty">
          <p>No track playing</p>
          <span className="icon">🎵</span>
        </div>
      </div>
    );
  }

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercent = track.durationMs
    ? (progress / track.durationMs) * 100
    : 0;

  return (
    <div className="now-playing">
      <h2 className="section-title">Now Playing</h2>
      
      <div className="track-info">
        {track.albumArt && (
          <img
            src={track.albumArt}
            alt={track.album}
            className="album-art"
          />
        )}
        
        <div className="track-details">
          <h3 className="track-name">{track.name}</h3>
          <p className="track-artist">{track.artists}</p>
          <p className="track-album">{track.album}</p>
        </div>
      </div>

      <div className="progress-section">
        <span className="time">{formatTime(progress)}</span>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="time">{formatTime(track.durationMs || 0)}</span>
      </div>

      <div className="playback-status">
        <span className={`status-indicator ${isPlaying ? 'playing' : 'paused'}`}>
          {isPlaying ? '▶ Playing' : '⏸ Paused'}
        </span>
      </div>
    </div>
  );
}
