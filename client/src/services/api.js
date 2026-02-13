const API_BASE = process.env.REACT_APP_API_URL || '';

class API {
  async request(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // Get login URL
  async getLoginUrl() {
    return this.request('/api/auth/login');
  }

  // Get current user
  async getCurrentUser() {
    try {
      return await this.request('/api/auth/me');
    } catch (error) {
      return null;
    }
  }

  // Logout
  async logout() {
    return this.request('/api/auth/logout', { method: 'POST' });
  }

  // Get fresh access token
  async getAccessToken() {
    const response = await this.request('/api/auth/token');
    return response.accessToken;
  }

  // Transfer playback to device
  async transferPlayback(deviceId) {
    return this.request('/api/playback/transfer', {
      method: 'POST',
      body: JSON.stringify({ deviceId })
    });
  }
}

export default new API();
