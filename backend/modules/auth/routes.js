const express = require('express');
const router = express.Router();
const authService = require('./service');

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await authService.register(username, password);
    res.status(201).json({ user });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await authService.login(username, password);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Verify token validity
router.get('/me', require('./middleware').requireAuth, (req, res) => {
  res.json({ user: { id: req.user.sub, username: req.user.username } });
});

module.exports = router;
