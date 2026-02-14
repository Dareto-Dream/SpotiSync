import { Router } from 'express';
import crypto from 'crypto';

const router = Router();

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

// Temporary state store for OAuth CSRF protection
const pendingStates = new Map();

// GET /api/auth/login — redirect host to Spotify auth
router.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());

  // Clean up old states
  for (const [k, v] of pendingStates) {
    if (Date.now() - v > 600000) pendingStates.delete(k);
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    state,
    show_dialog: 'true',
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// GET /api/auth/callback — exchange code for tokens
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

  if (error) {
    return res.redirect(`${CLIENT_URL}/host?error=${encodeURIComponent(error)}`);
  }

  if (!state || !pendingStates.has(state)) {
    return res.redirect(`${CLIENT_URL}/host?error=state_mismatch`);
  }
  pendingStates.delete(state);

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    });

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')}`,
      },
      body,
    });

    if (!tokenRes.ok) {
      throw new Error('Token exchange failed');
    }

    const data = await tokenRes.json();

    // Redirect back to client with tokens as URL params (short-lived in URL)
    const params = new URLSearchParams({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    });

    res.redirect(`${CLIENT_URL}/host?${params}`);
  } catch (err) {
    console.error('Auth callback error:', err);
    res.redirect(`${CLIENT_URL}/host?error=token_exchange_failed`);
  }
});

// GET /api/auth/client-id — expose client id for Web Playback SDK
router.get('/client-id', (_req, res) => {
  res.json({ clientId: process.env.SPOTIFY_CLIENT_ID });
});

export default router;
