const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('jam_token');
}

function clearAuth() {
  localStorage.removeItem('jam_token');
  localStorage.removeItem('jam_user');
}

async function refreshAccessToken() {
  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Unable to refresh session');
  const data = await res.json();
  if (data.token) {
    localStorage.setItem('jam_token', data.token);
    if (data.user) localStorage.setItem('jam_user', JSON.stringify(data.user));
  }
  return data;
}

async function request(method, path, body, retry = true) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    try {
      await refreshAccessToken();
      return request(method, path, body, false);
    } catch {
      clearAuth();
      window.location.href = '/login';
      return;
    }
  }

  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
  refresh: refreshAccessToken,
  clearAuth,
};
