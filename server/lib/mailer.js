const nodemailer = require('nodemailer');
const config = require('../config');
const { inr, prettyDate, prettyTime, escapeHtml, MODE_LABEL } = require('./format');
const { buildIcs } = require('./ics');

let transport = null;
if (config.smtp.host) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

// Tests and local dev can inspect what would have been sent.
const outbox = [];

async function send({ to, subject, html, attachments }) {
  if (!to) return;
  outbox.push({ to, subject });
  if (outbox.length > 100) outbox.shift();
  if (!transport) {
    if (process.env.NODE_ENV !== 'test') console.log(`[mail] (SMTP not configured) To: ${to} | ${subject}`);
    return;
  }
  try {
    await transport.sendMail({ from: config.smtp.from, to, subject, html, attachments });
  } catch (err) {
    console.error('[mail] send failed:', err.message);
  }
}

function layout(settings, title, body) {
  return `<!doctype html><html><body style="margin:0;background:#f3f7f6;font-family:Segoe UI,Arial,sans-serif;color:#17312d">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #dfe9e6">
    <div style="background:#0f766e;color:#fff;padding:20px 24px">
      <div style="font-size:20px;font-weight:700">${escapeHtml(settings.clinic_name)}</div>
      <div style="opacity:.85;font-size:13px">${escapeHtml(settings.tagline)}</div>
    </div>
    <div style="padding:24px">
      <h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(title)}</h2>
      ${body}
    </div>
    <div style="padding:16px 24px;background:#f7faf9;font-size:12px;color:#5b6f6b">
      ${escapeHtml(settings.address)}<br>📞 ${escapeHtml(settings.phone)} · ✉️ ${escapeHtml(settings.email)}
    </div>
  </div></body></html>`;
}

function detailsTable(a) {
  const row = (k, v) => `<tr><td style="padding:6px 0;color:#5b6f6b;width:140px">${k}</td><td style="padding:6px 0;font-weight:600">${v}</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">
    ${row('Booking ref', escapeHtml(a.ref))}
    ${row('Treatment', escapeHtml(a.treatment_name))}
    ${row('Therapist', escapeHtml(a.therapist_name))}
    ${row('Date', prettyDate(a.date))}
    ${row('Time', `${prettyTime(a.start_time)} – ${prettyTime(a.end_time)} IST`)}
    ${row('Visit type', MODE_LABEL[a.mode])}
    ${a.mode === 'home' ? row('Address', escapeHtml(a.address)) : ''}
    ${row('Amount', `${inr(a.total)} (${a.payment_status === 'paid' ? 'Paid' : 'Pay at clinic'})`)}
  </table>`;
}

function manageLink(a) {
  return `${config.baseUrl}/manage.html?ref=${encodeURIComponent(a.ref)}`;
}

function button(href, label) {
  return `<p style="margin:20px 0"><a href="${href}" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`;
}

async function sendConfirmation(a, settings) {
  const body = `<p>Hi ${escapeHtml(a.patient_name)}, your appointment is confirmed. 🎉</p>
    ${detailsTable(a)}
    ${a.package_code ? `<p style="font-size:14px">Your package code is <b>${escapeHtml(a.package_code)}</b>. Use it to book your remaining sessions.</p>` : ''}
    ${button(manageLink(a), 'View / manage booking')}
    <p style="font-size:13px;color:#5b6f6b">Please arrive 10 minutes early and wear comfortable clothing. Free cancellation or rescheduling up to ${settings.cancel_window_hours} hours before your appointment.</p>`;
  await send({
    to: a.email,
    subject: `Appointment confirmed – ${a.ref} | ${settings.clinic_name}`,
    html: layout(settings, 'Appointment confirmed', body),
    attachments: [{ filename: `${a.ref}.ics`, content: buildIcs(a, settings), contentType: 'text/calendar' }],
  });
  await send({
    to: settings.email,
    subject: `[New booking] ${a.ref} – ${a.patient_name} – ${prettyDate(a.date)} ${prettyTime(a.start_time)}`,
    html: layout(settings, 'New booking received', detailsTable(a) + `<p>Phone: ${escapeHtml(a.phone)}<br>Pain: ${escapeHtml(a.pain_area || '-')} (${a.pain_level ?? '-'}/10)</p>`),
  });
}

async function sendCancellation(a, settings) {
  const refundNote = a.payment_status === 'refund_pending'
    ? `<p>Your refund of ${inr(a.amount_paid)} will be processed to the original payment method within 5–7 working days.</p>` : '';
  await send({
    to: a.email,
    subject: `Appointment cancelled – ${a.ref} | ${settings.clinic_name}`,
    html: layout(settings, 'Appointment cancelled', `<p>Hi ${escapeHtml(a.patient_name)}, your appointment has been cancelled.</p>${detailsTable(a)}${refundNote}${button(`${config.baseUrl}/book.html`, 'Book again')}`),
  });
}

async function sendReschedule(a, settings) {
  await send({
    to: a.email,
    subject: `Appointment rescheduled – ${a.ref} | ${settings.clinic_name}`,
    html: layout(settings, 'Appointment rescheduled', `<p>Hi ${escapeHtml(a.patient_name)}, your appointment has been moved. New details:</p>${detailsTable(a)}${button(manageLink(a), 'View booking')}`),
    attachments: [{ filename: `${a.ref}.ics`, content: buildIcs(a, settings), contentType: 'text/calendar' }],
  });
}

async function sendReminder(a, settings) {
  await send({
    to: a.email,
    subject: `Reminder: your physiotherapy session on ${prettyDate(a.date)} at ${prettyTime(a.start_time)}`,
    html: layout(settings, 'Appointment reminder', `<p>Hi ${escapeHtml(a.patient_name)}, this is a friendly reminder of your upcoming session.</p>${detailsTable(a)}${button(manageLink(a), 'Manage booking')}`),
  });
}

module.exports = { sendConfirmation, sendCancellation, sendReschedule, sendReminder, outbox };
