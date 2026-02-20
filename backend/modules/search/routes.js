const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const searchService = require('./service');

router.get('/', requireAuth, async (req, res) => {
  const { q, limit } = req.query;
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }
  try {
    const results = await searchService.search(q.trim(), parseInt(limit) || 20);
    res.json({ results });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/track/:videoId', requireAuth, async (req, res) => {
  try {
    const track = await searchService.getTrack(req.params.videoId);
    if (!track) return res.status(404).json({ error: 'Track not found' });
    res.json({ track });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
