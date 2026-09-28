require('dotenv').config({ quiet: true });
const path = require('path');
const crypto = require('crypto');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

let jwtSecret = env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) {
    console.warn('[config] JWT_SECRET is not set. Using a random secret; all sessions will reset on restart.');
  }
  jwtSecret = crypto.randomBytes(32).toString('hex');
}

module.exports = {
  isProd,
  port: Number(env.PORT) || 3000,
  baseUrl: (env.BASE_URL || `http://localhost:${Number(env.PORT) || 3000}`).replace(/\/$/, ''),
  dbFile: env.DB_FILE || path.join(__dirname, '..', 'data', 'flexura.db'),
  jwtSecret,
  admin: {
    name: env.ADMIN_NAME || 'Clinic Admin',
    email: (env.ADMIN_EMAIL || 'admin@flexuraphysio.in').toLowerCase(),
    password: env.ADMIN_PASSWORD || 'Admin@12345',
  },
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || '',
    keySecret: env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  paymentDemo: env.PAYMENT_DEMO === 'true',
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Flexura Physio Care <no-reply@flexuraphysio.in>',
  },
  timezone: 'Asia/Kolkata',
};
