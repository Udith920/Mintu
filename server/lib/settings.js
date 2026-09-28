const NUMERIC_KEYS = new Set([
  'gst_percent', 'home_visit_fee', 'home_visit_buffer_min', 'slot_interval_min', 'min_lead_minutes',
  'max_advance_days', 'cancel_window_hours', 'pending_payment_ttl_min',
]);
const BOOLEAN_KEYS = new Set(['allow_pay_at_clinic']);

function getSettings(db) {
  const out = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
    if (NUMERIC_KEYS.has(key)) out[key] = Number(value);
    else if (BOOLEAN_KEYS.has(key)) out[key] = value === 'true';
    else out[key] = value;
  }
  return out;
}

function updateSettings(db, patch) {
  const allowed = new Set(db.prepare('SELECT key FROM settings').all().map((r) => r.key));
  const upd = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  const errors = [];
  db.transaction(() => {
    for (const [key, raw] of Object.entries(patch || {})) {
      if (!allowed.has(key)) continue;
      let value = raw;
      if (NUMERIC_KEYS.has(key)) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) { errors.push(`${key} must be a non-negative number`); continue; }
        if (key === 'slot_interval_min' && (n < 5 || n > 120)) { errors.push('slot_interval_min must be between 5 and 120'); continue; }
        value = String(n);
      } else if (BOOLEAN_KEYS.has(key)) {
        value = String(raw === true || raw === 'true');
      } else {
        value = String(raw ?? '').slice(0, 500);
      }
      upd.run(value, key);
    }
  })();
  return errors;
}

// Only what the public site needs.
function publicSettings(s) {
  const keys = ['clinic_name', 'tagline', 'phone', 'whatsapp', 'email', 'address', 'maps_url', 'gstin', 'gst_percent',
    'home_visit_fee', 'max_advance_days', 'cancel_window_hours', 'allow_pay_at_clinic', 'pending_payment_ttl_min'];
  return Object.fromEntries(keys.map((k) => [k, s[k]]));
}

module.exports = { getSettings, updateSettings, publicSettings };
