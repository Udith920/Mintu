// All clinic dates/times are Indian Standard Time (UTC+05:30, no DST).
const IST_OFFSET_MIN = 330;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nowIST(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MIN * 60000);
  const date = shifted.toISOString().slice(0, 10);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return { date, minutes };
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isValidTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}

function weekday(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

// Minutes from "now" (IST) until the given IST date + time. Negative if in the past.
function minutesUntil(dateStr, hhmm, now = new Date()) {
  const n = nowIST(now);
  return daysBetween(n.date, dateStr) * 1440 + toMinutes(hhmm) - n.minutes;
}

// Absolute UTC Date for an IST wall-clock date/time.
function istToUtc(dateStr, hhmm) {
  return new Date(Date.parse(`${dateStr}T${hhmm}:00Z`) - IST_OFFSET_MIN * 60000);
}

module.exports = {
  toMinutes, fromMinutes, nowIST, isValidDate, isValidTime, weekday, addDays, daysBetween, minutesUntil, istToUtc,
};
