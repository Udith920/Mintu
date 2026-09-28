const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth } = require('../lib/auth');
const { getSettings, updateSettings } = require('../lib/settings');
const B = require('../lib/bookings');
const T = require('../lib/time');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const text = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const int = (v, { min = 0, max = 1e9, name = 'value' } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}`);
  return Math.round(n);
};

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = function adminRoutes(db) {
  const r = express.Router();
  const staff = requireAuth('admin', 'therapist');
  const adminOnly = requireAuth('admin');
  r.use(staff);

  // Therapists only ever see their own appointments.
  function scope(req) {
    return req.user.role === 'therapist' ? req.user.therapist_id ?? -1 : null;
  }

  function loadAppt(req) {
    const a = B.getById(db, Number(req.params.id));
    if (!a) throw new HttpError(404, 'Appointment not found');
    const s = scope(req);
    if (s !== null && a.therapist_id !== s) throw new HttpError(403, 'Not your appointment');
    return a;
  }

  // ---------- Dashboard ----------
  r.get('/stats', (req, res) => {
    const s = scope(req);
    const today = T.nowIST().date;
    const f = s === null ? '' : ' AND therapist_id = ' + Number(s);

    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const todayRows = db.prepare(`SELECT a.id, a.ref, a.patient_name, a.phone, a.start_time, a.end_time, a.status, a.mode,
      a.payment_status, a.total, t.name treatment_name, th.name therapist_name
      FROM appointments a JOIN treatments t ON t.id = a.treatment_id JOIN therapists th ON th.id = a.therapist_id
      WHERE a.date = ? AND a.status IN ('confirmed','completed','no_show','pending_payment')${f.replace('therapist_id', 'a.therapist_id')}
      ORDER BY a.start_time`).all(today);

    const month = one(`SELECT COUNT(*) total,
        SUM(status = 'cancelled') cancelled, SUM(status = 'no_show') no_show, SUM(status = 'completed') completed,
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN amount_paid END), 0) revenue,
        COALESCE(SUM(CASE WHEN status IN ('confirmed') AND payment_status = 'unpaid' THEN total END), 0) receivable
      FROM appointments WHERE substr(date, 1, 7) = ? AND status != 'pending_payment'${f}`, today.slice(0, 7));

    const upcoming = one(`SELECT COUNT(*) c FROM appointments WHERE status = 'confirmed' AND date > ? AND date <= ?${f}`, today, T.addDays(today, 7)).c;
    const refunds = one(`SELECT COUNT(*) c, COALESCE(SUM(amount_paid),0) amt FROM appointments WHERE payment_status = 'refund_pending'${f}`);
    const patients = one(`SELECT COUNT(DISTINCT phone) c FROM appointments WHERE status != 'pending_payment'${f}`).c;

    const from = T.addDays(today, -29);
    const byDay = new Map(db.prepare(`SELECT date, COALESCE(SUM(amount_paid),0) revenue, COUNT(*) bookings FROM appointments
      WHERE date BETWEEN ? AND ? AND status IN ('confirmed','completed','no_show')${f} GROUP BY date`).all(from, today)
      .map((row) => [row.date, row]));
    const series = [];
    for (let i = 0; i < 30; i++) {
      const d = T.addDays(from, i);
      series.push({ date: d, revenue: byDay.get(d)?.revenue || 0, bookings: byDay.get(d)?.bookings || 0 });
    }

    const topTreatments = db.prepare(`SELECT t.name, t.icon, COUNT(*) bookings, COALESCE(SUM(a.amount_paid),0) revenue
      FROM appointments a JOIN treatments t ON t.id = a.treatment_id
      WHERE substr(a.date, 1, 7) = ? AND a.status IN ('confirmed','completed','no_show')${f.replace('therapist_id', 'a.therapist_id')}
      GROUP BY t.id ORDER BY bookings DESC LIMIT 5`).all(today.slice(0, 7));

    const byMode = db.prepare(`SELECT mode, COUNT(*) c FROM appointments WHERE substr(date, 1, 7) = ? AND status IN ('confirmed','completed','no_show')${f}
      GROUP BY mode`).all(today.slice(0, 7));

    res.json({
      today, todayAppointments: todayRows, upcoming, month, refunds, patients, series, topTreatments, byMode,
    });
  });

  // ---------- Appointments ----------
  function listAppointments(req) {
    const where = ['1=1'];
    const p = [];
    const q = req.query;
    if (T.isValidDate(q.from)) { where.push('a.date >= ?'); p.push(q.from); }
    if (T.isValidDate(q.to)) { where.push('a.date <= ?'); p.push(q.to); }
    if (q.status) { where.push('a.status = ?'); p.push(String(q.status)); }
    if (q.payment_status) { where.push('a.payment_status = ?'); p.push(String(q.payment_status)); }
    if (q.mode) { where.push('a.mode = ?'); p.push(String(q.mode)); }
    const s = scope(req);
    if (s !== null) { where.push('a.therapist_id = ?'); p.push(s); } else if (q.therapist_id) { where.push('a.therapist_id = ?'); p.push(Number(q.therapist_id)); }
    if (q.q) {
      where.push('(a.patient_name LIKE ? OR a.phone LIKE ? OR a.ref LIKE ? OR a.email LIKE ?)');
      const like = `%${String(q.q).trim()}%`;
      p.push(like, like, like, like);
    }
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    return db.prepare(`SELECT a.*, t.name treatment_name, t.icon treatment_icon, th.name therapist_name, pp.code package_code
      FROM appointments a JOIN treatments t ON t.id = a.treatment_id JOIN therapists th ON th.id = a.therapist_id
      LEFT JOIN package_purchases pp ON pp.id = a.package_purchase_id
      WHERE ${where.join(' AND ')} ORDER BY a.date ${order}, a.start_time ${order} LIMIT 1000`).all(...p);
  }

  r.get('/appointments', (req, res) => res.json(listAppointments(req)));

  r.get('/appointments.csv', (req, res) => {
    const rows = listAppointments(req);
    const cols = ['ref', 'date', 'start_time', 'end_time', 'patient_name', 'phone', 'email', 'age', 'gender', 'treatment_name',
      'therapist_name', 'mode', 'address', 'status', 'payment_method', 'payment_status', 'subtotal', 'package_discount',
      'coupon_code', 'coupon_discount', 'surcharge', 'tax', 'total', 'amount_paid', 'package_code', 'pain_area', 'pain_level', 'created_at'];
    const csv = [cols.join(','), ...rows.map((row) => cols.map((c) => csvCell(row[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="flexura-appointments-${T.nowIST().date}.csv"`);
    res.send(`﻿${csv}`);
  });

  r.get('/appointments/:id', (req, res) => res.json(loadAppt(req)));

  r.patch('/appointments/:id', (req, res) => {
    let a = loadAppt(req);
    const body = req.body || {};
    const isAdmin = req.user.role === 'admin';

    if (body.status && body.status !== a.status) {
      if (body.status === 'cancelled') {
        a = B.cancel(db, a, { by: req.user.role, reason: body.cancel_reason || 'Cancelled by clinic', force: true });
      } else if (['completed', 'no_show', 'confirmed'].includes(body.status)) {
        if (!['confirmed', 'completed', 'no_show'].includes(a.status)) throw new HttpError(400, `Cannot change a ${a.status} appointment to ${body.status}`);
        db.prepare("UPDATE appointments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(body.status, a.id);
      } else {
        throw new HttpError(400, 'Invalid status');
      }
    }

    if (isAdmin && body.payment_status) {
      if (!['unpaid', 'paid', 'refund_pending', 'refunded'].includes(body.payment_status)) throw new HttpError(400, 'Invalid payment status');
      const amount = body.amount_paid !== undefined ? int(body.amount_paid, { name: 'Amount paid' })
        : body.payment_status === 'paid' ? a.total : a.amount_paid;
      db.prepare("UPDATE appointments SET payment_status = ?, amount_paid = ?, updated_at = datetime('now') WHERE id = ?")
        .run(body.payment_status, body.payment_status === 'unpaid' ? 0 : amount, a.id);
    }

    if (body.admin_notes !== undefined) {
      db.prepare("UPDATE appointments SET admin_notes = ?, updated_at = datetime('now') WHERE id = ?").run(text(body.admin_notes, 2000), a.id);
    }
    res.json(B.getById(db, a.id));
  });

  r.post('/appointments/:id/reschedule', (req, res) => {
    const a = loadAppt(req);
    const tid = req.body?.therapist_id;
    const out = B.reschedule(db, a, {
      date: req.body?.date, time: req.body?.time,
      therapistId: req.user.role === 'therapist' ? a.therapist_id : tid && tid !== 'any' ? Number(tid) : null,
      isStaff: true,
    });
    res.json(out);
  });

  // ---------- Calendar (day view) ----------
  r.get('/calendar', (req, res) => {
    const date = T.isValidDate(req.query.date) ? req.query.date : T.nowIST().date;
    const s = scope(req);
    const therapists = db.prepare(`SELECT id, name FROM therapists WHERE active = 1 ${s !== null ? 'AND id = ' + Number(s) : ''} ORDER BY id`).all();
    const wd = T.weekday(date);
    const blocked = db.prepare('SELECT therapist_id, reason FROM blocked_dates WHERE date = ?').all(date);
    const cols = therapists.map((th) => {
      const sched = db.prepare('SELECT * FROM schedules WHERE therapist_id = ? AND weekday = ?').get(th.id, wd) || null;
      const block = blocked.find((b) => b.therapist_id === null || b.therapist_id === th.id);
      const appts = db.prepare(`SELECT a.id, a.ref, a.patient_name, a.phone, a.start_time, a.end_time, a.block_end_time, a.status, a.mode,
        a.payment_status, t.name treatment_name, t.icon FROM appointments a JOIN treatments t ON t.id = a.treatment_id
        WHERE a.therapist_id = ? AND a.date = ? AND a.status IN ('confirmed','completed','no_show','pending_payment') ORDER BY a.start_time`)
        .all(th.id, date);
      return { therapist: th, schedule: sched, blocked: block ? block.reason || 'Unavailable' : null, appointments: appts };
    });
    res.json({ date, columns: cols });
  });

  // ---------- Treatments ----------
  function treatmentBody(b) {
    const modes = (Array.isArray(b.modes) ? b.modes : String(b.modes || '').split(','))
      .map((m) => m.trim()).filter((m) => ['clinic', 'home', 'online'].includes(m));
    if (!modes.length) throw new HttpError(400, 'Select at least one visit type');
    const name = text(b.name, 120);
    if (name.length < 2) throw new HttpError(400, 'Treatment name is required');
    const category = text(b.category, 60);
    if (!category) throw new HttpError(400, 'Category is required');
    return {
      name, category,
      slug: text(b.slug, 80) || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      description: text(b.description, 1000),
      duration_min: int(b.duration_min, { min: 10, max: 240, name: 'Duration' }),
      price: int(b.price, { min: 0, max: 1000000, name: 'Price' }),
      modes: [...new Set(modes)].join(','),
      icon: text(b.icon, 8) || '🩺',
      popular: bool(b.popular),
      active: b.active === undefined ? 1 : bool(b.active),
      sort_order: b.sort_order === undefined ? 0 : int(b.sort_order, { max: 10000, name: 'Sort order' }),
    };
  }

  r.get('/treatments', (_req, res) => res.json(db.prepare('SELECT * FROM treatments ORDER BY sort_order, id').all()));

  r.post('/treatments', adminOnly, (req, res) => {
    const t = treatmentBody(req.body || {});
    try {
      const id = db.prepare(`INSERT INTO treatments (slug, name, category, description, duration_min, price, modes, icon, popular, active, sort_order)
        VALUES (@slug, @name, @category, @description, @duration_min, @price, @modes, @icon, @popular, @active, @sort_order)`).run(t).lastInsertRowid;
      res.status(201).json(db.prepare('SELECT * FROM treatments WHERE id = ?').get(id));
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'A treatment with this slug already exists');
      throw err;
    }
  });

  r.put('/treatments/:id', adminOnly, (req, res) => {
    const t = treatmentBody(req.body || {});
    const info = db.prepare(`UPDATE treatments SET slug=@slug, name=@name, category=@category, description=@description,
      duration_min=@duration_min, price=@price, modes=@modes, icon=@icon, popular=@popular, active=@active, sort_order=@sort_order
      WHERE id=@id`).run({ ...t, id: Number(req.params.id) });
    if (!info.changes) throw new HttpError(404, 'Treatment not found');
    res.json(db.prepare('SELECT * FROM treatments WHERE id = ?').get(Number(req.params.id)));
  });

  r.delete('/treatments/:id', adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const used = db.prepare('SELECT COUNT(*) c FROM appointments WHERE treatment_id = ?').get(id).c;
    if (used) db.prepare('UPDATE treatments SET active = 0 WHERE id = ?').run(id);
    else db.prepare('DELETE FROM treatments WHERE id = ?').run(id);
    res.json({ ok: true, archived: Boolean(used) });
  });

  // ---------- Therapists & schedules ----------
  const withSchedule = (th) => ({
    ...th, schedule: db.prepare('SELECT weekday, start_time, end_time, break_start, break_end FROM schedules WHERE therapist_id = ? ORDER BY weekday').all(th.id),
  });

  function therapistBody(b) {
    const name = text(b.name, 80);
    if (name.length < 2) throw new HttpError(400, 'Therapist name is required');
    return {
      name,
      title: text(b.title, 120) || 'Physiotherapist',
      qualifications: text(b.qualifications, 200),
      specializations: (Array.isArray(b.specializations) ? b.specializations : String(b.specializations || '').split(','))
        .map((s) => String(s).trim()).filter(Boolean).join(','),
      experience_years: int(b.experience_years ?? 0, { max: 70, name: 'Experience' }),
      languages: text(b.languages, 200),
      gender: ['male', 'female', 'other'].includes(b.gender) ? b.gender : '',
      bio: text(b.bio, 1000),
      rating: Math.min(5, Math.max(0, Number(b.rating) || 4.8)),
      active: b.active === undefined ? 1 : bool(b.active),
    };
  }

  function saveSchedule(therapistId, schedule) {
    if (!Array.isArray(schedule)) return;
    const ins = db.prepare('INSERT INTO schedules (therapist_id, weekday, start_time, end_time, break_start, break_end) VALUES (?, ?, ?, ?, ?, ?)');
    db.prepare('DELETE FROM schedules WHERE therapist_id = ?').run(therapistId);
    for (const d of schedule) {
      const wd = int(d.weekday, { max: 6, name: 'Weekday' });
      if (!T.isValidTime(d.start_time) || !T.isValidTime(d.end_time) || d.start_time >= d.end_time) {
        throw new HttpError(400, 'Each working day needs a valid start and end time');
      }
      const hasBreak = T.isValidTime(d.break_start) && T.isValidTime(d.break_end);
      if (hasBreak && (d.break_start >= d.break_end || d.break_start < d.start_time || d.break_end > d.end_time)) {
        throw new HttpError(400, 'Break must fall within working hours');
      }
      ins.run(therapistId, wd, d.start_time, d.end_time, hasBreak ? d.break_start : null, hasBreak ? d.break_end : null);
    }
  }

  r.get('/therapists', (_req, res) => res.json(db.prepare('SELECT * FROM therapists ORDER BY id').all().map(withSchedule)));

  r.post('/therapists', adminOnly, (req, res) => {
    const t = therapistBody(req.body || {});
    const id = db.transaction(() => {
      const newId = db.prepare(`INSERT INTO therapists (name, title, qualifications, specializations, experience_years, languages, gender, bio, rating, active)
        VALUES (@name, @title, @qualifications, @specializations, @experience_years, @languages, @gender, @bio, @rating, @active)`).run(t).lastInsertRowid;
      saveSchedule(newId, req.body.schedule);
      return newId;
    })();
    res.status(201).json(withSchedule(db.prepare('SELECT * FROM therapists WHERE id = ?').get(id)));
  });

  r.put('/therapists/:id', adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const t = therapistBody(req.body || {});
    db.transaction(() => {
      const info = db.prepare(`UPDATE therapists SET name=@name, title=@title, qualifications=@qualifications, specializations=@specializations,
        experience_years=@experience_years, languages=@languages, gender=@gender, bio=@bio, rating=@rating, active=@active WHERE id=@id`).run({ ...t, id });
      if (!info.changes) throw new HttpError(404, 'Therapist not found');
      saveSchedule(id, req.body.schedule);
    })();
    res.json(withSchedule(db.prepare('SELECT * FROM therapists WHERE id = ?').get(id)));
  });

  r.delete('/therapists/:id', adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const upcoming = db.prepare("SELECT COUNT(*) c FROM appointments WHERE therapist_id = ? AND status = 'confirmed' AND date >= ?").get(id, T.nowIST().date).c;
    if (upcoming) throw new HttpError(409, `This therapist has ${upcoming} upcoming appointment(s). Reassign or cancel them first.`);
    db.prepare('UPDATE therapists SET active = 0 WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // ---------- Holidays & leave ----------
  r.get('/blocked-dates', (_req, res) => {
    res.json(db.prepare(`SELECT b.*, th.name therapist_name FROM blocked_dates b LEFT JOIN therapists th ON th.id = b.therapist_id
      WHERE b.date >= ? ORDER BY b.date`).all(T.addDays(T.nowIST().date, -30)));
  });

  r.post('/blocked-dates', adminOnly, (req, res) => {
    const { date, therapist_id: tid, reason } = req.body || {};
    if (!T.isValidDate(date)) throw new HttpError(400, 'Please choose a valid date');
    const therapistId = tid ? Number(tid) : null;
    const clash = db.prepare(`SELECT COUNT(*) c FROM appointments WHERE date = ? AND status = 'confirmed' ${therapistId ? 'AND therapist_id = ?' : ''}`)
      .get(...(therapistId ? [date, therapistId] : [date])).c;
    const id = db.prepare('INSERT INTO blocked_dates (therapist_id, date, reason) VALUES (?, ?, ?)').run(therapistId, date, text(reason, 200)).lastInsertRowid;
    res.status(201).json({ id, warning: clash ? `${clash} confirmed appointment(s) already exist on this date – please reschedule them.` : null });
  });

  r.delete('/blocked-dates/:id', adminOnly, (req, res) => {
    db.prepare('DELETE FROM blocked_dates WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- Coupons ----------
  function couponBody(b) {
    const type = b.type === 'flat' ? 'flat' : 'percent';
    const value = Number(b.value);
    if (!(value > 0) || (type === 'percent' && value > 100)) throw new HttpError(400, 'Enter a valid discount value');
    return {
      description: text(b.description, 200), type, value,
      min_amount: int(b.min_amount ?? 0, { name: 'Minimum amount' }),
      max_discount: b.max_discount === '' || b.max_discount == null ? null : int(b.max_discount, { name: 'Max discount' }),
      max_uses: b.max_uses === '' || b.max_uses == null ? null : int(b.max_uses, { name: 'Max uses' }),
      valid_until: T.isValidDate(b.valid_until) ? b.valid_until : null,
      active: b.active === undefined ? 1 : bool(b.active),
    };
  }

  r.get('/coupons', adminOnly, (_req, res) => res.json(db.prepare('SELECT * FROM coupons ORDER BY code').all()));

  r.post('/coupons', adminOnly, (req, res) => {
    const code = text(req.body?.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (code.length < 3) throw new HttpError(400, 'Coupon code must be at least 3 characters');
    try {
      db.prepare(`INSERT INTO coupons (code, description, type, value, min_amount, max_discount, max_uses, valid_until, active)
        VALUES (@code, @description, @type, @value, @min_amount, @max_discount, @max_uses, @valid_until, @active)`).run({ code, ...couponBody(req.body) });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') throw new HttpError(409, 'Coupon code already exists');
      throw err;
    }
    res.status(201).json(db.prepare('SELECT * FROM coupons WHERE code = ?').get(code));
  });

  r.put('/coupons/:code', adminOnly, (req, res) => {
    const info = db.prepare(`UPDATE coupons SET description=@description, type=@type, value=@value, min_amount=@min_amount,
      max_discount=@max_discount, max_uses=@max_uses, valid_until=@valid_until, active=@active WHERE code=@code`)
      .run({ code: req.params.code, ...couponBody(req.body || {}) });
    if (!info.changes) throw new HttpError(404, 'Coupon not found');
    res.json(db.prepare('SELECT * FROM coupons WHERE code = ?').get(req.params.code));
  });

  r.delete('/coupons/:code', adminOnly, (req, res) => {
    db.prepare('DELETE FROM coupons WHERE code = ?').run(req.params.code);
    res.json({ ok: true });
  });

  // ---------- Packages ----------
  function packageBody(b) {
    const name = text(b.name, 100);
    if (name.length < 2) throw new HttpError(400, 'Package name is required');
    return {
      name,
      sessions: int(b.sessions, { min: 2, max: 100, name: 'Sessions' }),
      discount_percent: Number(b.discount_percent) >= 0 && Number(b.discount_percent) < 100 ? Number(b.discount_percent) : 0,
      validity_days: int(b.validity_days ?? 90, { min: 7, max: 730, name: 'Validity' }),
      active: b.active === undefined ? 1 : bool(b.active),
    };
  }

  r.get('/packages', adminOnly, (_req, res) => res.json(db.prepare('SELECT * FROM packages ORDER BY sessions').all()));
  r.post('/packages', adminOnly, (req, res) => {
    const id = db.prepare(`INSERT INTO packages (name, sessions, discount_percent, validity_days, active)
      VALUES (@name, @sessions, @discount_percent, @validity_days, @active)`).run(packageBody(req.body || {})).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM packages WHERE id = ?').get(id));
  });
  r.put('/packages/:id', adminOnly, (req, res) => {
    const info = db.prepare(`UPDATE packages SET name=@name, sessions=@sessions, discount_percent=@discount_percent,
      validity_days=@validity_days, active=@active WHERE id=@id`).run({ ...packageBody(req.body || {}), id: Number(req.params.id) });
    if (!info.changes) throw new HttpError(404, 'Package not found');
    res.json(db.prepare('SELECT * FROM packages WHERE id = ?').get(Number(req.params.id)));
  });
  r.delete('/packages/:id', adminOnly, (req, res) => {
    db.prepare('UPDATE packages SET active = 0 WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });

  r.get('/package-purchases', adminOnly, (_req, res) => {
    res.json(db.prepare(`SELECT pp.*, t.name treatment_name FROM package_purchases pp JOIN treatments t ON t.id = pp.treatment_id
      WHERE pp.status != 'void' ORDER BY pp.id DESC LIMIT 500`).all());
  });

  // ---------- Settings ----------
  r.get('/settings', adminOnly, (_req, res) => res.json(getSettings(db)));
  r.put('/settings', adminOnly, (req, res) => {
    const errors = updateSettings(db, req.body);
    if (errors.length) throw new HttpError(400, errors.join('; '));
    res.json(getSettings(db));
  });

  // ---------- Staff accounts ----------
  r.get('/staff', adminOnly, (_req, res) => {
    res.json(db.prepare(`SELECT u.id, u.name, u.email, u.role, u.therapist_id, th.name therapist_name, u.created_at
      FROM users u LEFT JOIN therapists th ON th.id = u.therapist_id WHERE u.role IN ('admin','therapist') ORDER BY u.id`).all());
  });

  r.post('/staff', adminOnly, (req, res) => {
    const b = req.body || {};
    const role = b.role === 'admin' ? 'admin' : 'therapist';
    const email = text(b.email, 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Valid email required');
    if (String(b.password || '').length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    const therapistId = role === 'therapist' ? Number(b.therapist_id) : null;
    if (role === 'therapist' && !db.prepare('SELECT 1 FROM therapists WHERE id = ?').get(therapistId)) throw new HttpError(400, 'Choose a therapist');
    try {
      const id = db.prepare('INSERT INTO users (name, email, password_hash, role, therapist_id) VALUES (?, ?, ?, ?, ?)')
        .run(text(b.name, 80) || email, email, bcrypt.hashSync(String(b.password), 10), role, therapistId).lastInsertRowid;
      res.status(201).json({ id });
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'A user with this email already exists');
      throw err;
    }
  });

  r.delete('/staff/:id', adminOnly, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'You cannot delete your own account');
    db.prepare("DELETE FROM users WHERE id = ? AND role IN ('admin','therapist')").run(id);
    res.json({ ok: true });
  });

  return r;
};

module.exports.HttpError = HttpError;
