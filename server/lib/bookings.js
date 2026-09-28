const { getSettings } = require('./settings');
const { pickTherapist, sessionLength, availableSlots } = require('./availability');
const { computePrice, PricingError } = require('./pricing');
const { randomCode, normalizePhone } = require('./format');
const razorpay = require('./razorpay');
const mailer = require('./mailer');
const config = require('../config');
const T = require('./time');

class BookingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[6-9]\d{9}$/;

const DETAIL_SQL = `
  SELECT a.*, t.name AS treatment_name, t.category AS treatment_category, t.icon AS treatment_icon, t.duration_min,
         th.name AS therapist_name, th.title AS therapist_title,
         pp.code AS package_code, pp.package_name, pp.sessions_total AS package_sessions_total,
         pp.sessions_used AS package_sessions_used, pp.expires_on AS package_expires_on, pp.status AS package_status
  FROM appointments a
  JOIN treatments t ON t.id = a.treatment_id
  JOIN therapists th ON th.id = a.therapist_id
  LEFT JOIN package_purchases pp ON pp.id = a.package_purchase_id`;

function getById(db, id) {
  return db.prepare(`${DETAIL_SQL} WHERE a.id = ?`).get(id);
}

function getByRef(db, ref) {
  return db.prepare(`${DETAIL_SQL} WHERE a.ref = ?`).get(String(ref || '').trim().toUpperCase());
}

function listForUser(db, user) {
  return db.prepare(`${DETAIL_SQL} WHERE a.user_id = ? OR lower(a.email) = lower(?) ORDER BY a.date DESC, a.start_time DESC`)
    .all(user.id, user.email);
}

// Strips internal fields before sending an appointment to a patient.
function publicView(a, settings = null) {
  if (!a) return null;
  const { razorpay_order_id: _o, admin_notes: _n, user_id: _u, reminder_sent: _r, ...rest } = a;
  if (settings) {
    const mins = T.minutesUntil(a.date, a.start_time);
    const inWindow = mins >= settings.cancel_window_hours * 60;
    rest.can_cancel = ['confirmed', 'pending_payment'].includes(a.status) && inWindow;
    rest.can_reschedule = a.status === 'confirmed' && inWindow && a.reschedule_count < 3;
  }
  return rest;
}

function str(v, max = 500) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function validatePatient(input) {
  const name = str(input.patient_name, 80);
  const email = str(input.email, 120).toLowerCase();
  const phone = normalizePhone(input.phone);
  if (name.length < 2) throw new BookingError('Please enter the patient’s full name');
  if (!EMAIL_RE.test(email)) throw new BookingError('Please enter a valid email address');
  if (!PHONE_RE.test(phone)) throw new BookingError('Please enter a valid 10-digit Indian mobile number');
  let age = null;
  if (input.age !== undefined && input.age !== null && input.age !== '') {
    age = Number(input.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) throw new BookingError('Please enter a valid age');
  }
  const gender = ['male', 'female', 'other'].includes(input.gender) ? input.gender : null;
  let painLevel = null;
  if (input.pain_level !== undefined && input.pain_level !== null && input.pain_level !== '') {
    painLevel = Number(input.pain_level);
    if (!Number.isInteger(painLevel) || painLevel < 0 || painLevel > 10) throw new BookingError('Pain level must be between 0 and 10');
  }
  return {
    patient_name: name, email, phone, age, gender, pain_level: painLevel,
    pain_area: str(input.pain_area, 200) || null,
    medical_history: str(input.medical_history, 1000) || null,
    notes: str(input.notes, 1000) || null,
  };
}

function loadTreatment(db, id) {
  const t = db.prepare('SELECT * FROM treatments WHERE id = ? AND active = 1').get(Number(id));
  if (!t) throw new BookingError('Please choose a valid treatment');
  return t;
}

function loadCredit(db, code, treatment, phone, now) {
  const pp = db.prepare("SELECT * FROM package_purchases WHERE code = ? AND status = 'active'").get(String(code).trim().toUpperCase());
  if (!pp) throw new BookingError('Package code not found or not active');
  if (normalizePhone(pp.phone) !== phone) throw new BookingError('This package belongs to a different mobile number');
  if (pp.treatment_id !== treatment.id) throw new BookingError('This package is for a different treatment');
  if (pp.sessions_used >= pp.sessions_total) throw new BookingError('All sessions in this package have been used');
  if (pp.expires_on < T.nowIST(now).date) throw new BookingError('This package has expired');
  return pp;
}

function quote(db, input, now) {
  const settings = getSettings(db);
  const treatment = loadTreatment(db, input.treatment_id);
  const mode = input.mode || 'clinic';
  if (!treatment.modes.split(',').includes(mode)) throw new BookingError('This treatment is not available for the selected visit type');
  const pkg = input.package_id ? db.prepare('SELECT * FROM packages WHERE id = ? AND active = 1').get(Number(input.package_id)) : null;
  if (input.package_id && !pkg) throw new BookingError('Please choose a valid package');
  if (pkg && input.package_code) throw new BookingError('You cannot buy a package while using package credit');
  try {
    return {
      treatment, pkg, mode, settings,
      price: computePrice(db, {
        treatment, pkg, mode, couponCode: str(input.coupon_code, 40) || null, usingCredit: Boolean(input.package_code), settings, now,
      }),
    };
  } catch (err) {
    if (err instanceof PricingError) throw new BookingError(err.message);
    throw err;
  }
}

/**
 * Creates an appointment. Returns { appointment, payment } where payment describes
 * what the client must do next (nothing / open Razorpay / demo checkout).
 */
async function createBooking(db, input, user, now) {
  const patient = validatePatient(input);
  const { treatment, pkg, mode, settings, price } = quote(db, input, now);
  const date = str(input.date, 10);
  const time = str(input.time, 5);
  if (!T.isValidDate(date) || !T.isValidTime(time)) throw new BookingError('Please choose a date and time');
  const address = str(input.address, 300);
  if (mode === 'home' && address.length < 10) throw new BookingError('Please enter your full address for the home visit');

  const requestedTherapist = input.therapist_id ? Number(input.therapist_id) : null;
  const wantOnline = input.payment_method === 'online';

  let paymentMethod;
  let status;
  if (price.total === 0) {
    paymentMethod = input.package_code ? 'package' : 'free';
    status = 'confirmed';
  } else if (wantOnline) {
    if (razorpay.isEnabled()) paymentMethod = 'online';
    else if (config.paymentDemo) paymentMethod = 'demo';
    else throw new BookingError('Online payment is not available right now. Please choose pay at clinic.');
    status = 'pending_payment';
  } else {
    if (!settings.allow_pay_at_clinic) throw new BookingError('Please pay online to confirm this booking');
    paymentMethod = input.package_code ? 'package' : 'clinic';
    status = 'confirmed';
  }

  const { duration, blocked } = sessionLength(treatment, mode, settings);
  const ref = randomCode('FX');

  const create = db.transaction(() => {
    const credit = input.package_code ? loadCredit(db, input.package_code, treatment, patient.phone, now) : null;
    const pick = pickTherapist(db, { treatment, date, time, mode, therapistId: requestedTherapist, now });
    if (pick.error) throw new BookingError(pick.error, 409);

    let packagePurchaseId = null;
    let isPurchase = 0;
    if (credit) {
      const pp = credit;
      db.prepare('UPDATE package_purchases SET sessions_used = sessions_used + 1 WHERE id = ?').run(pp.id);
      packagePurchaseId = pp.id;
    } else if (pkg) {
      packagePurchaseId = db.prepare(`INSERT INTO package_purchases
        (code, package_id, package_name, treatment_id, user_id, patient_name, email, phone, sessions_total, sessions_used, status, expires_on)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
        randomCode('PK'), pkg.id, pkg.name, treatment.id, user?.id ?? null, patient.patient_name, patient.email, patient.phone,
        pkg.sessions, status === 'confirmed' ? 'active' : 'pending', T.addDays(date, pkg.validity_days),
      ).lastInsertRowid;
      isPurchase = 1;
    }

    if (price.coupon_code) db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE code = ?').run(price.coupon_code);

    const start = T.toMinutes(time);
    const id = db.prepare(`INSERT INTO appointments
      (ref, user_id, patient_name, email, phone, age, gender, treatment_id, therapist_id, date, start_time, end_time, block_end_time,
       mode, address, package_purchase_id, is_package_purchase, coupon_code, unit_price, sessions, subtotal, package_discount,
       coupon_discount, surcharge, tax, total, payment_method, payment_status, status, pain_area, pain_level, medical_history, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?)`).run(
      ref, user?.id ?? null, patient.patient_name, patient.email, patient.phone, patient.age, patient.gender, treatment.id,
      pick.therapistId, date, time, T.fromMinutes(start + duration), T.fromMinutes(start + blocked),
      mode, mode === 'home' ? address : null, packagePurchaseId, isPurchase, price.coupon_code, price.unit_price, price.sessions,
      price.subtotal, price.package_discount, price.coupon_discount, price.surcharge, price.tax, price.total,
      paymentMethod, status, patient.pain_area, patient.pain_level, patient.medical_history, patient.notes,
    ).lastInsertRowid;
    return id;
  });

  let id;
  try {
    id = create();
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new BookingError('That time slot was just booked. Please choose another.', 409);
    throw err;
  }

  let appt = getById(db, id);
  let payment = { required: false };

  if (paymentMethod === 'online') {
    try {
      const order = await razorpay.createOrder({ amountRupees: appt.total, receipt: appt.ref, notes: { ref: appt.ref } });
      db.prepare('UPDATE appointments SET razorpay_order_id = ? WHERE id = ?').run(order.id, id);
      payment = {
        required: true, provider: 'razorpay', key_id: config.razorpay.keyId, order_id: order.id,
        amount: order.amount, currency: 'INR',
      };
    } catch (err) {
      cancel(db, appt, { by: 'system', reason: 'Payment gateway error', force: true, silent: true });
      throw new BookingError(`Could not start online payment: ${err.message}`, 502);
    }
  } else if (paymentMethod === 'demo') {
    payment = { required: true, provider: 'demo', amount: appt.total * 100, currency: 'INR' };
  }

  if (status === 'confirmed') {
    appt = getById(db, id);
    mailer.sendConfirmation(appt, settings);
  }
  return { appointment: getById(db, id), payment };
}

// Undo side effects (coupon use, package credit) of a booking that no longer happens.
function releaseResources(db, a) {
  if (a.coupon_code) db.prepare('UPDATE coupons SET used_count = MAX(used_count - 1, 0) WHERE code = ?').run(a.coupon_code);
  if (a.package_purchase_id) {
    const pp = db.prepare('SELECT * FROM package_purchases WHERE id = ?').get(a.package_purchase_id);
    if (pp && a.is_package_purchase && pp.status === 'pending') {
      db.prepare("UPDATE package_purchases SET status = 'void' WHERE id = ?").run(pp.id);
    } else if (pp && pp.status === 'active') {
      db.prepare('UPDATE package_purchases SET sessions_used = MAX(sessions_used - 1, 0) WHERE id = ?').run(pp.id);
    }
  }
}

function markPaid(db, a, { paymentId, method }) {
  const settings = getSettings(db);
  const result = db.transaction(() => {
    const cur = db.prepare('SELECT * FROM appointments WHERE id = ?').get(a.id);
    if (cur.payment_status === 'paid') return 'already';
    if (cur.status === 'pending_payment') {
      db.prepare(`UPDATE appointments SET status = 'confirmed', payment_status = 'paid', amount_paid = total,
        razorpay_payment_id = ?, payment_method = ?, updated_at = datetime('now') WHERE id = ?`).run(paymentId, method, cur.id);
      if (cur.is_package_purchase) db.prepare("UPDATE package_purchases SET status = 'active' WHERE id = ?").run(cur.package_purchase_id);
      return 'confirmed';
    }
    // Payment arrived after the hold expired: refund it (the slot may be gone).
    db.prepare(`UPDATE appointments SET payment_status = 'refund_pending', amount_paid = total, razorpay_payment_id = ?,
      admin_notes = trim(coalesce(admin_notes,'') || ' Late payment received after hold expired – refund.'), updated_at = datetime('now')
      WHERE id = ?`).run(paymentId, cur.id);
    return 'late';
  })();
  const fresh = getById(db, a.id);
  if (result === 'confirmed') mailer.sendConfirmation(fresh, settings);
  return { result, appointment: fresh };
}

function cancel(db, a, { by, reason = '', force = false, silent = false, now } = {}) {
  const settings = getSettings(db);
  if (!['confirmed', 'pending_payment'].includes(a.status)) throw new BookingError('This appointment can no longer be cancelled');
  if (!force && T.minutesUntil(a.date, a.start_time, now) < settings.cancel_window_hours * 60) {
    throw new BookingError(`Appointments can be cancelled only up to ${settings.cancel_window_hours} hours before the start time. Please call the clinic.`);
  }
  db.transaction(() => {
    const paymentStatus = a.payment_status === 'paid' && a.amount_paid > 0 ? 'refund_pending' : a.payment_status;
    db.prepare(`UPDATE appointments SET status = 'cancelled', payment_status = ?, cancel_reason = ?, cancelled_by = ?,
      updated_at = datetime('now') WHERE id = ?`).run(paymentStatus, str(reason, 300) || null, by, a.id);
    releaseResources(db, a);
  })();
  const fresh = getById(db, a.id);
  if (!silent && a.status === 'confirmed') mailer.sendCancellation(fresh, settings);
  return fresh;
}

function reschedule(db, a, { date, time, therapistId = null, isStaff = false, now }) {
  const settings = getSettings(db);
  if (a.status !== 'confirmed') throw new BookingError('Only confirmed appointments can be rescheduled');
  if (!isStaff) {
    if (T.minutesUntil(a.date, a.start_time, now) < settings.cancel_window_hours * 60) {
      throw new BookingError(`Appointments can be rescheduled only up to ${settings.cancel_window_hours} hours before the start time.`);
    }
    if (a.reschedule_count >= 3) throw new BookingError('This appointment has been rescheduled the maximum number of times');
  }
  if (!T.isValidDate(date) || !T.isValidTime(time)) throw new BookingError('Please choose a new date and time');
  const treatment = db.prepare('SELECT * FROM treatments WHERE id = ?').get(a.treatment_id);
  const { duration, blocked } = sessionLength(treatment, a.mode, settings);

  try {
    db.transaction(() => {
      const pick = pickTherapist(db, { treatment, date, time, mode: a.mode, therapistId, excludeId: a.id, now });
      if (pick.error) throw new BookingError(pick.error, 409);
      const start = T.toMinutes(time);
      db.prepare(`UPDATE appointments SET date = ?, start_time = ?, end_time = ?, block_end_time = ?, therapist_id = ?,
        reminder_sent = 0, reschedule_count = reschedule_count + 1, updated_at = datetime('now') WHERE id = ?`)
        .run(date, time, T.fromMinutes(start + duration), T.fromMinutes(start + blocked), pick.therapistId, a.id);
    })();
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new BookingError('That time slot was just booked. Please choose another.', 409);
    throw err;
  }
  const fresh = getById(db, a.id);
  mailer.sendReschedule(fresh, settings);
  return fresh;
}

function expirePending(db) {
  const settings = getSettings(db);
  const stale = db.prepare(`SELECT * FROM appointments WHERE status = 'pending_payment' AND created_at <= datetime('now', ?)`)
    .all(`-${settings.pending_payment_ttl_min} minutes`);
  for (const a of stale) cancel(db, a, { by: 'system', reason: 'Payment not completed in time', force: true, silent: true });
  return stale.length;
}

async function sendDueReminders(db, now) {
  const settings = getSettings(db);
  const today = T.nowIST(now).date;
  const rows = db.prepare(`${DETAIL_SQL} WHERE a.status = 'confirmed' AND a.reminder_sent = 0 AND a.date BETWEEN ? AND ?`)
    .all(today, T.addDays(today, 1));
  let sent = 0;
  for (const a of rows) {
    const mins = T.minutesUntil(a.date, a.start_time, now);
    if (mins > 0 && mins <= 24 * 60) {
      db.prepare('UPDATE appointments SET reminder_sent = 1 WHERE id = ?').run(a.id);
      await mailer.sendReminder(a, settings);
      sent++;
    }
  }
  return sent;
}

module.exports = {
  BookingError, getById, getByRef, listForUser, publicView, quote, createBooking, markPaid, cancel, reschedule,
  expirePending, sendDueReminders, availableSlots,
};
