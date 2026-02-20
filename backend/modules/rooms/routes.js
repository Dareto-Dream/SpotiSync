const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const roomService = require('./service');
const playbackService = require('../playback/service');

// Create room
router.post('/', requireAuth, async (req, res) => {
  try {
    const room = await roomService.createRoom(req.user.sub, req.body.settings || {});
    res.status(201).json({ room: sanitizeRoom(room) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Get room by join code
router.get('/code/:code', requireAuth, async (req, res) => {
  try {
    const room = await roomService.getRoomByCode(req.params.code);
    if (!room) return res.status(404).json({ error: 'Room not found or inactive' });
    res.json({ room: sanitizeRoom(room) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get room by ID
router.get('/:roomId', requireAuth, async (req, res) => {
  try {
    const room = await roomService.getRoomById(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ room: sanitizeRoom(room) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get room members
router.get('/:roomId/members', requireAuth, async (req, res) => {
  try {
    const members = await roomService.getMembers(req.params.roomId);
    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update room settings (host only)
router.patch('/:roomId/settings', requireAuth, async (req, res) => {
  try {
    const room = await roomService.getRoomById(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.host_id !== req.user.sub) return res.status(403).json({ error: 'Only host can change settings' });

    await roomService.updateSettings(req.params.roomId, req.body);
    const updated = await roomService.getRoomById(req.params.roomId);
    res.json({ room: sanitizeRoom(updated) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Close room (host only) - also done via WS disconnect
router.delete('/:roomId', requireAuth, async (req, res) => {
  try {
    const room = await roomService.getRoomById(req.params.roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.host_id !== req.user.sub) return res.status(403).json({ error: 'Only host can close room' });

    await roomService.closeRoom(req.params.roomId);
    res.json({ message: 'Room closed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function sanitizeRoom(room) {
  return {
    id: room.id,
    joinCode: room.join_code,
    hostId: room.host_id,
    hostUsername: room.host_username,
    isActive: room.is_active,
    createdAt: room.created_at,
    settings: room.settings,
  };
}

module.exports = router;
