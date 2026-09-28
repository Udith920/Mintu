const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const config = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient','admin','therapist')),
  therapist_id INTEGER REFERENCES therapists(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS treatments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price INTEGER NOT NULL CHECK (price >= 0),
  modes TEXT NOT NULL DEFAULT 'clinic,home',
  icon TEXT NOT NULL DEFAULT '🩺',
  popular INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS therapists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Physiotherapist',
  qualifications TEXT NOT NULL DEFAULT '',
  specializations TEXT NOT NULL DEFAULT '',
  experience_years INTEGER NOT NULL DEFAULT 0,
  languages TEXT NOT NULL DEFAULT 'English, Hindi',
  gender TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  rating REAL NOT NULL DEFAULT 4.8,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS schedules (
  therapist_id INTEGER NOT NULL REFERENCES therapists(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  break_start TEXT,
  break_end TEXT,
  PRIMARY KEY (therapist_id, weekday)
);

CREATE TABLE IF NOT EXISTS blocked_dates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  therapist_id INTEGER REFERENCES therapists(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sessions INTEGER NOT NULL CHECK (sessions > 1),
  discount_percent REAL NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent < 100),
  validity_days INTEGER NOT NULL DEFAULT 90,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('percent','flat')),
  value REAL NOT NULL CHECK (value > 0),
  min_amount INTEGER NOT NULL DEFAULT 0,
  max_discount INTEGER,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS package_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
  package_name TEXT NOT NULL,
  treatment_id INTEGER NOT NULL REFERENCES treatments(id),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  sessions_total INTEGER NOT NULL,
  sessions_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','void')),
  expires_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  age INTEGER,
  gender TEXT,
  treatment_id INTEGER NOT NULL REFERENCES treatments(id),
  therapist_id INTEGER NOT NULL REFERENCES therapists(id),
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  block_end_time TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('clinic','home','online')),
  address TEXT,
  package_purchase_id INTEGER REFERENCES package_purchases(id) ON DELETE SET NULL,
  is_package_purchase INTEGER NOT NULL DEFAULT 0,
  coupon_code TEXT,
  unit_price INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 1,
  subtotal INTEGER NOT NULL DEFAULT 0,
  package_discount INTEGER NOT NULL DEFAULT 0,
  coupon_discount INTEGER NOT NULL DEFAULT 0,
  surcharge INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'clinic' CHECK (payment_method IN ('clinic','online','demo','package','free')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refund_pending','refunded')),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending_payment','confirmed','completed','cancelled','no_show')),
  pain_area TEXT,
  pain_level INTEGER,
  medical_history TEXT,
  notes TEXT,
  admin_notes TEXT,
  cancel_reason TEXT,
  cancelled_by TEXT,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  reschedule_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_appt_therapist_date ON appointments(therapist_id, date);
CREATE INDEX IF NOT EXISTS idx_appt_date ON appointments(date);
CREATE INDEX IF NOT EXISTS idx_appt_user ON appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appt_phone ON appointments(phone);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot ON appointments(therapist_id, date, start_time)
  WHERE status IN ('pending_payment','confirmed','completed');
`;

const DEFAULT_SETTINGS = {
  clinic_name: 'Flexura Physio Care',
  tagline: 'Move better. Live stronger.',
  phone: '+91 98765 43210',
  whatsapp: '919876543210',
  email: 'care@flexuraphysio.in',
  address: '2nd Floor, Wellness Plaza, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
  maps_url: 'https://maps.google.com/?q=Indiranagar+Bengaluru',
  gstin: '',
  gst_percent: '0',
  home_visit_fee: '500',
  home_visit_buffer_min: '30',
  slot_interval_min: '30',
  min_lead_minutes: '60',
  max_advance_days: '60',
  cancel_window_hours: '4',
  pending_payment_ttl_min: '15',
  allow_pay_at_clinic: 'true',
};

const TREATMENTS = [
  ['initial-assessment', 'Initial Physiotherapy Assessment', 'Assessment', 'Comprehensive evaluation: posture, range of motion, strength, gait analysis and a personalised treatment plan.', 45, 800, 'clinic,home,online', '📋', 1],
  ['back-neck-pain', 'Back & Neck Pain Therapy', 'Orthopaedic', 'Targeted treatment for slip disc, sciatica, cervical spondylosis, lumbar strain and postural pain.', 45, 1000, 'clinic,home', '🦴', 1],
  ['knee-joint-pain', 'Knee & Joint Pain Management', 'Orthopaedic', 'Relief for osteoarthritis, ligament injuries, meniscus tears and chronic joint stiffness.', 45, 1000, 'clinic,home', '🦵', 1],
  ['frozen-shoulder', 'Frozen Shoulder Rehabilitation', 'Orthopaedic', 'Mobilisation and progressive exercise to restore pain-free shoulder movement.', 45, 1000, 'clinic,home', '💪', 0],
  ['sports-injury', 'Sports Injury Rehabilitation', 'Sports', 'Return-to-play programmes for sprains, strains, ACL/rotator-cuff injuries and tendinopathy.', 60, 1400, 'clinic', '🏃', 1],
  ['post-surgical', 'Post-Surgical Rehabilitation', 'Rehabilitation', 'Structured recovery after knee/hip replacement, ACL reconstruction, spine and fracture surgery.', 60, 1500, 'clinic,home', '🏥', 1],
  ['neuro-rehab', 'Neurological Rehabilitation', 'Neurological', 'Stroke, Parkinson’s, spinal-cord injury, Bell’s palsy and balance-disorder rehabilitation.', 60, 1600, 'clinic,home', '🧠', 1],
  ['paediatric', 'Paediatric Physiotherapy', 'Paediatric', 'Developmental delay, cerebral palsy, torticollis and posture care for children.', 45, 1200, 'clinic,home', '🧸', 0],
  ['geriatric', 'Geriatric Care & Fall Prevention', 'Geriatric', 'Strength, balance and mobility training for healthy ageing and fall prevention.', 45, 1000, 'clinic,home', '🧓', 0],
  ['womens-health', 'Women’s Health Physiotherapy', 'Women’s Health', 'Pre & post-natal care, pelvic-floor rehabilitation and diastasis recti correction.', 45, 1200, 'clinic,home,online', '🤰', 0],
  ['cardio-pulmonary', 'Cardio-Pulmonary Rehabilitation', 'Cardio-Pulmonary', 'Breathing exercises, endurance training and post-COVID / post-cardiac recovery.', 45, 1100, 'clinic,home,online', '🫁', 0],
  ['dry-needling', 'Dry Needling', 'Specialised Therapy', 'Trigger-point release for myofascial pain and muscle tightness.', 30, 1200, 'clinic', '📍', 0],
  ['cupping', 'Cupping Therapy', 'Specialised Therapy', 'Myofascial decompression to improve circulation and relieve muscle tension.', 30, 900, 'clinic', '⭕', 0],
  ['manual-therapy', 'Manual Therapy & Mobilisation', 'Specialised Therapy', 'Hands-on joint mobilisation, manipulation and soft-tissue release.', 45, 1100, 'clinic', '👐', 0],
  ['kinesio-taping', 'Kinesio Taping', 'Specialised Therapy', 'Therapeutic taping to support muscles, reduce swelling and improve performance.', 30, 600, 'clinic', '🩹', 0],
  ['electrotherapy', 'Electrotherapy (IFT / TENS / Ultrasound)', 'Specialised Therapy', 'Pain relief and tissue healing with IFT, TENS, ultrasound and laser therapy.', 30, 700, 'clinic', '⚡', 0],
  ['ergonomic', 'Ergonomic & Posture Consultation', 'Assessment', 'Workstation analysis and posture correction plan for desk workers.', 30, 700, 'clinic,online', '💻', 0],
  ['tele-followup', 'Tele-Physio Follow-up (Video)', 'Tele-Physio', 'Online video session to review progress and update your home-exercise programme.', 30, 500, 'online', '📹', 0],
];

const THERAPISTS = [
  ['Dr. Ananya Rao', 'Senior Physiotherapist & Clinic Director', 'MPT (Orthopaedics), CMT', 'Assessment,Orthopaedic,Rehabilitation,Specialised Therapy,Tele-Physio', 12, 'English, Hindi, Kannada, Telugu', 'female', 'Specialises in spine care and post-operative orthopaedic rehabilitation with over a decade of clinical experience.', 4.9],
  ['Dr. Rohan Mehta', 'Sports Physiotherapist', 'MPT (Sports), CSCS', 'Assessment,Sports,Orthopaedic,Specialised Therapy,Tele-Physio', 8, 'English, Hindi, Marathi', 'male', 'Former team physio for state-level cricket and football squads; expert in return-to-sport programmes.', 4.8],
  ['Dr. Fathima Khan', 'Neuro & Paediatric Physiotherapist', 'MPT (Neurology), NDT certified', 'Assessment,Neurological,Paediatric,Geriatric,Rehabilitation,Tele-Physio', 10, 'English, Hindi, Urdu, Malayalam', 'female', 'Passionate about helping stroke survivors and children with developmental conditions regain independence.', 4.9],
  ['Dr. Karthik Iyer', 'Physiotherapist – Women’s Health & Cardio', 'BPT, MPT (Cardio-Pulmonary)', 'Assessment,Women’s Health,Cardio-Pulmonary,Geriatric,Orthopaedic,Tele-Physio', 6, 'English, Tamil, Hindi', 'male', 'Focuses on cardio-pulmonary rehab, pre/post-natal care and healthy-ageing programmes.', 4.7],
];

const PACKAGES = [
  ['5-Session Recovery Pack', 5, 10, 60],
  ['10-Session Rehab Pack', 10, 18, 120],
];

const COUPONS = [
  ['WELCOME10', '10% off your first booking', 'percent', 10, 0, 500, null],
  ['FLEX200', '₹200 off on bookings above ₹1,500', 'flat', 200, 1500, null, null],
  ['SENIOR15', '15% off for senior citizens', 'percent', 15, 0, 1000, null],
];

function seed(db) {
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

  if (db.prepare('SELECT COUNT(*) c FROM treatments').get().c === 0) {
    const ins = db.prepare(`INSERT INTO treatments (slug, name, category, description, duration_min, price, modes, icon, popular, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    TREATMENTS.forEach((t, i) => ins.run(...t, i));
  }

  if (db.prepare('SELECT COUNT(*) c FROM therapists').get().c === 0) {
    const ins = db.prepare(`INSERT INTO therapists (name, title, qualifications, specializations, experience_years, languages, gender, bio, rating)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insSched = db.prepare(`INSERT INTO schedules (therapist_id, weekday, start_time, end_time, break_start, break_end)
      VALUES (?, ?, ?, ?, ?, ?)`);
    THERAPISTS.forEach((t, i) => {
      const id = ins.run(...t).lastInsertRowid;
      // Mon–Sat: staggered shifts so the clinic is covered 8 AM – 8 PM
      const shift = i % 2 === 0 ? ['08:00', '17:00', '13:00', '14:00'] : ['11:00', '20:00', '15:00', '16:00'];
      for (let d = 1; d <= 6; d++) insSched.run(id, d, ...shift);
      // Sunday half-day rota for the first two therapists
      if (i < 2) insSched.run(id, 0, '09:00', '13:00', null, null);
    });
  }

  if (db.prepare('SELECT COUNT(*) c FROM packages').get().c === 0) {
    const ins = db.prepare('INSERT INTO packages (name, sessions, discount_percent, validity_days) VALUES (?, ?, ?, ?)');
    PACKAGES.forEach((p) => ins.run(...p));
  }

  if (db.prepare('SELECT COUNT(*) c FROM coupons').get().c === 0) {
    const ins = db.prepare(`INSERT INTO coupons (code, description, type, value, min_amount, max_discount, valid_until)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    COUPONS.forEach((c) => ins.run(...c));
  }

  if (db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get().c === 0) {
    db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
      .run(config.admin.name, config.admin.email, bcrypt.hashSync(config.admin.password, 10));
    console.log(`[db] Admin account created: ${config.admin.email}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('[db] WARNING: using the default admin password. Log in and change it immediately (Admin portal → Staff logins).');
    }
  }
}

function openDb(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

module.exports = { openDb };
