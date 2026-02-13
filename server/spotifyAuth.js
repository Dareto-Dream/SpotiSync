const axios = require('axios');
const db = require('./db');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback';

const REQUIRED_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing'
].join(' ');

class SpotifyAuth {
  // Generate authorization URL
  getAuthUrl() {
    const params = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: SPOTIFY_REDIRECT_URI,
      scope: REQUIRED_SCOPES,
      show_dialog: 'false'
    });
    
    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  // Exchange code for tokens
  async exchangeCode(code) {
    try {
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: SPOTIFY_REDIRECT_URI
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(
              `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
            ).toString('base64')
          }
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;
      
      // Get user profile
      const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
        headers: { 'Authorization': `Bearer ${access_token}` }
      });
      
      const userId = profileResponse.data.id;
      const displayName = profileResponse.data.display_name || userId;
      
      // Store tokens in database
      await this.storeTokens(userId, access_token, refresh_token, expires_in);
      
      return {
        userId,
        displayName,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresIn: expires_in
      };
    } catch (error) {
      console.error('Token exchange failed:', error.response?.data || error.message);
      throw new Error('Failed to exchange authorization code');
    }
  }

  // Store tokens in database
  async storeTokens(userId, accessToken, refreshToken, expiresIn) {
    const expiresAt = new Date(Date.now() + (expiresIn * 1000));
    
    await db.query(
      `INSERT INTO user_tokens (user_id, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
       SET access_token = $2,
           refresh_token = $3,
           expires_at = $4,
           updated_at = NOW()`,
      [userId, accessToken, refreshToken, expiresAt]
    );
  }

  // Get fresh access token (refresh if needed)
  async getFreshToken(userId) {
    try {
      // Get current token from database
      const result = await db.query(
        'SELECT access_token, refresh_token, expires_at FROM user_tokens WHERE user_id = $1',
        [userId]
      );
      
      if (result.rows.length === 0) {
        throw new Error('No tokens found for user');
      }
      
      const { access_token, refresh_token, expires_at } = result.rows[0];
      
      // Check if token is still valid (with 5 minute buffer)
      const expiresAt = new Date(expires_at);
      const now = new Date();
      const bufferMs = 5 * 60 * 1000; // 5 minutes
      
      if (expiresAt.getTime() - now.getTime() > bufferMs) {
        return access_token;
      }
      
      // Token expired or expiring soon, refresh it
      console.log(`Refreshing token for user ${userId}`);
      const newToken = await this.refreshToken(refresh_token);
      
      // Store new tokens
      await this.storeTokens(userId, newToken.access_token, refresh_token, newToken.expires_in);
      
      return newToken.access_token;
    } catch (error) {
      console.error('Failed to get fresh token:', error);
      throw error;
    }
  }

  // Refresh access token
  async refreshToken(refreshToken) {
    try {
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(
              `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
            ).toString('base64')
          }
        }
      );

      return {
        access_token: response.data.access_token,
        expires_in: response.data.expires_in
      };
    } catch (error) {
      console.error('Token refresh failed:', error.response?.data || error.message);
      throw new Error('Failed to refresh token');
    }
  }

  // Transfer playback to specific device
  async transferPlayback(userId, deviceId) {
    try {
      const accessToken = await this.getFreshToken(userId);
      
      await axios.put(
        'https://api.spotify.com/v1/me/player',
        {
          device_ids: [deviceId],
          play: false
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`Transferred playback to device ${deviceId} for user ${userId}`);
      return true;
    } catch (error) {
      console.error('Failed to transfer playback:', error.response?.data || error.message);
      return false;
    }
  }
}

module.exports = new SpotifyAuth();
