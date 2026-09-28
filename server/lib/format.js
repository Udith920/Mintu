const crypto = require('crypto');

function inr(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

function prettyDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function prettyTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Unambiguous uppercase code, e.g. FX-7K3M9Q
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(prefix, len = 6) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}-${s}`;
}

// Indian mobile numbers: keep the last 10 digits.
function normalizePhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MODE_LABEL = { clinic: 'In-clinic visit', home: 'Home visit', online: 'Online video consultation' };

module.exports = { inr, prettyDate, prettyTime, randomCode, normalizePhone, escapeHtml, MODE_LABEL };
