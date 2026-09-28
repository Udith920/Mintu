const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { issueToken, clearToken, requireAuth } = require('../lib/auth');
const { normalizePhone } = require('../lib/format');
const { getSettings } = require('../lib/settings');
const B = require('../lib/bookings');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = function authRoutes(db) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, therapist_id: u.therapist_id });

  r.post('/register', limiter, (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = normalizePhone(req.body?.phone);
    const password = String(req.body?.password || '');
    if (name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email' });
    if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }
    const id = db.prepare("INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'patient')")
      .run(name, email, phone, bcrypt.hashSync(password, 10)).lastInsertRowid;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    issueToken(res, user);
    res.status(201).json(publicUser(user));
  });

  r.post('/login', limiter, (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(String(req.body?.password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }
    issueToken(res, user);
    res.json(publicUser(user));
  });

  r.post('/logout', (_req, res) => {
    clearToken(res);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    res.json(req.user ? publicUser(req.user) : null);
  });

  r.post('/change-password', requireAuth(), limiter, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(String(req.body?.current_password || ''), user.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const next = String(req.body?.new_password || '');
    if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), user.id);
    res.json({ ok: true });
  });

  r.get('/my-bookings', requireAuth(), (req, res) => {
    const settings = getSettings(db);
    res.json(B.listForUser(db, req.user).map((a) => B.publicView(a, settings)));
  });

  r.get('/my-packages', requireAuth(), (req, res) => {
    res.json(db.prepare(`SELECT pp.code, pp.package_name, pp.treatment_id, t.name AS treatment_name, pp.sessions_total, pp.sessions_used,
      pp.status, pp.expires_on, pp.phone FROM package_purchases pp JOIN treatments t ON t.id = pp.treatment_id
      WHERE (pp.user_id = ? OR lower(pp.email) = lower(?)) AND pp.status != 'void' ORDER BY pp.id DESC`).all(req.user.id, req.user.email));
  });

  return r;
};
