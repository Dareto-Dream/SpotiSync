import { useState } from 'react';
import api from '../api/client';

export default function Search({ onAddToQueue, userId }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e) => {
    e.preventDefault();
    
    if (!query.trim()) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const data = await api.searchTracks(query, userId);
      setResults(data.results || []);
    } catch (error) {
      console.error('Search error:', error);
      setError('Failed to search tracks');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = (track) => {
    onAddToQueue(track);
    setResults(results.filter(t => t.uri !== track.uri));
  };

  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="search">
      <form onSubmit={handleSearch} className="search-form">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for songs..."
          className="search-input"
          disabled={loading}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}

      {results.length > 0 && (
        <div className="search-results">
          {results.map((track) => (
            <div key={track.uri} className="search-result-item">
              {track.albumArt && (
                <img
                  src={track.albumArt}
                  alt={track.album}
                  className="result-album-art"
                />
              )}
              
              <div className="result-info">
                <div className="result-name">{track.name}</div>
                <div className="result-artist">{track.artists}</div>
              </div>

              <div className="result-meta">
                <span className="result-duration">
                  {formatDuration(track.durationMs)}
                </span>
              </div>

              <button
                onClick={() => handleAdd(track)}
                className="btn btn-add"
              >
                Add
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
