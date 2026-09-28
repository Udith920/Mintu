(async function () {
  const { api, inr, esc, qs, qsa, prettyDate, prettyTime } = FX;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let me = await FX.me();
  let cfg = await FX.config();

  if (!me || me.role === 'patient') {
    qs('#login').classList.remove('hidden');
    if (me) qs('#login-err').textContent = 'This account does not have admin access.';
    qs('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const u = await api('/auth/login', { method: 'POST', body: { email: e.target.email.value, password: e.target.password.value } });
        if (u.role === 'patient') throw new Error('This account does not have admin access.');
        location.reload();
      } catch (err) { qs('#login-err').textContent = err.message; }
    });
    return;
  }

  const isAdmin = me.role === 'admin';
  qs('#shell').classList.remove('hidden');
  qs('#who').innerHTML = `<b>${esc(me.name)}</b><br><span style="opacity:.7">${me.role === 'admin' ? 'Administrator' : 'Therapist'}</span>`;
  qs('#logout').addEventListener('click', FX.logout);
  qs('#menu-btn').addEventListener('click', () => qs('#shell').classList.toggle('menu-open'));

  const PAGES = [
    ['dashboard', '📊', 'Dashboard', true],
    ['appointments', '📋', 'Appointments', true],
    ['calendar', '🗓️', 'Day calendar', true],
    ['treatments', '🩺', 'Treatments & prices', isAdmin],
    ['therapists', '👩‍⚕️', 'Therapists & hours', isAdmin],
    ['holidays', '🌴', 'Holidays & leave', isAdmin],
    ['coupons', '🏷️', 'Coupons', isAdmin],
    ['packages', '🎟️', 'Packages', isAdmin],
    ['staff', '🔐', 'Staff logins', isAdmin],
    ['settings', '⚙️', 'Clinic settings', isAdmin],
  ].filter((p) => p[3]);

  qs('#admin-nav').innerHTML = PAGES.map(([k, i, l]) => `<button data-page="${k}"><span aria-hidden="true">${i}</span>${l}</button>`).join('');
  qs('#admin-nav').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { location.hash = b.dataset.page; qs('#shell').classList.remove('menu-open'); }
  });
  window.addEventListener('hashchange', route);

  const page = qs('#page');
  const actions = qs('#page-actions');
  let therapistsCache = null;
  const getTherapists = async (fresh) => (therapistsCache = (!fresh && therapistsCache) || await api('/admin/therapists'));

  function route() {
    const key = location.hash.slice(1) || 'dashboard';
    const p = PAGES.find((x) => x[0] === key) || PAGES[0];
    qsa('#admin-nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === p[0]));
    qs('#page-title').textContent = p[2];
    actions.innerHTML = '';
    page.innerHTML = '<div class="spinner"></div>';
    VIEWS[p[0]]().catch((err) => { page.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`; });
  }

  // ---------- Generic modal form ----------
  function modal(html, wide) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('.x')) close(); });
    return { el: wrap, close };
  }

  function field(f, v) {
    const val = v ?? f.default ?? '';
    const id = `fld-${f.name}`;
    let input;
    if (f.type === 'select') {
      input = `<select id="${id}" name="${f.name}">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="${id}" name="${f.name}">${esc(val)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<label class="row" style="font-weight:500;margin-bottom:14px"><input type="checkbox" name="${f.name}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
    } else if (f.type === 'checks') {
      const set = new Set(Array.isArray(val) ? val : String(val).split(',').map((s) => s.trim()));
      input = `<div class="row">${f.options.map(([ov, ol]) => `<label class="row" style="font-weight:500;margin:0"><input type="checkbox" name="${f.name}" value="${esc(ov)}" ${set.has(ov) ? 'checked' : ''}> ${esc(ol)}</label>`).join('')}</div>`;
    } else {
      input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}" ${f.step ? `step="${f.step}"` : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}>`;
    }
    return `<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${esc(f.label)}${f.hint ? ` <span class="hint">${esc(f.hint)}</span>` : ''}</label>${input}</div>`;
  }

  function readForm(form, fields) {
    const out = {};
    for (const f of fields) {
      if (f.type === 'checkbox') out[f.name] = form.querySelector(`[name="${f.name}"]`).checked;
      else if (f.type === 'checks') out[f.name] = qsa(`[name="${f.name}"]:checked`, form).map((c) => c.value);
      else out[f.name] = form.querySelector(`[name="${f.name}"]`).value;
    }
    return out;
  }

  function formModal({ title, fields, values = {}, onSubmit, extra = '', wide = false, afterRender }) {
    const m = modal(`<h3>${esc(title)} <button class="x" aria-label="Close">×</button></h3>
      <form novalidate><div class="grid-2">${fields.map((f) => field(f, values[f.name])).join('')}</div>${extra}
      <div class="error-text" data-err></div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn btn-ghost x">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`, wide);
    qsa('.field.full', m.el).forEach((el) => { el.style.gridColumn = '1 / -1'; });
    const form = qs('form', m.el);
    afterRender?.(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      qs('[data-err]', m.el).textContent = '';
      try {
        await onSubmit(readForm(form, fields), form);
        m.close();
      } catch (err) { qs('[data-err]', m.el).textContent = err.message; }
    });
    return m;
  }

  const btn = (label, cls = 'btn-ghost') => {
    const b = document.createElement('button');
    b.className = `btn ${cls} btn-sm`;
    b.textContent = label;
    actions.appendChild(b);
    return b;
  };

  // ---------- Views ----------
  const VIEWS = {};

  VIEWS.dashboard = async () => {
    const s = await api('/admin/stats');
    const m = s.month;
    const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '0%');
    const maxRev = Math.max(...s.series.map((d) => d.revenue), 1);
    const W = 600; const H = 200; const bw = W / s.series.length;
    const bars = s.series.map((d, i) => {
      const h = Math.round((d.revenue / maxRev) * (H - 30));
      return `<rect class="bar" x="${i * bw + 2}" y="${H - 20 - h}" width="${bw - 4}" height="${Math.max(h, 1)}" rx="2"><title>${prettyDate(d.date)}: ${inr(d.revenue)} · ${d.bookings} bookings</title></rect>
        ${i % 5 === 0 ? `<text x="${i * bw + bw / 2}" y="${H - 5}" text-anchor="middle">${new Date(`${d.date}T00:00:00Z`).getUTCDate()}/${new Date(`${d.date}T00:00:00Z`).getUTCMonth() + 1}</text>` : ''}`;
    }).join('');
    const topMax = Math.max(...s.topTreatments.map((t) => t.bookings), 1);
    const modeTotal = s.byMode.reduce((a, b) => a + b.c, 0);

    page.innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="label">Today’s appointments</div><div class="value">${s.todayAppointments.filter((a) => a.status !== 'pending_payment').length}</div><div class="sub">${prettyDate(s.today)}</div></div>
        <div class="kpi"><div class="label">Next 7 days</div><div class="value">${s.upcoming}</div><div class="sub">confirmed bookings</div></div>
        <div class="kpi"><div class="label">Revenue collected (this month)</div><div class="value">${inr(m.revenue)}</div><div class="sub">${inr(m.receivable)} to collect at clinic</div></div>
        <div class="kpi"><div class="label">Bookings this month</div><div class="value">${m.total}</div><div class="sub">${m.completed || 0} completed</div></div>
        <div class="kpi"><div class="label">Cancellation / no-show</div><div class="value">${pct(m.cancelled || 0, m.total)} <span class="small muted">/ ${pct(m.no_show || 0, m.total)}</span></div><div class="sub">this month</div></div>
        <div class="kpi"><div class="label">Refunds pending</div><div class="value">${s.refunds.c}</div><div class="sub">${inr(s.refunds.amt)} · ${s.patients} unique patients overall</div></div>
      </div>
      <div class="dash-grid">
        <div class="card"><h3>Revenue, last 30 days (₹)</h3><svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Revenue chart">
          <line class="grid" x1="0" x2="${W}" y1="${H - 20}" y2="${H - 20}"/>${bars}</svg>
          <p class="small muted" style="margin:6px 0 0">Peak day: ${inr(maxRev === 1 ? 0 : maxRev)}. Hover over bars for details.</p></div>
        <div class="card"><h3>Top treatments (month)</h3>
          ${s.topTreatments.map((t) => `<div class="hbar"><span style="width:24px">${t.icon}</span><span style="width:130px" class="small">${esc(t.name)}</span>
            <div class="track"><div class="fill" style="width:${(t.bookings / topMax) * 100}%"></div></div><b class="small">${t.bookings}</b></div>`).join('') || '<p class="muted small">No bookings yet this month.</p>'}
          <h3 style="margin-top:18px">Visit types</h3>
          ${['clinic', 'home', 'online'].map((k) => { const c = s.byMode.find((x) => x.mode === k)?.c || 0; return `<div class="hbar"><span style="width:130px" class="small">${FX.MODE_ICON[k]} ${FX.MODE_LABEL[k]}</span><div class="track"><div class="fill" style="width:${modeTotal ? (c / modeTotal) * 100 : 0}%"></div></div><b class="small">${c}</b></div>`; }).join('')}
        </div>
      </div>
      <div class="card"><div class="row between"><h3 style="margin:0">Today’s schedule</h3><a href="#calendar" class="small">Open calendar →</a></div>
        ${s.todayAppointments.length ? `<div class="table-wrap" style="margin-top:12px;border:0"><table class="data"><thead><tr><th>Time</th><th>Patient</th><th>Treatment</th><th>Therapist</th><th>Type</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>
          ${s.todayAppointments.map((a) => `<tr class="clickable" data-id="${a.id}"><td><b>${prettyTime(a.start_time)}</b></td><td>${esc(a.patient_name)}<br><span class="small muted">${esc(a.phone)}</span></td>
          <td>${esc(a.treatment_name)}</td><td>${esc(a.therapist_name)}</td><td>${FX.MODE_ICON[a.mode]}</td><td>${FX.badge(a.status)} ${FX.badge(a.payment_status)}</td><td class="num">${inr(a.total)}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">No appointments today.</p>'}
      </div>`;
    qsa('tr[data-id]', page).forEach((tr) => tr.addEventListener('click', () => openAppointment(Number(tr.dataset.id), route)));
  };

  // ----- Appointments -----
  const apptFilters = { from: cfg.today, to: '', status: '', therapist_id: '', mode: '', q: '', order: 'asc' };
  VIEWS.appointments = async () => {
    const ths = await getTherapists();
    page.innerHTML = `<div class="filters">
        <input type="search" id="f-q" placeholder="Search name, phone, ref, email" value="${esc(apptFilters.q)}">
        <input type="date" id="f-from" value="${apptFilters.from}" aria-label="From date">
        <input type="date" id="f-to" value="${apptFilters.to}" aria-label="To date">
        <select id="f-status"><option value="">All statuses</option>${Object.entries(FX.STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${apptFilters.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        ${isAdmin ? `<select id="f-th"><option value="">All therapists</option>${ths.map((t) => `<option value="${t.id}" ${String(apptFilters.therapist_id) === String(t.id) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>` : ''}
        <select id="f-mode"><option value="">All visit types</option>${['clinic', 'home', 'online'].map((k) => `<option value="${k}" ${apptFilters.mode === k ? 'selected' : ''}>${FX.MODE_LABEL[k]}</option>`).join('')}</select>
      </div><div id="appt-table"><div class="spinner"></div></div>`;
    const csv = btn('⬇ Export CSV');
    csv.addEventListener('click', () => { location.href = `/api/admin/appointments.csv?${new URLSearchParams(Object.entries(apptFilters).filter(([, v]) => v))}`; });
    const newB = btn('+ New booking', 'btn-primary');
    newB.addEventListener('click', () => window.open('/book', '_blank'));

    const load = async () => {
      const rows = await api('/admin/appointments', { query: apptFilters });
      const total = rows.filter((r) => r.status !== 'cancelled').reduce((a, r) => a + r.total, 0);
      qs('#appt-table').innerHTML = rows.length ? `<p class="small muted">${rows.length} appointment(s) · booked value ${inr(total)}</p><div class="table-wrap"><table class="data">
        <thead><tr><th>Date &amp; time</th><th>Ref</th><th>Patient</th><th>Treatment</th><th>Therapist</th><th>Type</th><th>Status</th><th>Payment</th><th class="num">Total</th></tr></thead><tbody>
        ${rows.map((a) => `<tr class="clickable" data-id="${a.id}"><td><b>${prettyDate(a.date, { year: undefined })}</b><br>${prettyTime(a.start_time)}</td><td class="small">${esc(a.ref)}</td>
          <td>${esc(a.patient_name)}<br><span class="small muted">${esc(a.phone)}</span></td><td>${a.treatment_icon} ${esc(a.treatment_name)}${a.package_code ? `<br><span class="pill">${esc(a.package_code)}</span>` : ''}</td>
          <td>${esc(a.therapist_name)}</td><td>${FX.MODE_ICON[a.mode]} <span class="small">${FX.MODE_LABEL[a.mode]}</span></td><td>${FX.badge(a.status)}</td><td>${FX.badge(a.payment_status)}<br><span class="small muted">${esc(a.payment_method)}</span></td><td class="num">${inr(a.total)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty card">No appointments match these filters.</div>';
      qsa('tr[data-id]', page).forEach((tr) => tr.addEventListener('click', () => openAppointment(Number(tr.dataset.id), load)));
    };
    let t;
    const bind = (id, key, ev = 'change') => qs(id, page)?.addEventListener(ev, (e) => {
      apptFilters[key] = e.target.value;
      clearTimeout(t);
      t = setTimeout(load, ev === 'input' ? 300 : 0);
    });
    bind('#f-q', 'q', 'input'); bind('#f-from', 'from'); bind('#f-to', 'to'); bind('#f-status', 'status'); bind('#f-th', 'therapist_id'); bind('#f-mode', 'mode');
    await load();
  };

  async function openAppointment(id, onChange) {
    const a = await api(`/admin/appointments/${id}`);
    const m = modal(`<h3>${a.treatment_icon} ${esc(a.treatment_name)} <button class="x" aria-label="Close">×</button></h3>
      <div class="row" style="margin-bottom:14px"><span class="small muted">${esc(a.ref)}</span> ${FX.badge(a.status)} ${FX.badge(a.payment_status)}</div>
      <dl class="kv">
        <dt>When</dt><dd>${prettyDate(a.date)}, ${prettyTime(a.start_time)} – ${prettyTime(a.end_time)}</dd>
        <dt>Therapist</dt><dd>${esc(a.therapist_name)}</dd>
        <dt>Visit</dt><dd>${FX.MODE_ICON[a.mode]} ${FX.MODE_LABEL[a.mode]}${a.address ? `<br><span class="small">${esc(a.address)}</span>` : ''}</dd>
        <dt>Patient</dt><dd>${esc(a.patient_name)}${a.age ? `, ${a.age}` : ''}${a.gender ? ` · ${esc(a.gender)}` : ''}<br>
          <a href="tel:+91${esc(a.phone)}">${esc(a.phone)}</a> · <a href="https://wa.me/91${esc(a.phone)}" target="_blank" rel="noopener">WhatsApp</a> · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a></dd>
        <dt>Pain</dt><dd>${esc(a.pain_area || '–')} ${a.pain_level !== null ? `· <b>${a.pain_level}/10</b>` : ''}</dd>
        ${a.medical_history ? `<dt>History</dt><dd style="font-weight:400">${esc(a.medical_history)}</dd>` : ''}
        ${a.notes ? `<dt>Patient notes</dt><dd style="font-weight:400">${esc(a.notes)}</dd>` : ''}
        <dt>Billing</dt><dd>${inr(a.total)} <span class="small muted">(subtotal ${inr(a.subtotal)}${a.package_discount ? `, package −${inr(a.package_discount)}` : ''}${a.coupon_discount ? `, ${esc(a.coupon_code)} −${inr(a.coupon_discount)}` : ''}${a.surcharge ? `, home +${inr(a.surcharge)}` : ''}${a.tax ? `, GST ${inr(a.tax)}` : ''})</span><br>
          <span class="small">Paid ${inr(a.amount_paid)} via ${esc(a.payment_method)}${a.razorpay_payment_id ? ` · ${esc(a.razorpay_payment_id)}` : ''}</span></dd>
        ${a.package_code ? `<dt>Package</dt><dd>${esc(a.package_code)} · ${a.package_sessions_used}/${a.package_sessions_total} used</dd>` : ''}
        ${a.cancel_reason ? `<dt>Cancelled</dt><dd>${esc(a.cancel_reason)} (${esc(a.cancelled_by || '')})</dd>` : ''}
        <dt>Booked</dt><dd class="small" style="font-weight:400">${esc(a.created_at)} UTC${a.reschedule_count ? ` · rescheduled ${a.reschedule_count}×` : ''}</dd>
      </dl>
      <div class="field" style="margin-top:14px"><label for="ap-notes">Clinical / admin notes</label><textarea id="ap-notes">${esc(a.admin_notes || '')}</textarea></div>
      <div class="row">
        ${['confirmed', 'no_show'].includes(a.status) ? '<button class="btn btn-primary btn-sm" data-status="completed">✓ Mark completed</button>' : ''}
        ${a.status === 'confirmed' ? '<button class="btn btn-ghost btn-sm" data-status="no_show">Mark no-show</button>' : ''}
        ${a.status === 'confirmed' ? '<button class="btn btn-ghost btn-sm" data-resched>🔁 Reschedule</button>' : ''}
        ${isAdmin && a.payment_status === 'unpaid' && a.total > 0 && a.status !== 'cancelled' ? `<button class="btn btn-ghost btn-sm" data-pay="paid">💵 Record payment ${inr(a.total)}</button>` : ''}
        ${isAdmin && a.payment_status === 'refund_pending' ? '<button class="btn btn-ghost btn-sm" data-pay="refunded">Mark refunded</button>' : ''}
        ${['confirmed', 'pending_payment'].includes(a.status) ? '<button class="btn btn-danger btn-sm" data-status="cancelled">Cancel</button>' : ''}
        <span class="grow"></span>
        <button class="btn btn-ghost btn-sm" data-save>Save notes</button>
      </div>`, true);

    const patch = async (body, msg) => {
      try {
        await api(`/admin/appointments/${a.id}`, { method: 'PATCH', body });
        FX.toast(msg);
        m.close();
        onChange?.();
      } catch (err) { FX.toast(err.message, 'error'); }
    };
    qsa('[data-status]', m.el).forEach((b) => b.addEventListener('click', () => {
      const status = b.dataset.status;
      if (status === 'cancelled') {
        const reason = prompt('Reason for cancellation (sent to patient):', 'Cancelled by clinic');
        if (reason === null) return;
        return patch({ status, cancel_reason: reason }, 'Appointment cancelled');
      }
      patch({ status, admin_notes: qs('#ap-notes', m.el).value }, `Marked ${FX.STATUS_LABEL[status].toLowerCase()}`);
    }));
    qsa('[data-pay]', m.el).forEach((b) => b.addEventListener('click', () => patch({ payment_status: b.dataset.pay }, 'Payment updated')));
    qs('[data-save]', m.el).addEventListener('click', () => patch({ admin_notes: qs('#ap-notes', m.el).value }, 'Notes saved'));
    qs('[data-resched]', m.el)?.addEventListener('click', () => { m.close(); openReschedule(a, onChange); });
  }

  async function openReschedule(a, onChange) {
    const ths = await getTherapists();
    const m = modal(`<h3>Reschedule ${esc(a.ref)} <button class="x" aria-label="Close">×</button></h3>
      <div class="grid-2">
        <div class="field"><label>Date</label><input type="date" id="rs-date" min="${cfg.today}" value="${a.date}"></div>
        <div class="field"><label>Therapist</label><select id="rs-th"><option value="${a.therapist_id}">${esc(a.therapist_name)}</option>${isAdmin ? '<option value="any">Any available</option>' + ths.filter((t) => t.id !== a.therapist_id && t.active).map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('') : ''}</select></div>
      </div>
      <div id="rs-slots"></div><div class="error-text" id="rs-err"></div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-ghost x">Close</button><button class="btn btn-primary" id="rs-go" disabled>Reschedule</button></div>`, true);
    let time = null;
    const load = async () => {
      time = null; qs('#rs-go', m.el).disabled = true;
      const box = qs('#rs-slots', m.el);
      try {
        const out = await api('/availability', { query: { treatment_id: a.treatment_id, mode: a.mode, therapist_id: qs('#rs-th', m.el).value, date: qs('#rs-date', m.el).value, exclude_ref: a.ref } });
        box.innerHTML = out.slots.length ? `<div class="slots">${out.slots.map((s) => `<button class="slot" data-time="${s.time}">${prettyTime(s.time)}</button>`).join('')}</div>` : '<p class="muted">No free slots on this date.</p>';
      } catch (err) { box.innerHTML = `<p class="error-text">${esc(err.message)}</p>`; }
    };
    qs('#rs-slots', m.el).addEventListener('click', (e) => {
      const b = e.target.closest('.slot'); if (!b) return;
      time = b.dataset.time; qsa('.slot', m.el).forEach((s) => s.classList.toggle('selected', s === b)); qs('#rs-go', m.el).disabled = false;
    });
    qs('#rs-date', m.el).addEventListener('change', load);
    qs('#rs-th', m.el).addEventListener('change', load);
    qs('#rs-go', m.el).addEventListener('click', async () => {
      try {
        await api(`/admin/appointments/${a.id}/reschedule`, { method: 'POST', body: { date: qs('#rs-date', m.el).value, time, therapist_id: qs('#rs-th', m.el).value } });
        FX.toast('Rescheduled, and the patient has been notified');
        m.close(); onChange?.();
      } catch (err) { qs('#rs-err', m.el).textContent = err.message; }
    });
    load();
  }

  // ----- Calendar -----
  let calDate = cfg.today;
  VIEWS.calendar = async () => {
    const data = await api('/admin/calendar', { query: { date: calDate } });
    const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const starts = data.columns.filter((c) => c.schedule).map((c) => toMin(c.schedule.start_time));
    const ends = data.columns.filter((c) => c.schedule).map((c) => toMin(c.schedule.end_time));
    const dayStart = Math.floor((Math.min(...starts, 480)) / 60) * 60;
    const dayEnd = Math.ceil((Math.max(...ends, 1200)) / 60) * 60;
    const PX = 1.2; // pixels per minute
    const height = (dayEnd - dayStart) * PX;
    const y = (t) => (toMin(t) - dayStart) * PX;
    const hours = [];
    for (let mnt = dayStart; mnt <= dayEnd; mnt += 60) hours.push(mnt);

    page.innerHTML = `<div class="row" style="margin-bottom:14px">
        <button class="btn btn-ghost btn-sm" id="c-prev">←</button><input type="date" id="c-date" value="${calDate}" style="width:auto"><button class="btn btn-ghost btn-sm" id="c-next">→</button>
        <button class="btn btn-ghost btn-sm" id="c-today">Today</button><strong>${prettyDate(calDate)}</strong></div>
      <div class="cal" style="grid-template-columns:60px repeat(${data.columns.length}, minmax(180px, 1fr))">
        <div class="cal-head" style="border-left:0"></div>
        ${data.columns.map((c) => `<div class="cal-head">${esc(c.therapist.name)}<br><span class="small muted" style="font-weight:500">${c.blocked ? `🌴 ${esc(c.blocked)}` : c.schedule ? `${prettyTime(c.schedule.start_time)} – ${prettyTime(c.schedule.end_time)}` : 'Off'}</span></div>`).join('')}
        <div class="cal-times" style="height:${height}px">${hours.map((h) => `<div class="cal-hour" style="top:${(h - dayStart) * PX}px">${prettyTime(`${String(h / 60).padStart(2, '0')}:00`).replace(':00', '')}</div>`).join('')}</div>
        ${data.columns.map((c) => {
          let off = '';
          if (c.blocked || !c.schedule) off = `<div class="cal-off" style="top:0;height:${height}px"></div>`;
          else {
            off += `<div class="cal-off" style="top:0;height:${y(c.schedule.start_time)}px"></div>`;
            off += `<div class="cal-off" style="top:${y(c.schedule.end_time)}px;height:${height - y(c.schedule.end_time)}px"></div>`;
            if (c.schedule.break_start) off += `<div class="cal-off" style="top:${y(c.schedule.break_start)}px;height:${y(c.schedule.break_end) - y(c.schedule.break_start)}px"></div>`;
          }
          const appts = c.appointments.map((a) => `
            ${a.block_end_time !== a.end_time ? `<div class="cal-appt buffer" style="top:${y(a.end_time)}px;height:${y(a.block_end_time) - y(a.end_time)}px;cursor:default" title="Travel buffer"></div>` : ''}
            <div class="cal-appt ${a.status}" data-id="${a.id}" style="top:${y(a.start_time)}px;height:${y(a.end_time) - y(a.start_time) - 2}px" title="${esc(a.patient_name)} · ${esc(a.treatment_name)}">
              <b>${prettyTime(a.start_time)}</b> ${FX.MODE_ICON[a.mode]} ${esc(a.patient_name)}<br>${a.icon} ${esc(a.treatment_name)}</div>`).join('');
          return `<div class="cal-col" style="height:${height}px">${hours.map((h) => `<div class="cal-hour" style="top:${(h - dayStart) * PX}px"></div>`).join('')}${off}${appts}</div>`;
        }).join('')}
      </div>`;
    const go = (d) => { calDate = d; VIEWS.calendar(); };
    qs('#c-prev').addEventListener('click', () => go(FX.addDays(calDate, -1)));
    qs('#c-next').addEventListener('click', () => go(FX.addDays(calDate, 1)));
    qs('#c-today').addEventListener('click', () => go(cfg.today));
    qs('#c-date').addEventListener('change', (e) => e.target.value && go(e.target.value));
    qsa('.cal-appt[data-id]', page).forEach((el) => el.addEventListener('click', () => openAppointment(Number(el.dataset.id), VIEWS.calendar)));
  };

  // ----- Treatments -----
  VIEWS.treatments = async () => {
    const rows = await api('/admin/treatments');
    const categories = [...new Set(rows.map((r) => r.category))];
    const fields = [
      { name: 'name', label: 'Treatment name', full: true },
      { name: 'category', label: 'Category', hint: `(therapists are matched by category, e.g. ${categories.slice(0, 3).join(', ')})` },
      { name: 'icon', label: 'Icon (emoji)', default: '🩺' },
      { name: 'price', label: 'Price per session (₹ INR)', type: 'number' },
      { name: 'duration_min', label: 'Duration (minutes)', type: 'number', default: 45 },
      { name: 'modes', label: 'Available as', type: 'checks', options: [['clinic', 'In-clinic'], ['home', 'Home visit'], ['online', 'Online']], default: 'clinic', full: true },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
      { name: 'sort_order', label: 'Display order', type: 'number', default: 0 },
      { name: 'popular', label: 'Show “Popular” tag', type: 'checkbox' },
      { name: 'active', label: 'Active (bookable)', type: 'checkbox', default: true },
    ];
    const edit = (t) => formModal({
      title: t ? `Edit ${t.name}` : 'New treatment', fields, values: t || {},
      onSubmit: async (v) => {
        await api(t ? `/admin/treatments/${t.id}` : '/admin/treatments', { method: t ? 'PUT' : 'POST', body: v });
        FX.toast('Treatment saved'); VIEWS.treatments();
      },
    });
    btn('+ Add treatment', 'btn-primary').addEventListener('click', () => edit(null));
    page.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th></th><th>Treatment</th><th>Category</th><th>Duration</th><th>Visit types</th><th class="num">Price</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((t) => `<tr><td>${t.icon}</td><td><b>${esc(t.name)}</b>${t.popular ? ' <span class="pill">Popular</span>' : ''}</td><td>${esc(t.category)}</td><td>${t.duration_min} min</td>
        <td>${t.modes.split(',').map((m) => FX.MODE_ICON[m]).join(' ')}</td><td class="num"><b>${inr(t.price)}</b></td><td>${t.active ? '<span class="badge badge-confirmed">Active</span>' : '<span class="badge">Hidden</span>'}</td>
        <td class="num"><button class="btn btn-ghost btn-sm" data-edit="${t.id}">Edit</button> <button class="btn btn-danger btn-sm" data-del="${t.id}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>`;
    qsa('[data-edit]', page).forEach((b) => b.addEventListener('click', () => edit(rows.find((r) => r.id === Number(b.dataset.edit)))));
    qsa('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this treatment? If it has bookings it will be hidden instead.')) return;
      const r = await api(`/admin/treatments/${b.dataset.del}`, { method: 'DELETE' });
      FX.toast(r.archived ? 'Treatment hidden (it has past bookings)' : 'Treatment deleted'); VIEWS.treatments();
    }));
  };

  // ----- Therapists -----
  VIEWS.therapists = async () => {
    const rows = await getTherapists(true);
    const treatments = await api('/admin/treatments');
    const categories = [...new Set(treatments.map((t) => t.category))];
    const fields = [
      { name: 'name', label: 'Name' },
      { name: 'title', label: 'Title', default: 'Physiotherapist' },
      { name: 'qualifications', label: 'Qualifications' },
      { name: 'experience_years', label: 'Years of experience', type: 'number', default: 1 },
      { name: 'languages', label: 'Languages', default: 'English, Hindi' },
      { name: 'gender', label: 'Gender', type: 'select', options: [['', '–'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']] },
      { name: 'rating', label: 'Rating (0–5)', type: 'number', step: '0.1', default: 4.8 },
      { name: 'active', label: 'Active (accepting bookings)', type: 'checkbox', default: true },
      { name: 'specializations', label: 'Treats categories', type: 'checks', options: categories.map((c) => [c, c]), full: true },
      { name: 'bio', label: 'Short bio', type: 'textarea', full: true },
    ];
    const schedHtml = (sched = []) => `<h4 style="margin-top:10px">Weekly working hours</h4>
      <div class="sched-row small muted"><span>Day</span><span>Works</span><span>Start</span><span>End</span><span class="brk">Break from</span><span class="brk">Break to</span></div>
      ${WEEKDAYS.map((d, i) => { const s = sched.find((x) => x.weekday === i); return `<div class="sched-row" data-wd="${i}"><span>${d.slice(0, 3)}</span><input type="checkbox" data-on ${s ? 'checked' : ''}>
        <input type="time" data-s value="${s?.start_time || '09:00'}"><input type="time" data-e value="${s?.end_time || '18:00'}">
        <input type="time" class="brk" data-bs value="${s?.break_start || ''}"><input type="time" class="brk" data-be value="${s?.break_end || ''}"></div>`; }).join('')}`;
    const readSched = (form) => qsa('.sched-row[data-wd]', form).filter((r) => qs('[data-on]', r).checked).map((r) => ({
      weekday: Number(r.dataset.wd), start_time: qs('[data-s]', r).value, end_time: qs('[data-e]', r).value,
      break_start: qs('[data-bs]', r).value || null, break_end: qs('[data-be]', r).value || null,
    }));
    const edit = (t) => formModal({
      title: t ? `Edit ${t.name}` : 'New therapist', fields, wide: true,
      values: t ? { ...t, specializations: t.specializations.split(',') } : {},
      extra: schedHtml(t?.schedule),
      onSubmit: async (v, form) => {
        await api(t ? `/admin/therapists/${t.id}` : '/admin/therapists', { method: t ? 'PUT' : 'POST', body: { ...v, schedule: readSched(form) } });
        FX.toast('Therapist saved'); VIEWS.therapists();
      },
    });
    btn('+ Add therapist', 'btn-primary').addEventListener('click', () => edit(null));
    page.innerHTML = `<div class="team-grid">${rows.map((t) => `<div class="card">
      <div class="row between"><b>${esc(t.name)}</b>${t.active ? '<span class="badge badge-confirmed">Active</span>' : '<span class="badge">Inactive</span>'}</div>
      <div class="small muted">${esc(t.title)} · ${t.experience_years} yrs</div>
      <div class="tags">${t.specializations.split(',').filter(Boolean).map((s) => `<span class="pill">${esc(s)}</span>`).join('')}</div>
      <div class="small" style="margin-top:10px">${t.schedule.map((s) => `${WEEKDAYS[s.weekday].slice(0, 3)} ${s.start_time}–${s.end_time}`).join('<br>') || 'No working hours set'}</div>
      <div class="row" style="margin-top:12px"><button class="btn btn-ghost btn-sm" data-edit="${t.id}">Edit</button>${t.active ? `<button class="btn btn-danger btn-sm" data-del="${t.id}">Deactivate</button>` : ''}</div>
    </div>`).join('')}</div>`;
    qsa('[data-edit]', page).forEach((b) => b.addEventListener('click', () => edit(rows.find((r) => r.id === Number(b.dataset.edit)))));
    qsa('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Deactivate this therapist? They will stop receiving new bookings.')) return;
      try { await api(`/admin/therapists/${b.dataset.del}`, { method: 'DELETE' }); FX.toast('Therapist deactivated'); VIEWS.therapists(); } catch (err) { FX.toast(err.message, 'error'); }
    }));
  };

  // ----- Holidays -----
  VIEWS.holidays = async () => {
    const [rows, ths] = await Promise.all([api('/admin/blocked-dates'), getTherapists()]);
    btn('+ Block a date', 'btn-primary').addEventListener('click', () => formModal({
      title: 'Block a date',
      fields: [
        { name: 'date', label: 'Date', type: 'date', default: cfg.today },
        { name: 'therapist_id', label: 'Applies to', type: 'select', options: [['', '🏥 Whole clinic (holiday)'], ...ths.map((t) => [t.id, `${t.name} (leave)`])] },
        { name: 'reason', label: 'Reason', placeholder: 'e.g. Diwali, Annual leave', full: true },
      ],
      onSubmit: async (v) => {
        const r = await api('/admin/blocked-dates', { method: 'POST', body: v });
        if (r.warning) alert(r.warning);
        FX.toast('Date blocked'); VIEWS.holidays();
      },
    }));
    page.innerHTML = `<p class="muted small">Blocked dates stop new bookings. Existing appointments on those dates stay in place, so reschedule them from the calendar.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Applies to</th><th>Reason</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${prettyDate(r.date)}</b></td><td>${r.therapist_name ? esc(r.therapist_name) : '🏥 Whole clinic'}</td><td>${esc(r.reason)}</td>
        <td class="num"><button class="btn btn-danger btn-sm" data-del="${r.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No upcoming holidays or leave.</td></tr>'}
      </tbody></table></div>`;
    qsa('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
      await api(`/admin/blocked-dates/${b.dataset.del}`, { method: 'DELETE' }); FX.toast('Removed'); VIEWS.holidays();
    }));
  };

  // ----- Coupons -----
  VIEWS.coupons = async () => {
    const rows = await api('/admin/coupons');
    const fields = [
      { name: 'code', label: 'Code' },
      { name: 'type', label: 'Type', type: 'select', options: [['percent', 'Percentage (%)'], ['flat', 'Flat amount (₹)']] },
      { name: 'value', label: 'Discount value', type: 'number' },
      { name: 'max_discount', label: 'Max discount ₹', hint: '(optional)', type: 'number' },
      { name: 'min_amount', label: 'Minimum booking ₹', type: 'number', default: 0 },
      { name: 'max_uses', label: 'Max uses', hint: '(blank = unlimited)', type: 'number' },
      { name: 'valid_until', label: 'Valid until', hint: '(optional)', type: 'date' },
      { name: 'active', label: 'Active', type: 'checkbox', default: true },
      { name: 'description', label: 'Description', full: true },
    ];
    const edit = (c) => formModal({
      title: c ? `Edit ${c.code}` : 'New coupon', fields, values: c || {},
      afterRender: (form) => { if (c) form.code.disabled = true; },
      onSubmit: async (v) => {
        await api(c ? `/admin/coupons/${encodeURIComponent(c.code)}` : '/admin/coupons', { method: c ? 'PUT' : 'POST', body: v });
        FX.toast('Coupon saved'); VIEWS.coupons();
      },
    });
    btn('+ New coupon', 'btn-primary').addEventListener('click', () => edit(null));
    page.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Code</th><th>Discount</th><th>Conditions</th><th>Used</th><th>Valid until</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((c) => `<tr><td><b>${esc(c.code)}</b><br><span class="small muted">${esc(c.description)}</span></td>
        <td>${c.type === 'percent' ? `${c.value}%` : inr(c.value)}${c.max_discount ? ` <span class="small muted">(max ${inr(c.max_discount)})</span>` : ''}</td>
        <td class="small">${c.min_amount ? `Min ${inr(c.min_amount)}` : '–'}</td><td>${c.used_count}${c.max_uses ? ` / ${c.max_uses}` : ''}</td>
        <td>${c.valid_until ? prettyDate(c.valid_until) : 'No expiry'}</td><td>${c.active ? '<span class="badge badge-confirmed">Active</span>' : '<span class="badge">Off</span>'}</td>
        <td class="num"><button class="btn btn-ghost btn-sm" data-edit="${esc(c.code)}">Edit</button> <button class="btn btn-danger btn-sm" data-del="${esc(c.code)}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>`;
    qsa('[data-edit]', page).forEach((b) => b.addEventListener('click', () => edit(rows.find((r) => r.code === b.dataset.edit))));
    qsa('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Delete coupon ${b.dataset.del}?`)) return;
      await api(`/admin/coupons/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); FX.toast('Coupon deleted'); VIEWS.coupons();
    }));
  };

  // ----- Packages -----
  VIEWS.packages = async () => {
    const [rows, purchases] = await Promise.all([api('/admin/packages'), api('/admin/package-purchases')]);
    const fields = [
      { name: 'name', label: 'Package name', full: true },
      { name: 'sessions', label: 'Number of sessions', type: 'number', default: 5 },
      { name: 'discount_percent', label: 'Discount %', type: 'number', step: '0.5', default: 10 },
      { name: 'validity_days', label: 'Validity (days)', type: 'number', default: 90 },
      { name: 'active', label: 'Active', type: 'checkbox', default: true },
    ];
    const edit = (p) => formModal({
      title: p ? `Edit ${p.name}` : 'New package', fields, values: p || {},
      onSubmit: async (v) => { await api(p ? `/admin/packages/${p.id}` : '/admin/packages', { method: p ? 'PUT' : 'POST', body: v }); FX.toast('Package saved'); VIEWS.packages(); },
    });
    btn('+ New package', 'btn-primary').addEventListener('click', () => edit(null));
    page.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Package</th><th>Sessions</th><th>Discount</th><th>Validity</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${p.sessions}</td><td>${p.discount_percent}%</td><td>${p.validity_days} days</td>
        <td>${p.active ? '<span class="badge badge-confirmed">Active</span>' : '<span class="badge">Off</span>'}</td><td class="num"><button class="btn btn-ghost btn-sm" data-edit="${p.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>
      <h3 style="margin-top:28px">Sold packages</h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>Code</th><th>Patient</th><th>Treatment</th><th>Used</th><th>Expires</th><th>Status</th></tr></thead><tbody>
      ${purchases.map((p) => `<tr><td><b>${esc(p.code)}</b></td><td>${esc(p.patient_name)}<br><span class="small muted">${esc(p.phone)}</span></td><td>${esc(p.treatment_name)}<br><span class="small muted">${esc(p.package_name)}</span></td>
        <td>${p.sessions_used} / ${p.sessions_total}</td><td>${prettyDate(p.expires_on)}</td><td><span class="badge ${p.status === 'active' ? 'badge-confirmed' : ''}">${p.status}</span></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No packages sold yet.</td></tr>'}
      </tbody></table></div>`;
    qsa('[data-edit]', page).forEach((b) => b.addEventListener('click', () => edit(rows.find((r) => r.id === Number(b.dataset.edit)))));
  };

  // ----- Staff -----
  VIEWS.staff = async () => {
    const [rows, ths] = await Promise.all([api('/admin/staff'), getTherapists()]);
    btn('+ Add login', 'btn-primary').addEventListener('click', () => formModal({
      title: 'New staff login',
      fields: [
        { name: 'name', label: 'Name' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'password', label: 'Temporary password', type: 'text', hint: '(min 8 chars)' },
        { name: 'role', label: 'Role', type: 'select', options: [['therapist', 'Therapist (own schedule only)'], ['admin', 'Administrator (full access)']] },
        { name: 'therapist_id', label: 'Linked therapist', type: 'select', options: ths.map((t) => [t.id, t.name]), full: true },
      ],
      onSubmit: async (v) => { await api('/admin/staff', { method: 'POST', body: v }); FX.toast('Login created'); VIEWS.staff(); },
    }));
    page.innerHTML = `<p class="muted small">Therapist logins can see and update only their own appointments. Administrators have full access.</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Therapist</th><th></th></tr></thead><tbody>
      ${rows.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="badge ${u.role === 'admin' ? 'badge-completed' : ''}">${u.role}</span></td><td>${esc(u.therapist_name || '–')}</td>
        <td class="num">${u.id !== me.id ? `<button class="btn btn-danger btn-sm" data-del="${u.id}">Remove</button>` : '<span class="small muted">You</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="card" style="margin-top:20px;max-width:420px"><h3>Change your password</h3>
        <form id="pw"><div class="field"><label>Current password</label><input type="password" name="c" required></div>
        <div class="field"><label>New password</label><input type="password" name="n" minlength="8" required></div><button class="btn btn-primary">Update</button></form></div>`;
    qsa('[data-del]', page).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove this login?')) return;
      await api(`/admin/staff/${b.dataset.del}`, { method: 'DELETE' }); FX.toast('Removed'); VIEWS.staff();
    }));
    qs('#pw').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('/auth/change-password', { method: 'POST', body: { current_password: e.target.c.value, new_password: e.target.n.value } }); e.target.reset(); FX.toast('Password updated'); } catch (err) { FX.toast(err.message, 'error'); }
    });
  };

  // ----- Settings -----
  VIEWS.settings = async () => {
    const s = await api('/admin/settings');
    const groups = [
      ['Clinic details', [
        { name: 'clinic_name', label: 'Clinic name' }, { name: 'tagline', label: 'Tagline' },
        { name: 'phone', label: 'Phone' }, { name: 'whatsapp', label: 'WhatsApp number', hint: '(with country code, digits only, e.g. 919876543210)' },
        { name: 'email', label: 'Email (receives booking alerts)' }, { name: 'maps_url', label: 'Google Maps link' },
        { name: 'address', label: 'Address', type: 'textarea', full: true },
      ]],
      ['Pricing & tax (INR)', [
        { name: 'home_visit_fee', label: 'Home visit charge (₹ per visit)', type: 'number' },
        { name: 'gst_percent', label: 'GST %', hint: '(healthcare services are usually GST-exempt, so leave at 0 unless applicable)', type: 'number', step: '0.01' },
        { name: 'gstin', label: 'GSTIN', hint: '(optional, shown on invoices)' },
        { name: 'allow_pay_at_clinic', label: 'Allow “pay at clinic”', type: 'checkbox' },
      ]],
      ['Scheduling rules', [
        { name: 'slot_interval_min', label: 'Slot interval (minutes)', type: 'number' },
        { name: 'min_lead_minutes', label: 'Minimum notice for same-day booking (minutes)', type: 'number' },
        { name: 'max_advance_days', label: 'Booking window (days ahead)', type: 'number' },
        { name: 'home_visit_buffer_min', label: 'Home visit travel buffer (minutes)', type: 'number' },
        { name: 'cancel_window_hours', label: 'Free cancel/reschedule until (hours before)', type: 'number' },
        { name: 'pending_payment_ttl_min', label: 'Hold slot while paying online (minutes)', type: 'number' },
      ]],
    ];
    const all = groups.flatMap((g) => g[1]);
    page.innerHTML = `<form id="settings-form" style="max-width:860px">${groups.map(([title, fields]) => `<div class="card" style="margin-bottom:16px"><h3>${title}</h3>
      <div class="grid-2">${fields.map((f) => field(f, s[f.name])).join('')}</div></div>`).join('')}
      <div class="error-text" id="s-err"></div><button class="btn btn-primary btn-lg" type="submit">Save settings</button></form>`;
    qsa('.field.full', page).forEach((el) => { el.style.gridColumn = '1 / -1'; });
    qs('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      qs('#s-err').textContent = '';
      try {
        await api('/admin/settings', { method: 'PUT', body: readForm(e.target, all) });
        FX.toast('Settings saved');
      } catch (err) { qs('#s-err').textContent = err.message; }
    });
  };

  route();
})().catch((err) => FX.toast(err.message, 'error'));
