const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { getSettings, publicSettings } = require('../lib/settings');
const { canTreat, validateDateWindow } = require('../lib/availability');
const B = require('../lib/bookings');
const razorpay = require('../lib/razorpay');
const { buildIcs } = require('../lib/ics');
const { normalizePhone } = require('../lib/format');
const T = require('../lib/time');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = function publicRoutes(db) {
  const r = express.Router();

  const bookingLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false });

  r.get('/config', (_req, res) => {
    const s = getSettings(db);
    const online = razorpay.isEnabled() ? 'razorpay' : config.paymentDemo ? 'demo' : null;
    res.json({
      settings: publicSettings(s),
      payments: { online, razorpay_key_id: online === 'razorpay' ? config.razorpay.keyId : null, pay_at_clinic: s.allow_pay_at_clinic },
      today: T.nowIST().date,
    });
  });

  r.get('/treatments', (_req, res) => {
    const rows = db.prepare('SELECT id, slug, name, category, description, duration_min, price, modes, icon, popular FROM treatments WHERE active = 1 ORDER BY sort_order, id').all();
    res.json(rows.map((t) => ({ ...t, modes: t.modes.split(',') })));
  });

  r.get('/therapists', (req, res) => {
    let rows = db.prepare('SELECT id, name, title, qualifications, specializations, experience_years, languages, gender, bio, rating FROM therapists WHERE active = 1 ORDER BY id').all();
    if (req.query.treatment_id) {
      const t = db.prepare('SELECT * FROM treatments WHERE id = ?').get(Number(req.query.treatment_id));
      rows = t ? rows.filter((th) => canTreat(th, t)) : [];
    }
    res.json(rows.map((th) => ({ ...th, specializations: th.specializations.split(',').map((s) => s.trim()).filter(Boolean) })));
  });

  r.get('/packages', (_req, res) => {
    res.json(db.prepare('SELECT id, name, sessions, discount_percent, validity_days FROM packages WHERE active = 1 ORDER BY sessions').all());
  });

  function slotQuery(req) {
    const treatment = db.prepare('SELECT * FROM treatments WHERE id = ? AND active = 1').get(Number(req.query.treatment_id));
    if (!treatment) throw new B.BookingError('Unknown treatment');
    const mode = ['clinic', 'home', 'online'].includes(req.query.mode) ? req.query.mode : 'clinic';
    const therapistId = req.query.therapist_id && req.query.therapist_id !== 'any' ? Number(req.query.therapist_id) : null;
    let excludeId = null;
    if (req.query.exclude_ref) excludeId = B.getByRef(db, req.query.exclude_ref)?.id ?? null;
    return { treatment, mode, therapistId, excludeId };
  }

  r.get('/availability', (req, res) => {
    const q = slotQuery(req);
    const out = B.availableSlots(db, { ...q, date: String(req.query.date || '') });
    if (out.error) return res.status(400).json({ error: out.error, slots: [] });
    res.json({ date: req.query.date, slots: out.slots.map((s) => ({ time: s.time, therapists: s.therapists.length })) });
  });

  // Slot counts for a range of days – powers the availability calendar.
  r.get('/availability/days', (req, res) => {
    const q = slotQuery(req);
    const settings = getSettings(db);
    const today = T.nowIST().date;
    const from = T.isValidDate(req.query.from) && req.query.from >= today ? req.query.from : today;
    const n = Math.min(Math.max(Number(req.query.days) || 14, 1), 42);
    const days = [];
    for (let i = 0; i < n; i++) {
      const date = T.addDays(from, i);
      if (validateDateWindow(date, settings)) break;
      days.push({ date, slots: B.availableSlots(db, { ...q, date }).slots.length });
    }
    res.json({ days });
  });

  r.post('/quote', (req, res) => {
    const { price } = B.quote(db, req.body || {});
    res.json(price);
  });

  r.post('/bookings', bookingLimiter, wrap(async (req, res) => {
    const out = await B.createBooking(db, req.body || {}, req.user || null);
    res.status(201).json({ appointment: B.publicView(out.appointment, getSettings(db)), payment: out.payment });
  }));

  function loadOwned(req) {
    const a = B.getByRef(db, req.params.ref);
    const phone = normalizePhone(req.body?.phone ?? req.query.phone);
    const u = req.user;
    const ok = a && (
      (u && (u.role === 'admin' || a.user_id === u.id || a.email.toLowerCase() === u.email.toLowerCase()))
      || (phone && phone === a.phone)
    );
    if (!ok) throw new B.BookingError('Booking not found. Check the reference and mobile number.', 404);
    return a;
  }

  r.get('/bookings/:ref', lookupLimiter, (req, res) => {
    res.json(B.publicView(loadOwned(req), getSettings(db)));
  });

  r.get('/bookings/:ref/ics', lookupLimiter, (req, res) => {
    const a = loadOwned(req);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${a.ref}.ics"`);
    res.send(buildIcs(a, getSettings(db)));
  });

  r.post('/bookings/:ref/cancel', lookupLimiter, (req, res) => {
    const a = loadOwned(req);
    const out = B.cancel(db, a, { by: req.user?.role === 'admin' ? 'admin' : 'patient', reason: req.body?.reason, force: req.user?.role === 'admin' });
    res.json(B.publicView(out, getSettings(db)));
  });

  r.post('/bookings/:ref/reschedule', lookupLimiter, (req, res) => {
    const a = loadOwned(req);
    const tid = req.body?.therapist_id;
    const out = B.reschedule(db, a, {
      date: req.body?.date, time: req.body?.time,
      therapistId: tid && tid !== 'any' ? Number(tid) : null,
      isStaff: req.user?.role === 'admin',
    });
    res.json(B.publicView(out, getSettings(db)));
  });

  r.post('/bookings/:ref/verify-payment', lookupLimiter, (req, res) => {
    const a = B.getByRef(db, req.params.ref);
    if (!a) throw new B.BookingError('Booking not found', 404);
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (!razorpay.isEnabled() || !orderId || orderId !== a.razorpay_order_id
      || !razorpay.verifyPaymentSignature({ orderId, paymentId, signature })) {
      throw new B.BookingError('Payment verification failed. If money was debited, please contact the clinic.', 400);
    }
    const out = B.markPaid(db, a, { paymentId, method: 'online' });
    res.json({ result: out.result, appointment: B.publicView(out.appointment, getSettings(db)) });
  });

  // Simulated gateway for demos/testing – only when PAYMENT_DEMO=true and no real gateway is configured.
  r.post('/bookings/:ref/demo-pay', lookupLimiter, (req, res) => {
    if (!config.paymentDemo || razorpay.isEnabled()) throw new B.BookingError('Demo payments are disabled', 403);
    const a = loadOwned(req);
    if (a.payment_method !== 'demo') throw new B.BookingError('This booking does not use demo payment');
    const out = B.markPaid(db, a, { paymentId: `demo_${Date.now()}`, method: 'demo' });
    res.json({ result: out.result, appointment: B.publicView(out.appointment, getSettings(db)) });
  });

  r.get('/package-credits/:code', lookupLimiter, (req, res) => {
    const pp = db.prepare(`SELECT pp.*, t.name AS treatment_name FROM package_purchases pp JOIN treatments t ON t.id = pp.treatment_id
      WHERE pp.code = ?`).get(String(req.params.code).trim().toUpperCase());
    if (!pp || normalizePhone(req.query.phone) !== normalizePhone(pp.phone)) throw new B.BookingError('Package not found', 404);
    res.json({
      code: pp.code, package_name: pp.package_name, treatment_id: pp.treatment_id, treatment_name: pp.treatment_name,
      sessions_total: pp.sessions_total, sessions_used: pp.sessions_used, remaining: pp.sessions_total - pp.sessions_used,
      status: pp.status, expires_on: pp.expires_on, patient_name: pp.patient_name, email: pp.email, phone: pp.phone,
    });
  });

  return r;
};

module.exports.wrap = wrap;
