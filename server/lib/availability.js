const { getSettings } = require('./settings');
const T = require('./time');

// Statuses that occupy a therapist's time. Pending-payment holds expire after the TTL.
function busyIntervals(db, therapistId, date, { excludeId = null, ttlMin }) {
  const rows = db.prepare(`
    SELECT id, start_time, block_end_time FROM appointments
    WHERE therapist_id = ? AND date = ?
      AND (status IN ('confirmed','completed')
           OR (status = 'pending_payment' AND created_at > datetime('now', ?)))
      AND (? IS NULL OR id != ?)
  `).all(therapistId, date, `-${ttlMin} minutes`, excludeId, excludeId);
  return rows.map((r) => [T.toMinutes(r.start_time), T.toMinutes(r.block_end_time)]);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function therapistsFor(db, treatment, therapistId = null) {
  const rows = therapistId
    ? db.prepare('SELECT * FROM therapists WHERE id = ? AND active = 1').all(therapistId)
    : db.prepare('SELECT * FROM therapists WHERE active = 1 ORDER BY id').all();
  return rows.filter((t) => canTreat(t, treatment));
}

function canTreat(therapist, treatment) {
  const specs = therapist.specializations.split(',').map((s) => s.trim().toLowerCase());
  return specs.includes(treatment.category.toLowerCase());
}

function sessionLength(treatment, mode, settings) {
  const buffer = mode === 'home' ? settings.home_visit_buffer_min : 0;
  return { duration: treatment.duration_min, blocked: treatment.duration_min + buffer };
}

/**
 * Returns the free start times (HH:MM) for one therapist on one date.
 */
function freeSlotsForTherapist(db, therapist, treatment, date, mode, opts = {}) {
  const settings = opts.settings || getSettings(db);
  const sched = db.prepare('SELECT * FROM schedules WHERE therapist_id = ? AND weekday = ?').get(therapist.id, T.weekday(date));
  if (!sched) return [];
  const blocked = db.prepare('SELECT 1 FROM blocked_dates WHERE date = ? AND (therapist_id IS NULL OR therapist_id = ?) LIMIT 1')
    .get(date, therapist.id);
  if (blocked) return [];

  const { blocked: len } = sessionLength(treatment, mode, settings);
  const dayStart = T.toMinutes(sched.start_time);
  const dayEnd = T.toMinutes(sched.end_time);
  const breaks = sched.break_start && sched.break_end ? [[T.toMinutes(sched.break_start), T.toMinutes(sched.break_end)]] : [];
  const busy = busyIntervals(db, therapist.id, date, { excludeId: opts.excludeId, ttlMin: settings.pending_payment_ttl_min });

  const now = T.nowIST(opts.now);
  const earliest = date === now.date ? now.minutes + settings.min_lead_minutes : -1;
  const step = settings.slot_interval_min;

  const slots = [];
  for (let s = dayStart; s + len <= dayEnd; s += step) {
    if (s < earliest) continue;
    // A home-visit's travel buffer may run into a break, but the treatment itself may not.
    const treatEnd = s + treatment.duration_min;
    if (breaks.some(([b1, b2]) => overlaps(s, treatEnd, b1, b2))) continue;
    if (busy.some(([b1, b2]) => overlaps(s, s + len, b1, b2))) continue;
    slots.push(T.fromMinutes(s));
  }
  return slots;
}

function validateDateWindow(date, settings, now) {
  if (!T.isValidDate(date)) return 'Invalid date';
  const today = T.nowIST(now).date;
  const diff = T.daysBetween(today, date);
  if (diff < 0) return 'Date is in the past';
  if (diff > settings.max_advance_days) return `Bookings open only ${settings.max_advance_days} days in advance`;
  return null;
}

/**
 * Aggregated slots for a date. When therapistId is null, merges all eligible therapists.
 * Returns [{ time, therapists: [id,...] }]
 */
function availableSlots(db, { treatment, date, mode, therapistId = null, excludeId = null, now }) {
  const settings = getSettings(db);
  const err = validateDateWindow(date, settings, now);
  if (err) return { error: err, slots: [] };
  const map = new Map();
  for (const th of therapistsFor(db, treatment, therapistId)) {
    for (const time of freeSlotsForTherapist(db, th, treatment, date, mode, { settings, excludeId, now })) {
      if (!map.has(time)) map.set(time, []);
      map.get(time).push(th.id);
    }
  }
  const slots = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([time, therapists]) => ({ time, therapists }));
  return { slots };
}

/**
 * Picks the therapist for a requested slot (least busy that day when "any").
 * Must be called inside a transaction together with the insert to be race-free.
 */
function pickTherapist(db, { treatment, date, time, mode, therapistId = null, excludeId = null, now }) {
  const { slots, error } = availableSlots(db, { treatment, date, mode, therapistId, excludeId, now });
  if (error) return { error };
  const slot = slots.find((s) => s.time === time);
  if (!slot) return { error: 'That time slot is no longer available. Please choose another.' };
  if (slot.therapists.length === 1) return { therapistId: slot.therapists[0] };
  const load = db.prepare(`SELECT COUNT(*) c FROM appointments WHERE therapist_id = ? AND date = ? AND status IN ('confirmed','pending_payment')`);
  const best = slot.therapists
    .map((id) => ({ id, c: load.get(id, date).c }))
    .sort((a, b) => a.c - b.c || a.id - b.id)[0];
  return { therapistId: best.id };
}

module.exports = { availableSlots, pickTherapist, canTreat, sessionLength, validateDateWindow };
