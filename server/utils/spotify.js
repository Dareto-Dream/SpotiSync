const SPOTIFY_API_BASE = 'https://api.spotify.com';

export async function spotifyGet(endpoint, token) {
  console.log(`[Spotify API] GET ${endpoint}`, {
    hasToken: !!token,
    tokenPreview: token?.substring(0, 20) + '...',
    timestamp: new Date().toISOString()
  });

  const url = `${SPOTIFY_API_BASE}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`[Spotify API] GET ${endpoint} response:`, {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers),
      timestamp: new Date().toISOString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Spotify API] GET ${endpoint} error response:`, {
        status: response.status,
        errorText
      });
    }

    return response;
  } catch (err) {
    console.error(`[Spotify API] GET ${endpoint} fetch error:`, err);
    throw err;
  }
}

export async function spotifyPut(endpoint, body, token) {
  console.log(`[Spotify API] PUT ${endpoint}`, {
    body,
    hasToken: !!token,
    tokenPreview: token?.substring(0, 20) + '...',
    timestamp: new Date().toISOString()
  });

  const url = `${SPOTIFY_API_BASE}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    console.log(`[Spotify API] PUT ${endpoint} response:`, {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers),
      timestamp: new Date().toISOString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Spotify API] PUT ${endpoint} error response:`, {
        status: response.status,
        errorText,
        requestBody: body
      });
    }

    return response;
  } catch (err) {
    console.error(`[Spotify API] PUT ${endpoint} fetch error:`, err);
    throw err;
  }
}

export async function spotifyPost(endpoint, body, token) {
  console.log(`[Spotify API] POST ${endpoint}`, {
    body,
    hasToken: !!token,
    tokenPreview: token?.substring(0, 20) + '...',
    timestamp: new Date().toISOString()
  });

  const url = `${SPOTIFY_API_BASE}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    console.log(`[Spotify API] POST ${endpoint} response:`, {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      timestamp: new Date().toISOString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Spotify API] POST ${endpoint} error response:`, {
        status: response.status,
        errorText
      });
    }

    return response;
  } catch (err) {
    console.error(`[Spotify API] POST ${endpoint} fetch error:`, err);
    throw err;
  }
}

export async function getValidToken(session, sessionStore) {
  console.log('[Token] getValidToken called:', {
    sessionId: session.id,
    hasToken: !!session.hostToken,
    hasRefreshToken: !!session.hostRefreshToken,
    tokenExpiry: session.hostTokenExpiry,
    now: Date.now(),
    expiresIn: session.hostTokenExpiry ? Math.floor((session.hostTokenExpiry - Date.now()) / 1000) : null
  });

  // Check if token is still valid (at least 60 seconds remaining)
  if (session.hostToken && session.hostTokenExpiry && session.hostTokenExpiry > Date.now() + 60000) {
    console.log('[Token] ✅ Existing token is valid, returning it');
    return session.hostToken;
  }

  console.log('[Token] Token expired or expiring soon, refreshing...');

  if (!session.hostRefreshToken) {
    console.error('[Token] ❌ No refresh token available!');
    throw new Error('No refresh token available to refresh access token');
  }

  try {
    console.log('[Token] Calling Spotify token refresh endpoint...');
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: session.hostRefreshToken,
      }),
    });

    console.log('[Token] Refresh response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Token] ❌ Refresh failed:', {
        status: response.status,
        errorText
      });
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('[Token] ✅ New token received:', {
      hasAccessToken: !!data.access_token,
      hasRefreshToken: !!data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type
    });

    const newExpiry = Date.now() + (data.expires_in * 1000);

    // Update session with new token
    await sessionStore.update(session.id, {
      hostToken: data.access_token,
      hostRefreshToken: data.refresh_token || session.hostRefreshToken,
      hostTokenExpiry: newExpiry,
    });

    console.log('[Token] ✅ Session updated with new token, expires at:', new Date(newExpiry).toISOString());

    return data.access_token;
  } catch (err) {
    console.error('[Token] Token refresh error:', err);
    throw err;
  }
}
