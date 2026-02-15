import axios from 'axios';
import { query } from '../database/db.js';

const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

const REQUIRED_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative'
].join(' ');

export function getAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    scope: REQUIRED_SCOPES,
    state: state || 'default',
    show_dialog: 'false'
  });

  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code) {
  const authString = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

  try {
    const response = await axios.post(
      SPOTIFY_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.SPOTIFY_REDIRECT_URI
      }),
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    
    // Get user profile to get user ID
    const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });

    const userId = profileResponse.data.id;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Store tokens in database
    await query(
      `INSERT INTO auth_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, access_token, refresh_token, expiresAt]
    );

    return {
      userId,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt,
      profile: profileResponse.data
    };
  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    throw new Error('Failed to exchange authorization code');
  }
}

export async function refreshAccessToken(userId) {
  try {
    // Get refresh token from database
    const result = await query(
      'SELECT refresh_token FROM auth_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('No refresh token found for user');
    }

    const refreshToken = result.rows[0].refresh_token;
    const authString = Buffer.from(
      `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
    ).toString('base64');

    const response = await axios.post(
      SPOTIFY_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      {
        headers: {
          'Authorization': `Basic ${authString}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const { access_token, expires_in, refresh_token: newRefreshToken } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Update tokens in database
    await query(
      `UPDATE auth_tokens
       SET access_token = $1,
           refresh_token = COALESCE($2, refresh_token),
           expires_at = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $4`,
      [access_token, newRefreshToken, expiresAt, userId]
    );

    return {
      accessToken: access_token,
      expiresAt
    };
  } catch (error) {
    console.error('Token refresh error:', error.response?.data || error.message);
    throw new Error('Failed to refresh access token');
  }
}

export async function getValidAccessToken(userId) {
  try {
    const result = await query(
      'SELECT access_token, expires_at FROM auth_tokens WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new Error('No token found for user');
    }

    const { access_token, expires_at } = result.rows[0];
    const expiresAt = new Date(expires_at);
    const now = new Date();

    // Refresh if token expires in less than 5 minutes
    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      console.log('Token expiring soon, refreshing...');
      const refreshed = await refreshAccessToken(userId);
      return refreshed.accessToken;
    }

    return access_token;
  } catch (error) {
    console.error('Error getting valid access token:', error);
    throw error;
  }
}

export async function getUserProfile(accessToken) {
  try {
    const response = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching user profile:', error);
    throw error;
  }
}
