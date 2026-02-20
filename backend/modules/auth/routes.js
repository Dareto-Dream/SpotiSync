const express = require('express');
const router = express.Router();
const authService = require('./service');

const isProd = process.env.NODE_ENV === 'production';
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'refresh_token';
const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10);
const sameSite = process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax');
const refreshCookieOptions = {
  httpOnly: true,
  secure: sameSite === 'none' ? true : isProd, // browsers require Secure when SameSite=None
  sameSite,
  maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  path: '/',
  domain: process.env.COOKIE_DOMAIN || undefined,
};

function sendAuthResponse(res, tokens) {
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions);
  res.json({ token: tokens.accessToken, user: tokens.user });
}

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    await authService.register(username, password);
    const tokens = await authService.login(username, password);
    res.status(201);
    sendAuthResponse(res, tokens);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const tokens = await authService.login(username, password);
    sendAuthResponse(res, tokens);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    const tokens = await authService.loginWithGoogle(idToken);
    sendAuthResponse(res, tokens);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = req.cookies[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    const tokens = await authService.refreshSession(refreshToken);
    sendAuthResponse(res, tokens);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const refreshToken = req.cookies[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    await authService.revokeRefreshToken(refreshToken);
    res.clearCookie(REFRESH_COOKIE_NAME, {
      ...refreshCookieOptions,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Verify token validity
router.get('/me', require('./middleware').requireAuth, (req, res) => {
  res.json({ user: { id: req.user.sub, username: req.user.username } });
});

module.exports = router;
