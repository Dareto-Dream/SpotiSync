const { verifyToken } = require('./service');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// For WebSocket connections - verifies token sent in AUTH message
function verifyWsToken(token) {
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

module.exports = { requireAuth, verifyWsToken };
