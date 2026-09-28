process.env.NODE_ENV = 'test';
process.env.PAYMENT_DEMO = 'true';
process.env.ADMIN_EMAIL = 'admin@test.in';
process.env.ADMIN_PASSWORD = 'AdminPass123';

const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const T = require('../server/lib/time');
const B = require('../server/lib/bookings');

const db = openDb(':memory:');
const app = createApp(db);

// A weekday a few days out, so slots are never in the past or within lead time.
function futureWeekday(offset = 3) {
  let d = T.addDays(T.nowIST().date, offset);
  while (T.weekday(d) === 0) d = T.addDays(d, 1);
  return d;
}

const patient = { patient_name: 'Priya Sharma', email: 'priya@example.com', phone: '+91 98450 12345', age: 34, gender: 'female', pain_area: 'Lower back', pain_level: 6 };

async function firstSlot(treatmentId, date, mode = 'clinic', therapistId = 'any') {
  const res = await request(app).get('/api/availability').query({ treatment_id: treatmentId, date, mode, therapist_id: therapistId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.slots;
}

test('catalogue endpoints return INR-priced treatments, therapists and packages', async () => {
  const cfg = await request(app).get('/api/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.payments.online, 'demo');

  const t = await request(app).get('/api/treatments');
  assert.ok(t.body.length >= 15);
  assert.ok(t.body.every((x) => Number.isInteger(x.price) && x.price > 0));

  const th = await request(app).get('/api/therapists').query({ treatment_id: t.body.find((x) => x.slug === 'sports-injury').id });
  assert.ok(th.body.length >= 1);
  assert.ok(th.body.every((x) => x.specializations.includes('Sports')));

  const p = await request(app).get('/api/packages');
  assert.equal(p.body.length, 2);
});

test('quote applies package discount, coupon and home-visit fee', async () => {
  const back = db.prepare("SELECT * FROM treatments WHERE slug = 'back-neck-pain'").get(); // ₹1,000
  const pkg = db.prepare('SELECT * FROM packages WHERE sessions = 5').get(); // 10% off
  const res = await request(app).post('/api/quote').send({ treatment_id: back.id, package_id: pkg.id, mode: 'home', coupon_code: 'welcome10' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.subtotal, 5000);
  assert.equal(res.body.package_discount, 500);
  assert.equal(res.body.coupon_discount, 450);
  assert.equal(res.body.surcharge, 500);
  assert.equal(res.body.total, 4550);

  const bad = await request(app).post('/api/quote').send({ treatment_id: back.id, mode: 'clinic', coupon_code: 'FLEX200' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /minimum/);

  const noOnline = await request(app).post('/api/quote').send({ treatment_id: back.id, mode: 'online' });
  assert.equal(noOnline.status, 400);
});

test('booking flow: pay at clinic, double-booking prevention, lookup, reschedule, cancel', async () => {
  const t = db.prepare("SELECT * FROM treatments WHERE slug = 'back-neck-pain'").get();
  const date = futureWeekday();
  const slots = await firstSlot(t.id, date, 'clinic', 1);
  assert.ok(slots.length > 0);
  const time = slots[0].time;

  const res = await request(app).post('/api/bookings').send({ ...patient, treatment_id: t.id, therapist_id: 1, date, time, mode: 'clinic', payment_method: 'clinic' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const appt = res.body.appointment;
  assert.equal(appt.status, 'confirmed');
  assert.equal(appt.total, 1000);
  assert.equal(appt.phone, '9845012345');
  assert.match(appt.ref, /^FX-[A-Z0-9]{6}$/);

  // Same therapist + time is now taken
  const dup = await request(app).post('/api/bookings').send({ ...patient, treatment_id: t.id, therapist_id: 1, date, time, mode: 'clinic', payment_method: 'clinic' });
  assert.equal(dup.status, 409);
  const after = await firstSlot(t.id, date, 'clinic', 1);
  assert.ok(!after.some((s) => s.time === time));

  // Lookup requires the matching phone
  assert.equal((await request(app).get(`/api/bookings/${appt.ref}`).query({ phone: '9000000000' })).status, 404);
  const look = await request(app).get(`/api/bookings/${appt.ref}`).query({ phone: '9845012345' });
  assert.equal(look.status, 200);
  assert.equal(look.body.can_cancel, true);
  assert.equal(look.body.razorpay_order_id, undefined);

  // Calendar file
  const ics = await request(app).get(`/api/bookings/${appt.ref}/ics`).query({ phone: '9845012345' });
  assert.match(ics.text, /BEGIN:VEVENT/);

  // Reschedule to next day
  const newDate = futureWeekday(4) === date ? futureWeekday(5) : futureWeekday(4);
  const newSlots = await firstSlot(t.id, newDate, 'clinic', 1);
  const rs = await request(app).post(`/api/bookings/${appt.ref}/reschedule`).send({ phone: '9845012345', date: newDate, time: newSlots[1].time, therapist_id: 1 });
  assert.equal(rs.status, 200, JSON.stringify(rs.body));
  assert.equal(rs.body.date, newDate);
  assert.equal(rs.body.reschedule_count, 1);
  // Old slot is free again
  assert.ok((await firstSlot(t.id, date, 'clinic', 1)).some((s) => s.time === time));

  const c = await request(app).post(`/api/bookings/${appt.ref}/cancel`).send({ phone: '9845012345', reason: 'Travelling' });
  assert.equal(c.status, 200);
  assert.equal(c.body.status, 'cancelled');
});

test('home visits block travel buffer; lead time and holidays are respected', async () => {
  const t = db.prepare("SELECT * FROM treatments WHERE slug = 'knee-joint-pain'").get(); // 45 min
  const date = futureWeekday(6);
  const slots = await firstSlot(t.id, date, 'home', 1);
  const res = await request(app).post('/api/bookings').send({ ...patient, phone: '9876500001', treatment_id: t.id, therapist_id: 1, date, time: slots[0].time, mode: 'home', address: '12, MG Road, Bengaluru 560001', payment_method: 'clinic' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.appointment.surcharge, 500);
  // 45 min + 30 min buffer = 75 min blocked: the next two 30-min starts are unavailable
  const start = T.toMinutes(slots[0].time);
  const after = (await firstSlot(t.id, date, 'clinic', 1)).map((s) => T.toMinutes(s.time));
  assert.ok(!after.includes(start + 30));
  assert.ok(!after.includes(start + 60));

  const noAddr = await request(app).post('/api/bookings').send({ ...patient, treatment_id: t.id, date, time: slots[5].time, mode: 'home', payment_method: 'clinic' });
  assert.equal(noAddr.status, 400);

  // Clinic holiday
  const holiday = futureWeekday(8);
  db.prepare("INSERT INTO blocked_dates (therapist_id, date, reason) VALUES (NULL, ?, 'Diwali')").run(holiday);
  assert.equal((await firstSlot(t.id, holiday)).length, 0);

  // Past dates rejected
  const past = await request(app).get('/api/availability').query({ treatment_id: t.id, date: T.addDays(T.nowIST().date, -1) });
  assert.equal(past.status, 400);
});

test('online demo payment confirms booking and activates package; credits can be redeemed', async () => {
  const t = db.prepare("SELECT * FROM treatments WHERE slug = 'post-surgical'").get(); // ₹1,500
  const pkg = db.prepare('SELECT * FROM packages WHERE sessions = 5').get();
  const date = futureWeekday(9);
  const slots = await firstSlot(t.id, date);
  const res = await request(app).post('/api/bookings').send({ ...patient, phone: '9123456780', treatment_id: t.id, date, time: slots[0].time, mode: 'clinic', package_id: pkg.id, payment_method: 'online' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.appointment.status, 'pending_payment');
  assert.equal(res.body.payment.provider, 'demo');
  assert.equal(res.body.appointment.total, 6750);
  const ref = res.body.appointment.ref;

  const paid = await request(app).post(`/api/bookings/${ref}/demo-pay`).send({ phone: '9123456780' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.appointment.status, 'confirmed');
  assert.equal(paid.body.appointment.payment_status, 'paid');
  assert.equal(paid.body.appointment.amount_paid, 6750);
  const code = paid.body.appointment.package_code;
  assert.match(code, /^PK-/);

  const credit = await request(app).get(`/api/package-credits/${code}`).query({ phone: '9123456780' });
  assert.equal(credit.body.remaining, 4);

  const s2 = await firstSlot(t.id, date);
  const second = await request(app).post('/api/bookings').send({ ...patient, phone: '9123456780', treatment_id: t.id, date, time: s2[0].time, mode: 'clinic', package_code: code });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.equal(second.body.appointment.total, 0);
  assert.equal(second.body.appointment.payment_method, 'package');
  assert.equal((await request(app).get(`/api/package-credits/${code}`).query({ phone: '9123456780' })).body.remaining, 3);

  // Someone else's phone cannot use the credit
  const thief = await request(app).post('/api/bookings').send({ ...patient, phone: '9000000001', treatment_id: t.id, date, time: s2[1].time, mode: 'clinic', package_code: code });
  assert.equal(thief.status, 400);
});

test('expired payment holds are released', async () => {
  const t = db.prepare("SELECT * FROM treatments WHERE slug = 'cupping'").get();
  const date = futureWeekday(10);
  const slots = await firstSlot(t.id, date, 'clinic', 2);
  const res = await request(app).post('/api/bookings').send({ ...patient, phone: '9988776655', treatment_id: t.id, therapist_id: 2, date, time: slots[0].time, mode: 'clinic', payment_method: 'online', coupon_code: 'WELCOME10' });
  assert.equal(res.status, 201);
  const used = db.prepare("SELECT used_count FROM coupons WHERE code = 'WELCOME10'").get().used_count;
  assert.ok(!(await firstSlot(t.id, date, 'clinic', 2)).some((s) => s.time === slots[0].time));

  db.prepare("UPDATE appointments SET created_at = datetime('now', '-1 hour') WHERE ref = ?").run(res.body.appointment.ref);
  assert.equal(B.expirePending(db), 1);
  assert.equal(B.getByRef(db, res.body.appointment.ref).status, 'cancelled');
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'WELCOME10'").get().used_count, used - 1);
  assert.ok((await firstSlot(t.id, date, 'clinic', 2)).some((s) => s.time === slots[0].time));
});

test('patient accounts and admin portal', async () => {
  const agent = request.agent(app);
  const reg = await agent.post('/api/auth/register').send({ name: 'Rahul Verma', email: 'rahul@example.com', phone: '9812345678', password: 'secret123' });
  assert.equal(reg.status, 201);
  const t = db.prepare("SELECT * FROM treatments WHERE slug = 'initial-assessment'").get();
  const date = futureWeekday(11);
  const slots = await firstSlot(t.id, date, 'online');
  const b = await agent.post('/api/bookings').send({ ...patient, patient_name: 'Rahul Verma', email: 'rahul@example.com', phone: '9812345678', treatment_id: t.id, date, time: slots[0].time, mode: 'online', payment_method: 'clinic' });
  assert.equal(b.status, 201);
  const mine = await agent.get('/api/auth/my-bookings');
  assert.equal(mine.body.length, 1);

  // Patients cannot reach the admin API
  assert.equal((await agent.get('/api/admin/stats')).status, 403);
  assert.equal((await request(app).get('/api/admin/stats')).status, 401);

  const admin = request.agent(app);
  assert.equal((await admin.post('/api/auth/login').send({ email: 'admin@test.in', password: 'wrong' })).status, 401);
  assert.equal((await admin.post('/api/auth/login').send({ email: 'admin@test.in', password: 'AdminPass123' })).status, 200);
  const stats = await admin.get('/api/admin/stats');
  assert.equal(stats.status, 200);
  assert.equal(stats.body.series.length, 30);

  const list = await admin.get('/api/admin/appointments').query({ q: 'Rahul' });
  assert.equal(list.body.length, 1);
  const upd = await admin.patch(`/api/admin/appointments/${list.body[0].id}`).send({ status: 'completed', payment_status: 'paid' });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.status, 'completed');
  assert.equal(upd.body.amount_paid, t.price);

  const csv = await admin.get('/api/admin/appointments.csv');
  assert.match(csv.text, /Rahul Verma/);

  const cal = await admin.get('/api/admin/calendar').query({ date });
  assert.equal(cal.body.columns.length, 4);

  const nt = await admin.post('/api/admin/treatments').send({ name: 'Hydrotherapy', category: 'Rehabilitation', duration_min: 45, price: 1300, modes: ['clinic'] });
  assert.equal(nt.status, 201);
  assert.equal(nt.body.price, 1300);

  const cp = await admin.post('/api/admin/coupons').send({ code: 'monsoon25', type: 'percent', value: 25, max_discount: 400 });
  assert.equal(cp.status, 201);
  assert.equal(cp.body.code, 'MONSOON25');

  const st = await admin.put('/api/admin/settings').send({ home_visit_fee: 650, gst_percent: 18 });
  assert.equal(st.body.home_visit_fee, 650);
  const q = await request(app).post('/api/quote').send({ treatment_id: nt.body.id, mode: 'clinic' });
  assert.equal(q.body.tax, 234);
  assert.equal(q.body.total, 1534);
  await admin.put('/api/admin/settings').send({ gst_percent: 0, home_visit_fee: 500 });

  // Therapist login sees only own appointments
  await admin.post('/api/admin/staff').send({ name: 'Rohan', email: 'rohan@test.in', password: 'therapist1', role: 'therapist', therapist_id: 2 });
  const th = request.agent(app);
  await th.post('/api/auth/login').send({ email: 'rohan@test.in', password: 'therapist1' });
  const own = await th.get('/api/admin/appointments');
  assert.equal(own.status, 200);
  assert.ok(own.body.every((a) => a.therapist_id === 2));
  assert.equal((await th.get('/api/admin/settings')).status, 403);
});
