const { istToUtc } = require('./time');
const { MODE_LABEL } = require('./format');

function stamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
}

function buildIcs(appt, settings) {
  const location = appt.mode === 'clinic' ? settings.address : appt.mode === 'home' ? appt.address : 'Online (link will be shared on WhatsApp/email)';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Flexura Physio Care//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${appt.ref}@flexuraphysio`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(istToUtc(appt.date, appt.start_time))}`,
    `DTEND:${stamp(istToUtc(appt.date, appt.end_time))}`,
    `SUMMARY:${esc(`${appt.treatment_name} – ${settings.clinic_name}`)}`,
    `DESCRIPTION:${esc(`Booking ref: ${appt.ref}\nTherapist: ${appt.therapist_name}\n${MODE_LABEL[appt.mode]}\nClinic: ${settings.phone}`)}`,
    `LOCATION:${esc(location)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Physiotherapy appointment reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = { buildIcs };
