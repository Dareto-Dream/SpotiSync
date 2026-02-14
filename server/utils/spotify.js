const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';

export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body,
  });

  if (!res.ok) throw new Error('Failed to refresh token');
  return res.json();
}

export async function spotifyGet(endpoint, token) {
  const res = await fetch(`${SPOTIFY_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err?.error?.message || res.statusText), { status: res.status });
  }
  return res.json();
}

export async function spotifyPut(endpoint, token, body) {
  const res = await fetch(`${SPOTIFY_API}${endpoint}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // 204 is success with no content
  if (res.status === 204) return {};
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err?.error?.message || res.statusText), { status: res.status });
  }
  return res.json().catch(() => ({}));
}

export async function spotifyPost(endpoint, token, body) {
  const res = await fetch(`${SPOTIFY_API}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw Object.assign(new Error(err?.error?.message || res.statusText), { status: res.status });
  }
  return res.json().catch(() => ({}));
}

// Helper to get a valid token (refreshing if needed)
export async function getValidToken(session, sessionStore) {
  if (session.hostTokenExpiry && Date.now() < session.hostTokenExpiry - 60000) {
    return session.hostToken;
  }
  if (!session.hostRefreshToken) return session.hostToken;

  try {
    const data = await refreshAccessToken(session.hostRefreshToken);
    await sessionStore.update(session.id, {
      hostToken: data.access_token,
      hostTokenExpiry: Date.now() + data.expires_in * 1000,
      ...(data.refresh_token && { hostRefreshToken: data.refresh_token }),
    });
    return data.access_token;
  } catch {
    return session.hostToken; // fallback
  }
}
