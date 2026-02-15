const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

class ApiClient {
  async request(endpoint, options = {}) {
    const url = `${API_URL}${endpoint}`;
    
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  // Auth endpoints
  async getAuthUrl(state) {
    return this.request(`/api/auth/login?state=${state}`);
  }

  async refreshToken(userId) {
    return this.request(`/api/auth/refresh?userId=${userId}`);
  }

  async getProfile(userId) {
    return this.request(`/api/auth/profile?userId=${userId}`);
  }

  // Room endpoints
  async createRoom(hostId, displayName) {
    return this.request('/api/rooms/create', {
      method: 'POST',
      body: JSON.stringify({ hostId, displayName })
    });
  }

  async getRoom(roomCode) {
    return this.request(`/api/rooms/${roomCode}`);
  }

  async joinRoom(roomCode, userId, displayName) {
    return this.request(`/api/rooms/${roomCode}/join`, {
      method: 'POST',
      body: JSON.stringify({ userId, displayName })
    });
  }

  // Queue endpoints
  async getQueue(roomCode) {
    return this.request(`/api/rooms/${roomCode}/queue`);
  }

  async addToQueue(roomCode, track, addedBy) {
    return this.request(`/api/rooms/${roomCode}/queue`, {
      method: 'POST',
      body: JSON.stringify({ track, addedBy })
    });
  }

  async removeFromQueue(roomCode, queueItemId) {
    return this.request(`/api/rooms/${roomCode}/queue/${queueItemId}`, {
      method: 'DELETE'
    });
  }

  // Search endpoints
  async searchTracks(query, userId) {
    const params = new URLSearchParams({ q: query, userId });
    return this.request(`/api/search?${params.toString()}`);
  }
}

export default new ApiClient();
