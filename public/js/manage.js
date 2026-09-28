(async function () {
  const { api, inr, esc, qs, qsa, prettyDate, prettyTime } = FX;
  const params = new URLSearchParams(location.search);
  const cfg = await FX.config();
  const S = cfg.settings;
  let appt = null;
  let phone = '';

  async function load(ref, ph) {
    appt = await api(`/bookings/${encodeURIComponent(ref)}`, { query: { phone: ph } });
    phone = appt.phone;
    FX.rememberBooking(appt.ref, appt.phone);
    history.replaceState(null, '', `/manage?ref=${appt.ref}${params.get('new') ? '&new=1' : ''}`);
    qs('#lookup').classList.add('hidden');
    render();
  }

  qs('#lookup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    qs('#lookup-err').textContent = '';
    try {
      params.delete('new');
      await load(qs('#l-ref').value.trim().toUpperCase(), qs('#l-phone').value.trim());
    } catch (err) {
      qs('#lookup-err').textContent = err.message;
    }
  });

  function showLookup(ref = '') {
    qs('#lookup').classList.remove('hidden');
    qs('#view').innerHTML = '';
    qs('#l-ref').value = ref;
  }

  function render() {
    const a = appt;
    const isNew = params.get('new') && ['confirmed', 'pending_payment'].includes(a.status);
    const waText = `Hi ${S.clinic_name}, regarding my booking ${a.ref} on ${prettyDate(a.date)} at ${prettyTime(a.start_time)}.`;
    const line = (k, v, cls = '') => `<div class="summary-line ${cls}"><span>${k}</span><span>${v}</span></div>`;
    const remaining = a.package_code ? a.package_sessions_total - a.package_sessions_used : 0;

    qs('#view').innerHTML = `
      <div class="screen-only">
        ${isNew && a.status === 'confirmed' ? `<div class="success-hero"><div class="tick">✓</div><h1 style="font-size:1.9rem">Your appointment is confirmed!</h1>
          <p class="muted">A confirmation has been sent to <b>${esc(a.email)}</b>. Please save your booking reference.</p></div>` : ''}
        ${a.status === 'pending_payment' ? `<div class="alert alert-warn" style="margin-top:24px"><b>Payment pending.</b> Your slot is held for ${S.pending_payment_ttl_min} minutes. Complete the payment to confirm your appointment, otherwise the slot will be released.</div>` : ''}
        <div class="card booking-card" style="margin-top:24px">
          <div class="row between">
            <div><div class="muted small">Booking reference</div><div class="ref">${esc(a.ref)}</div></div>
            <div class="row">${FX.badge(a.status)} ${FX.badge(a.payment_status)}</div>
          </div>
          <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
          <dl class="kv">
            <dt>Treatment</dt><dd>${a.treatment_icon} ${esc(a.treatment_name)}</dd>
            <dt>Therapist</dt><dd>${esc(a.therapist_name)} <span class="muted small">· ${esc(a.therapist_title)}</span></dd>
            <dt>Date</dt><dd>${prettyDate(a.date)}</dd>
            <dt>Time</dt><dd>${prettyTime(a.start_time)} – ${prettyTime(a.end_time)} IST</dd>
            <dt>Visit type</dt><dd>${FX.MODE_ICON[a.mode]} ${FX.MODE_LABEL[a.mode]}</dd>
            <dt>${a.mode === 'home' ? 'Address' : a.mode === 'online' ? 'Video link' : 'Location'}</dt>
            <dd>${a.mode === 'home' ? esc(a.address) : a.mode === 'online' ? 'Shared on WhatsApp &amp; email 15 minutes before the session' : `${esc(S.address)} · <a href="${esc(S.maps_url)}" target="_blank" rel="noopener">Directions</a>`}</dd>
            <dt>Patient</dt><dd>${esc(a.patient_name)} · ${esc(a.phone)}</dd>
            ${a.cancel_reason ? `<dt>Cancellation</dt><dd>${esc(a.cancel_reason)}</dd>` : ''}
          </dl>
          ${a.package_code ? `<div class="alert alert-info" style="margin-top:18px">
            🎟️ <b>${esc(a.package_name)}</b>: package code <b>${esc(a.package_code)}</b>. <b>${remaining}</b> of ${a.package_sessions_total} sessions remaining (valid till ${prettyDate(a.package_expires_on)}).
            ${remaining > 0 && a.package_status === 'active' ? `<br><a class="btn btn-primary btn-sm" style="margin-top:10px" href="/book?credit=${encodeURIComponent(a.package_code)}">Book next session</a>` : ''}
          </div>` : ''}
          <div style="margin-top:18px;max-width:420px;margin-left:auto">
            ${a.is_package_purchase ? line(`${a.sessions} sessions × ${inr(a.unit_price)}`, inr(a.subtotal)) : line('Session fee', inr(a.subtotal))}
            ${a.package_discount ? line('Package discount', `− ${inr(a.package_discount)}`, 'discount') : ''}
            ${a.coupon_discount ? line(`Coupon ${esc(a.coupon_code)}`, `− ${inr(a.coupon_discount)}`, 'discount') : ''}
            ${a.surcharge ? line('Home visit charge', inr(a.surcharge)) : ''}
            ${a.tax ? line('GST', inr(a.tax)) : ''}
            ${line('Total', inr(a.total), 'total')}
            ${a.amount_paid ? line('Paid', inr(a.amount_paid)) : ''}
            ${a.payment_status === 'unpaid' && a.total > 0 && a.status === 'confirmed' ? '<p class="small muted" style="margin-top:6px">Pay at the clinic by cash, UPI or card.</p>' : ''}
            ${a.payment_status === 'refund_pending' ? '<p class="small" style="margin-top:6px;color:var(--warn)">Refund is being processed (5–7 working days).</p>' : ''}
          </div>
        </div>

        <div class="card no-print" style="margin-top:16px">
          <h3>Actions</h3>
          <div class="row">
            ${a.status === 'pending_payment' && a.payment_method === 'demo' ? '<button class="btn btn-primary" id="pay-now">💳 Complete payment</button>' : ''}
            ${a.status === 'confirmed' ? `<a class="btn btn-ghost" href="/api/bookings/${a.ref}/ics?phone=${a.phone}">📅 Add to calendar</a>` : ''}
            <button class="btn btn-ghost" id="print-btn">🧾 ${a.payment_status === 'paid' ? 'Download receipt' : 'Print booking'}</button>
            <a class="btn btn-ghost" target="_blank" rel="noopener" href="${FX.whatsappLink(S.whatsapp, waText)}">💬 WhatsApp clinic</a>
            ${a.can_reschedule ? '<button class="btn btn-ghost" id="resched-btn">🔁 Reschedule</button>' : ''}
            ${a.can_cancel ? '<button class="btn btn-danger" id="cancel-btn">✕ Cancel appointment</button>' : ''}
          </div>
          ${['confirmed'].includes(a.status) && !a.can_cancel ? `<p class="small muted" style="margin:12px 0 0">Online changes close ${S.cancel_window_hours} hours before the appointment. Please call <a href="tel:${esc(S.phone.replace(/\s/g, ''))}">${esc(S.phone)}</a> for help.</p>` : ''}
          ${a.status === 'confirmed' ? `<p class="small muted" style="margin:12px 0 0">💡 Please arrive 10 minutes early, wear loose comfortable clothing and bring any medical reports or scans.</p>` : ''}
        </div>
        <p class="center small no-print" style="margin-top:18px"><a href="/manage" id="other-booking">Look up another booking</a> · <a href="/book">Make a new booking</a></p>
      </div>
      ${invoiceHtml(a)}`;

    qs('#print-btn').addEventListener('click', () => window.print());
    qs('#cancel-btn')?.addEventListener('click', openCancel);
    qs('#resched-btn')?.addEventListener('click', openReschedule);
    qs('#pay-now')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const out = await api(`/bookings/${a.ref}/demo-pay`, { method: 'POST', body: { phone } });
        appt = out.appointment;
        params.set('new', '1');
        render();
        FX.toast('Payment successful. Your appointment is confirmed.');
      } catch (err) { FX.toast(err.message, 'error'); e.target.disabled = false; }
    });
  }

  function invoiceHtml(a) {
    const row = (d, amt) => `<tr><td>${d}</td><td class="r">${amt}</td></tr>`;
    return `<div class="invoice">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div><h2 style="margin:0">${esc(S.clinic_name)}</h2><div class="small">${esc(S.address)}<br>${esc(S.phone)} · ${esc(S.email)}${S.gstin ? `<br>GSTIN: ${esc(S.gstin)}` : ''}</div></div>
        <div style="text-align:right"><h3 style="margin:0">${a.payment_status === 'paid' ? 'PAYMENT RECEIPT' : 'BOOKING SLIP'}</h3>
          <div class="small">No: ${esc(a.ref)}<br>Issued: ${new Date().toLocaleDateString('en-IN')}</div></div>
      </div>
      <hr>
      <p><b>Patient:</b> ${esc(a.patient_name)} · ${esc(a.phone)} · ${esc(a.email)}<br>
      <b>Appointment:</b> ${prettyDate(a.date)}, ${prettyTime(a.start_time)} IST · ${FX.MODE_LABEL[a.mode]} · ${esc(a.therapist_name)}</p>
      <table>
        <thead><tr><th>Description</th><th class="r">Amount (₹)</th></tr></thead>
        <tbody>
          ${row(`${esc(a.treatment_name)}${a.is_package_purchase ? ` (${esc(a.package_name)}: ${a.sessions} sessions × ${inr(a.unit_price)})` : a.payment_method === 'package' ? ` (package ${esc(a.package_code)})` : ''}`, inr(a.subtotal))}
          ${a.package_discount ? row('Package discount', `− ${inr(a.package_discount)}`) : ''}
          ${a.coupon_discount ? row(`Coupon (${esc(a.coupon_code)})`, `− ${inr(a.coupon_discount)}`) : ''}
          ${a.surcharge ? row('Home visit charge', inr(a.surcharge)) : ''}
          ${a.tax ? row('GST', inr(a.tax)) : ''}
          <tr><th>Total</th><th class="r">${inr(a.total)}</th></tr>
          <tr><td>Amount paid (${esc(a.payment_method)})</td><td class="r">${inr(a.amount_paid)}</td></tr>
          <tr><td>Balance due</td><td class="r">${inr(Math.max(a.total - a.amount_paid, 0))}</td></tr>
        </tbody>
      </table>
      ${a.razorpay_payment_id ? `<p class="small">Transaction ID: ${esc(a.razorpay_payment_id)}</p>` : ''}
      <p class="small">Status: ${FX.STATUS_LABEL[a.status]} · Payment: ${FX.PAY_LABEL[a.payment_status]}</p>
      <p class="small">This is a computer-generated document and does not require a signature. Thank you for choosing ${esc(S.clinic_name)}.</p>
    </div>`;
  }

  function modal(html, wide = false) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.x')) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    return { el: wrap, close };
  }

  function openCancel() {
    const refundNote = appt.payment_status === 'paid' ? `<div class="alert alert-info small">You paid ${inr(appt.amount_paid)} online. A full refund will be processed to your original payment method within 5–7 working days.</div>` : '';
    const packageNote = appt.package_code ? '<div class="alert alert-info small">The session will be returned to your package so you can rebook it later.</div>' : '';
    const m = modal(`<h3>Cancel appointment <button class="x" aria-label="Close">×</button></h3>
      <p>Are you sure you want to cancel your <b>${esc(appt.treatment_name)}</b> on <b>${prettyDate(appt.date)} at ${prettyTime(appt.start_time)}</b>?</p>
      ${refundNote}${packageNote}
      <div class="field"><label for="c-reason">Reason (optional)</label>
        <select id="c-reason"><option>Feeling better</option><option>Schedule conflict</option><option>Travelling</option><option>Booked by mistake</option><option>Other</option></select></div>
      <div class="row" style="justify-content:flex-end"><button class="btn btn-ghost x">Keep appointment</button><button class="btn btn-danger" id="c-confirm">Yes, cancel</button></div>`);
    qs('#c-confirm', m.el).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        appt = await api(`/bookings/${appt.ref}/cancel`, { method: 'POST', body: { phone, reason: qs('#c-reason', m.el).value } });
        params.delete('new');
        m.close();
        render();
        FX.toast('Your appointment has been cancelled.');
      } catch (err) { FX.toast(err.message, 'error'); e.target.disabled = false; }
    });
  }

  function openReschedule() {
    let from = cfg.today;
    let date = null;
    let time = null;
    let therapist = String(appt.therapist_id);
    const m = modal(`<h3>Reschedule appointment <button class="x" aria-label="Close">×</button></h3>
      <p class="small muted">Currently: ${prettyDate(appt.date)} at ${prettyTime(appt.start_time)} with ${esc(appt.therapist_name)}</p>
      <div class="field"><label for="r-th">Therapist</label><select id="r-th">
        <option value="${appt.therapist_id}">Keep ${esc(appt.therapist_name)}</option><option value="any">Any available therapist</option></select></div>
      <div class="cal-nav"><button class="btn btn-ghost btn-sm" id="r-prev">←</button><strong id="r-label"></strong><button class="btn btn-ghost btn-sm" id="r-next">→</button></div>
      <div class="days" id="r-days"></div><div id="r-slots"></div>
      <div id="r-err" class="error-text"></div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn btn-ghost x">Close</button><button class="btn btn-primary" id="r-confirm" disabled>Confirm new time</button></div>`, true);
    const q = () => ({ treatment_id: appt.treatment_id, mode: appt.mode, therapist_id: therapist, exclude_ref: appt.ref });

    async function days() {
      const box = qs('#r-days', m.el);
      box.innerHTML = '<div class="spinner" style="grid-column:1/-1"></div>';
      qs('#r-prev', m.el).disabled = from <= cfg.today;
      const out = await api('/availability/days', { query: { ...q(), from, days: 7 } });
      qs('#r-next', m.el).disabled = out.days.length < 7;
      if (out.days.length) qs('#r-label', m.el).textContent = `${prettyDate(out.days[0].date, { weekday: undefined, year: undefined })} – ${prettyDate(out.days.at(-1).date, { weekday: undefined })}`;
      box.innerHTML = out.days.map((d) => {
        const dt = new Date(`${d.date}T00:00:00Z`);
        return `<button type="button" class="day ${d.slots ? '' : 'full'} ${date === d.date ? 'selected' : ''}" data-date="${d.date}" ${d.slots ? '' : 'disabled'}>
          <div class="dow">${dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</div><div class="dnum">${dt.getUTCDate()}</div>
          <div class="dslots">${d.slots ? `${d.slots} slots` : 'Full'}</div></button>`;
      }).join('');
    }
    async function slots() {
      const box = qs('#r-slots', m.el);
      box.innerHTML = '<div class="spinner"></div>';
      const out = await api('/availability', { query: { ...q(), date } });
      box.innerHTML = out.slots.length ? `<div class="slots" style="margin-top:14px">${out.slots.map((s) =>
        `<button type="button" class="slot" data-time="${s.time}">${prettyTime(s.time)}</button>`).join('')}</div>` : '<p class="muted">No slots on this day.</p>';
    }
    qs('#r-days', m.el).addEventListener('click', (e) => {
      const b = e.target.closest('.day');
      if (!b || b.disabled) return;
      date = b.dataset.date; time = null;
      qs('#r-confirm', m.el).disabled = true;
      qsa('.day', m.el).forEach((d) => d.classList.toggle('selected', d === b));
      slots();
    });
    qs('#r-slots', m.el).addEventListener('click', (e) => {
      const b = e.target.closest('.slot');
      if (!b) return;
      time = b.dataset.time;
      qsa('.slot', m.el).forEach((s) => s.classList.toggle('selected', s === b));
      qs('#r-confirm', m.el).disabled = false;
    });
    qs('#r-th', m.el).addEventListener('change', (e) => { therapist = e.target.value; date = null; time = null; qs('#r-slots', m.el).innerHTML = ''; days(); });
    qs('#r-prev', m.el).addEventListener('click', () => { from = FX.addDays(from, -7) < cfg.today ? cfg.today : FX.addDays(from, -7); days(); });
    qs('#r-next', m.el).addEventListener('click', () => { from = FX.addDays(from, 7); days(); });
    qs('#r-confirm', m.el).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        appt = await api(`/bookings/${appt.ref}/reschedule`, { method: 'POST', body: { phone, date, time, therapist_id: therapist } });
        params.delete('new');
        m.close();
        render();
        FX.toast('Appointment rescheduled. A new confirmation has been emailed.');
      } catch (err) {
        qs('#r-err', m.el).textContent = err.message;
        e.target.disabled = false;
      }
    });
    days();
  }

  // ---------- Init ----------
  const ref = (params.get('ref') || '').toUpperCase();
  if (ref) {
    const me = await FX.me();
    const remembered = FX.recallBooking(ref);
    if (remembered || me) {
      try { await load(ref, remembered); return; } catch { /* fall through to lookup */ }
    }
  }
  showLookup(ref);
})().catch((err) => FX.toast(err.message, 'error'));
