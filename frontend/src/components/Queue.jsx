export default function Queue({ items, onRemove }) {
  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (items.length === 0) {
    return (
      <div className="queue">
        <div className="queue-empty">
          <p>Queue is empty</p>
          <span className="icon">📝</span>
          <p className="hint">Add tracks to get the party started!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="queue">
      <div className="queue-list">
        {items.map((item, index) => (
          <div key={item.id} className="queue-item">
            <div className="queue-item-number">{index + 1}</div>
            
            <div className="queue-item-info">
              <div className="queue-item-name">{item.track_name}</div>
              <div className="queue-item-artist">{item.artist_name}</div>
            </div>

            <div className="queue-item-meta">
              <span className="queue-item-duration">
                {formatDuration(item.duration_ms)}
              </span>
              <span className="queue-item-added-by">
                by {item.added_by}
              </span>
            </div>

            {onRemove && (
              <button
                onClick={() => onRemove(item.id)}
                className="btn-remove"
                title="Remove from queue"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
