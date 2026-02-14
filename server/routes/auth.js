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

// GET /api/auth/login
router.get('/login', (req, res) => {
  console.log('[Auth] /login called', {
    timestamp: new Date().toISOString()
  });

  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now());

  console.log('[Auth] Generated OAuth state:', state);

  // Clean up old states
  for (const [k, v] of pendingStates) {
    if (Date.now() - v > 600000) {
      pendingStates.delete(k);
      console.log('[Auth] Cleaned up expired state:', k);
    }
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    state,
    show_dialog: 'true',
  });

  const authUrl = `https://accounts.spotify.com/authorize?${params}`;
  console.log('[Auth] Redirecting to Spotify OAuth:', {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
    scopes: SCOPES
  });

  res.redirect(authUrl);
});

// GET /api/auth/callback
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

  console.log('[Auth] /callback called', {
    hasCode: !!code,
    hasState: !!state,
    error,
    timestamp: new Date().toISOString()
  });

  if (error) {
    console.error('[Auth] OAuth error:', error);
    return res.redirect(`${CLIENT_URL}/host?error=${encodeURIComponent(error)}`);
  }

  if (!state || !pendingStates.has(state)) {
    console.error('[Auth] Invalid or missing state:', {
      receivedState: state,
      hasPendingState: pendingStates.has(state),
      pendingStatesCount: pendingStates.size
    });
    return res.redirect(`${CLIENT_URL}/host?error=state_mismatch`);
  }

  console.log('[Auth] ✅ State validated, exchanging code for tokens...');
  pendingStates.delete(state);

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.SPOTIFY_REDIRECT_URI,
    });

    console.log('[Auth] POSTing to Spotify token endpoint...');
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

    console.log('[Auth] Token exchange response:', {
      status: tokenRes.status,
      statusText: tokenRes.statusText,
      ok: tokenRes.ok
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error('[Auth] ❌ Token exchange failed:', {
        status: tokenRes.status,
        errorText
      });
      throw new Error('Token exchange failed');
    }

    const data = await tokenRes.json();
    console.log('[Auth] ✅ Tokens received:', {
      hasAccessToken: !!data.access_token,
      hasRefreshToken: !!data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
      scope: data.scope
    });

    // Redirect to client with tokens
    const params = new URLSearchParams({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    });

    const redirectUrl = `${CLIENT_URL}/host?${params}`;
    console.log('[Auth] Redirecting to client with tokens');
    res.redirect(redirectUrl);
  } catch (err) {
    console.error('[Auth] ❌ Callback error:', err);
    res.redirect(`${CLIENT_URL}/host?error=token_exchange_failed`);
  }
});

// GET /api/auth/client-id
router.get('/client-id', (_req, res) => {
  console.log('[Auth] /client-id called');
  res.json({ clientId: process.env.SPOTIFY_CLIENT_ID });
});

export default router;
