const jwt = require('jsonwebtoken');
const config = require('../config');

const COOKIE = 'fx_token';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function issueToken(res, user) {
  const token = jwt.sign({ uid: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd && config.baseUrl.startsWith('https'),
    maxAge: MAX_AGE_MS,
  });
}

function clearToken(res) {
  res.clearCookie(COOKIE);
}

// Attaches req.user when a valid session cookie is present (never rejects).
function loadUser(db) {
  const stmt = db.prepare('SELECT id, name, email, phone, role, therapist_id FROM users WHERE id = ?');
  return (req, _res, next) => {
    const token = req.cookies?.[COOKIE];
    if (token) {
      try {
        const payload = jwt.verify(token, config.jwtSecret);
        req.user = stmt.get(payload.uid) || null;
      } catch {
        req.user = null;
      }
    }
    next();
  };
}

function requireAuth(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in to continue' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this' });
    next();
  };
}

module.exports = { issueToken, clearToken, loadUser, requireAuth };
