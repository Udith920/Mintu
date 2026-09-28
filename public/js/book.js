(async function () {
  const { api, inr, esc, qs, qsa, prettyDate, prettyTime } = FX;
  const params = new URLSearchParams(location.search);

  const [cfg, treatments, packages, me] = await Promise.all([FX.config(), api('/treatments'), api('/packages'), FX.me()]);
  const S = cfg.settings;
  qsa('[data-cancel-hours]').forEach((el) => { el.textContent = S.cancel_window_hours; });

  const state = {
    step: 1,
    treatment: null,
    mode: params.get('mode') || 'clinic',
    therapistId: params.get('therapist') || 'any',
    therapists: [],
    packageId: params.get('package') ? Number(params.get('package')) : null,
    credit: null,
    rangeStart: cfg.today,
    date: null,
    time: null,
    painArea: new Set(),
    painLevel: null,
    coupon: '',
    payment: cfg.payments.online ? 'online' : 'clinic',
    quote: null,
  };

  const stepEls = qsa('.step');
  const errBox = qs('#step-error');
  const showError = (msg) => { errBox.textContent = msg; errBox.classList.toggle('hidden', !msg); };

  // ---------- Step 1: treatments ----------
  function renderTreatments() {
    const term = qs('#treatment-search').value.trim().toLowerCase();
    const list = treatments.filter((t) => !term || `${t.name} ${t.category} ${t.description}`.toLowerCase().includes(term));
    qs('#treatment-list').innerHTML = list.map((t) => {
      const locked = state.credit && state.credit.treatment_id !== t.id;
      return `<button type="button" class="option ${state.treatment?.id === t.id ? 'selected' : ''}" data-id="${t.id}" ${locked ? 'disabled' : ''}>
        <div class="o-title"><span aria-hidden="true">${t.icon}</span>${esc(t.name)}</div>
        <div class="o-sub">${esc(t.category)} · ${t.duration_min} min</div>
        <div class="o-price">${state.credit && !locked ? '<span class="pill">Package credit</span>' : inr(t.price)}</div>
      </button>`;
    }).join('') || '<p class="muted">No treatments match your search.</p>';
  }
  qs('#treatment-search').addEventListener('input', renderTreatments);
  qs('#treatment-list').addEventListener('click', (e) => {
    const b = e.target.closest('.option');
    if (!b || b.disabled) return;
    selectTreatment(Number(b.dataset.id));
    renderTreatments();
  });

  async function selectTreatment(id) {
    const t = treatments.find((x) => x.id === id);
    if (!t) return;
    if (state.treatment?.id !== id) { state.date = null; state.time = null; }
    state.treatment = t;
    if (!t.modes.includes(state.mode)) state.mode = t.modes[0];
    state.therapists = await api('/therapists', { query: { treatment_id: id } });
    if (state.therapistId !== 'any' && !state.therapists.some((th) => String(th.id) === String(state.therapistId))) state.therapistId = 'any';
    updateSummary();
  }

  qs('#use-credit-btn').addEventListener('click', () => qs('#credit-box').classList.toggle('hidden'));
  qs('#credit-apply').addEventListener('click', async () => {
    const code = qs('#credit-code').value.trim().toUpperCase();
    const phone = qs('#credit-phone').value.trim();
    const out = qs('#credit-status');
    try {
      const c = await api(`/package-credits/${encodeURIComponent(code)}`, { query: { phone } });
      if (c.status !== 'active') throw new Error('This package is not active yet. Complete payment first or contact the clinic.');
      if (c.remaining <= 0) throw new Error('All sessions in this package have been used.');
      state.credit = { ...c, phone };
      state.packageId = null;
      out.innerHTML = `<span style="color:var(--ok)">✓ ${esc(c.package_name)} for ${esc(c.treatment_name)}: <b>${c.remaining}</b> of ${c.sessions_total} sessions left (valid till ${prettyDate(c.expires_on)}).</span>`;
      qs('#f-name').value ||= c.patient_name;
      qs('#f-email').value ||= c.email;
      qs('#f-phone').value = c.phone;
      await selectTreatment(c.treatment_id);
      renderTreatments();
    } catch (err) {
      state.credit = null;
      out.innerHTML = `<span class="error-text">${esc(err.message)}</span>`;
      renderTreatments();
    }
  });

  // ---------- Step 2: mode, therapist, package ----------
  function renderStep2() {
    const t = state.treatment;
    const modeInfo = {
      clinic: ['🏥', 'In-clinic visit', 'Full equipment & electrotherapy'],
      home: ['🏠', 'Home visit', `+ ${inr(S.home_visit_fee)} travel charge`],
      online: ['💻', 'Online video consult', 'From anywhere, link shared on WhatsApp'],
    };
    qs('#mode-list').innerHTML = ['clinic', 'home', 'online'].map((m) => `
      <button type="button" class="option ${state.mode === m ? 'selected' : ''}" data-mode="${m}" ${t.modes.includes(m) ? '' : 'disabled'}>
        <div class="o-title"><span aria-hidden="true">${modeInfo[m][0]}</span>${modeInfo[m][1]}</div>
        <div class="o-sub">${t.modes.includes(m) ? modeInfo[m][2] : 'Not available for this treatment'}</div>
      </button>`).join('');

    const initials = (n) => n.replace(/^Dr\.?\s*/, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
    qs('#therapist-list').innerHTML = `
      <button type="button" class="option ${state.therapistId === 'any' ? 'selected' : ''}" data-th="any">
        <div class="o-title"><span aria-hidden="true">⚡</span>Any available therapist</div>
        <div class="o-sub">Most slots and the earliest appointment</div>
      </button>` + state.therapists.map((th) => `
      <button type="button" class="option ${String(state.therapistId) === String(th.id) ? 'selected' : ''}" data-th="${th.id}">
        <div class="row" style="flex-wrap:nowrap;gap:10px"><div class="avatar sm">${esc(initials(th.name))}</div>
          <div><div class="o-title" style="padding:0">${esc(th.name)}</div><div class="o-sub" style="margin:0">${th.experience_years} yrs · ⭐ ${th.rating.toFixed(1)}</div></div></div>
        <div class="o-sub">${esc(th.title)}<br>🗣️ ${esc(th.languages)}</div>
      </button>`).join('');

    const pkgSection = qs('#package-section');
    pkgSection.classList.toggle('hidden', Boolean(state.credit) || !packages.length);
    qs('#package-list').innerHTML = `
      <button type="button" class="option ${!state.packageId ? 'selected' : ''}" data-pkg="">
        <div class="o-title">Single session</div><div class="o-sub">Pay per visit</div><div class="o-price">${inr(t.price)}</div>
      </button>` + packages.map((p) => {
      const full = t.price * p.sessions;
      const price = full - Math.round((full * p.discount_percent) / 100);
      return `<button type="button" class="option ${state.packageId === p.id ? 'selected' : ''}" data-pkg="${p.id}">
        <div class="o-title">${esc(p.name)}</div>
        <div class="o-sub">${p.sessions} sessions · save ${p.discount_percent}% · valid ${p.validity_days} days</div>
        <div class="o-price">${inr(price)} <s class="muted small">${inr(full)}</s></div>
        <div class="o-sub">${inr(Math.round(price / p.sessions))} per session</div>
      </button>`;
    }).join('');
  }

  qs('#mode-list').addEventListener('click', (e) => {
    const b = e.target.closest('.option');
    if (!b || b.disabled) return;
    state.mode = b.dataset.mode;
    state.time = null;
    renderStep2(); updateSummary();
  });
  qs('#therapist-list').addEventListener('click', (e) => {
    const b = e.target.closest('.option');
    if (!b) return;
    state.therapistId = b.dataset.th;
    state.time = null;
    renderStep2(); updateSummary();
  });
  qs('#package-list').addEventListener('click', (e) => {
    const b = e.target.closest('.option');
    if (!b) return;
    state.packageId = b.dataset.pkg ? Number(b.dataset.pkg) : null;
    renderStep2(); updateSummary();
  });

  // ---------- Step 3: date & time ----------
  const DAYS = 7;
  async function renderDays() {
    const box = qs('#days');
    box.innerHTML = '<div class="spinner" style="grid-column:1/-1"></div>';
    qs('#days-prev').disabled = state.rangeStart <= cfg.today;
    const { days } = await api('/availability/days', {
      query: { treatment_id: state.treatment.id, mode: state.mode, therapist_id: state.therapistId, from: state.rangeStart, days: DAYS },
    });
    qs('#days-next').disabled = days.length < DAYS;
    if (days.length) {
      qs('#days-label').textContent = `${prettyDate(days[0].date, { weekday: undefined, year: undefined })} – ${prettyDate(days[days.length - 1].date, { weekday: undefined })}`;
    }
    box.innerHTML = days.map((d) => {
      const dt = new Date(`${d.date}T00:00:00Z`);
      return `<button type="button" class="day ${d.slots ? '' : 'full'} ${state.date === d.date ? 'selected' : ''}" data-date="${d.date}" ${d.slots ? '' : 'disabled'}>
        <div class="dow">${d.date === cfg.today ? 'Today' : dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })}</div>
        <div class="dnum">${dt.getUTCDate()}</div>
        <div class="small muted">${dt.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}</div>
        <div class="dslots">${d.slots ? `${d.slots} slots` : 'Full'}</div>
      </button>`;
    }).join('') || '<p class="muted" style="grid-column:1/-1">No more dates available.</p>';
    if (!state.date) {
      const first = days.find((d) => d.slots);
      if (first) { state.date = first.date; qs(`.day[data-date="${first.date}"]`)?.classList.add('selected'); }
    }
    if (state.date) renderSlots();
    else qs('#slots-wrap').innerHTML = '<p class="muted">No free slots this week. Try the next week or another therapist.</p>';
  }

  async function renderSlots() {
    const wrap = qs('#slots-wrap');
    wrap.innerHTML = '<div class="spinner"></div>';
    try {
      const { slots } = await api('/availability', {
        query: { treatment_id: state.treatment.id, mode: state.mode, therapist_id: state.therapistId, date: state.date },
      });
      if (!slots.some((s) => s.time === state.time)) state.time = null;
      const groups = [['🌅 Morning', (m) => m < 720], ['☀️ Afternoon', (m) => m >= 720 && m < 1020], ['🌙 Evening', (m) => m >= 1020]];
      const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      wrap.innerHTML = `<p class="small muted" style="margin:14px 0 0">${prettyDate(state.date)}</p>` + (groups.map(([label, fn]) => {
        const g = slots.filter((s) => fn(toMin(s.time)));
        return g.length ? `<div class="slot-group"><h4>${label}</h4><div class="slots">${g.map((s) =>
          `<button type="button" class="slot ${state.time === s.time ? 'selected' : ''}" data-time="${s.time}">${prettyTime(s.time)}</button>`).join('')}</div></div>` : '';
      }).join('') || '<p class="muted">No slots left on this day.</p>');
      updateSummary();
    } catch (err) {
      wrap.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
    }
  }

  qs('#days').addEventListener('click', (e) => {
    const b = e.target.closest('.day');
    if (!b || b.disabled) return;
    state.date = b.dataset.date;
    state.time = null;
    qsa('.day').forEach((d) => d.classList.toggle('selected', d === b));
    renderSlots();
  });
  qs('#slots-wrap').addEventListener('click', (e) => {
    const b = e.target.closest('.slot');
    if (!b) return;
    state.time = b.dataset.time;
    qsa('.slot').forEach((s) => s.classList.toggle('selected', s === b));
    updateSummary();
  });
  qs('#days-prev').addEventListener('click', () => {
    const prev = FX.addDays(state.rangeStart, -DAYS);
    state.rangeStart = prev < cfg.today ? cfg.today : prev;
    renderDays();
  });
  qs('#days-next').addEventListener('click', () => { state.rangeStart = FX.addDays(state.rangeStart, DAYS); renderDays(); });

  // ---------- Step 4: details ----------
  const AREAS = ['Neck', 'Shoulder', 'Upper back', 'Lower back', 'Elbow', 'Wrist/Hand', 'Hip', 'Knee', 'Ankle/Foot', 'Whole body', 'Other'];
  qs('#body-areas').innerHTML = AREAS.map((a) => `<button type="button" class="chip" data-area="${a}">${a}</button>`).join('');
  qs('#body-areas').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const a = b.dataset.area;
    if (state.painArea.has(a)) state.painArea.delete(a); else state.painArea.add(a);
    b.classList.toggle('active');
  });
  const painColor = (n) => `hsl(${120 - n * 12}, 70%, 42%)`;
  qs('#pain-scale').innerHTML = Array.from({ length: 11 }, (_, i) => `<button type="button" data-lvl="${i}" aria-label="Pain level ${i}">${i}</button>`).join('');
  qs('#pain-scale').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.painLevel = Number(b.dataset.lvl);
    qsa('#pain-scale button').forEach((x) => {
      const sel = x === b;
      x.classList.toggle('selected', sel);
      x.style.background = sel ? painColor(state.painLevel) : '';
    });
    const words = ['No pain', 'Very mild', 'Mild', 'Mild', 'Moderate', 'Moderate', 'Moderately severe', 'Severe', 'Very severe', 'Very severe', 'Worst possible'];
    qs('#pain-val').textContent = `${state.painLevel}/10 · ${words[state.painLevel]}`;
  });

  if (me && me.role === 'patient') {
    qs('#f-name').value = me.name;
    qs('#f-email').value = me.email;
    qs('#f-phone').value = me.phone || '';
  } else if (!me) {
    qs('#login-hint').classList.remove('hidden');
  }

  function detailsPayload() {
    const f = qs('#details-form');
    return {
      patient_name: f.patient_name.value.trim(),
      phone: f.phone.value.trim(),
      email: f.email.value.trim(),
      age: f.age.value,
      gender: f.gender.value,
      address: f.address.value.trim(),
      medical_history: f.medical_history.value.trim(),
      notes: f.notes.value.trim(),
      pain_area: [...state.painArea].join(', '),
      pain_level: state.painLevel,
    };
  }

  function validateDetails() {
    const d = detailsPayload();
    const phone = d.phone.replace(/\D/g, '').slice(-10);
    if (d.patient_name.length < 2) return 'Please enter the patient’s full name';
    if (!/^[6-9]\d{9}$/.test(phone)) return 'Please enter a valid 10-digit Indian mobile number';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return 'Please enter a valid email address';
    if (state.mode === 'home' && d.address.length < 10) return 'Please enter your full address for the home visit';
    if (state.credit && phone !== state.credit.phone.replace(/\D/g, '').slice(-10)) return 'Mobile number must match the one registered with your package';
    return null;
  }

  // ---------- Step 5: review, coupon, payment ----------
  function renderReview() {
    const d = detailsPayload();
    const th = state.therapists.find((x) => String(x.id) === String(state.therapistId));
    qs('#review').innerHTML = `<dl class="kv">
      <dt>Treatment</dt><dd>${state.treatment.icon} ${esc(state.treatment.name)}</dd>
      <dt>Visit type</dt><dd>${FX.MODE_ICON[state.mode]} ${FX.MODE_LABEL[state.mode]}</dd>
      <dt>Therapist</dt><dd>${th ? esc(th.name) : 'Any available therapist'}</dd>
      <dt>Date &amp; time</dt><dd>${prettyDate(state.date)}, ${prettyTime(state.time)} IST</dd>
      <dt>Patient</dt><dd>${esc(d.patient_name)} · ${esc(d.phone)}<br><span class="muted small">${esc(d.email)}</span></dd>
      ${state.mode === 'home' ? `<dt>Address</dt><dd>${esc(d.address)}</dd>` : ''}
      ${d.pain_area || d.pain_level !== null ? `<dt>Pain</dt><dd>${esc(d.pain_area || '–')}${d.pain_level !== null ? ` · ${d.pain_level}/10` : ''}</dd>` : ''}
    </dl>`;
    qs('#coupon-wrap').classList.toggle('hidden', Boolean(state.credit));
    renderPayments();
  }

  function renderPayments() {
    const total = state.quote?.total ?? 0;
    const wrap = qs('#payment-wrap');
    wrap.classList.toggle('hidden', total === 0);
    const opts = [];
    if (cfg.payments.online) {
      opts.push(['online', '💳', 'Pay online now', `UPI · GPay · PhonePe · Cards · Netbanking${cfg.payments.online === 'demo' ? ' (demo mode)' : ''}`]);
    }
    if (cfg.payments.pay_at_clinic) {
      opts.push(['clinic', '🏥', state.mode === 'clinic' ? 'Pay at clinic' : 'Pay after session', 'Cash, UPI or card on the day of your visit']);
    }
    if (!opts.some((o) => o[0] === state.payment) && opts.length) state.payment = opts[0][0];
    qs('#pay-list').innerHTML = opts.map(([v, icon, title, sub]) => `
      <button type="button" class="option ${state.payment === v ? 'selected' : ''}" data-pay="${v}">
        <span style="font-size:1.4rem" aria-hidden="true">${icon}</span>
        <span><span class="o-title" style="padding:0">${title}</span><span class="o-sub" style="display:block">${sub}</span></span>
      </button>`).join('');
    qs('#next-btn').textContent = total === 0 ? 'Confirm booking' : state.payment === 'online' ? `Pay ${inr(total)} & confirm` : 'Confirm booking';
  }
  qs('#pay-list').addEventListener('click', (e) => {
    const b = e.target.closest('.option');
    if (!b) return;
    state.payment = b.dataset.pay;
    renderPayments();
  });

  qs('#coupon-apply').addEventListener('click', async () => {
    const code = qs('#coupon').value.trim();
    const msg = qs('#coupon-msg');
    const prev = state.coupon;
    state.coupon = code;
    try {
      await refreshQuote(true);
      msg.innerHTML = code ? `<span style="color:var(--ok)">✓ Coupon applied, you save ${inr(state.quote.coupon_discount)}</span>` : '';
    } catch (err) {
      state.coupon = prev;
      msg.innerHTML = `<span class="error-text">${esc(err.message)}</span>`;
      await refreshQuote().catch(() => {});
    }
    renderPayments();
  });

  // ---------- Summary & pricing ----------
  let quoteSeq = 0;
  async function refreshQuote(throwOnError = false) {
    if (!state.treatment) return;
    const seq = ++quoteSeq;
    try {
      const q = await api('/quote', {
        method: 'POST',
        body: {
          treatment_id: state.treatment.id, mode: state.mode, package_id: state.packageId,
          coupon_code: state.coupon || undefined, package_code: state.credit?.code,
        },
      });
      if (seq === quoteSeq) { state.quote = q; renderSummary(); }
    } catch (err) {
      if (throwOnError) throw err;
      if (state.coupon) { state.coupon = ''; return refreshQuote(); }
    }
  }

  function renderSummary() {
    const t = state.treatment;
    const q = state.quote;
    if (!t) return;
    const th = state.therapists.find((x) => String(x.id) === String(state.therapistId));
    const pkg = packages.find((p) => p.id === state.packageId);
    const line = (k, v, cls = '') => `<div class="summary-line ${cls}"><span>${k}</span><span>${v}</span></div>`;
    qs('#summary').innerHTML = `
      <div class="summary-item"><span class="k">Treatment</span><span>${t.icon} ${esc(t.name)}<br><span class="muted small">${t.duration_min} min</span></span></div>
      <div class="summary-item"><span class="k">Visit</span><span>${FX.MODE_ICON[state.mode]} ${FX.MODE_LABEL[state.mode]}</span></div>
      <div class="summary-item"><span class="k">Therapist</span><span>${th ? esc(th.name) : 'Any available'}</span></div>
      <div class="summary-item"><span class="k">When</span><span>${state.date ? prettyDate(state.date) : '–'}${state.time ? `<br><b>${prettyTime(state.time)}</b>` : ''}</span></div>
      ${state.credit ? `<div class="summary-item"><span class="k">Package</span><span>${esc(state.credit.code)} · ${state.credit.remaining} left</span></div>` : ''}
      ${q ? `<div style="margin-top:12px">
        ${state.credit ? line('Session (package credit)', inr(0)) : line(pkg ? `${esc(pkg.name)} (${q.sessions} × ${inr(q.unit_price)})` : 'Session fee', inr(q.subtotal))}
        ${q.package_discount ? line(`Package discount`, `− ${inr(q.package_discount)}`, 'discount') : ''}
        ${q.coupon_discount ? line(`Coupon ${esc(q.coupon_code)}`, `− ${inr(q.coupon_discount)}`, 'discount') : ''}
        ${q.surcharge ? line('Home visit charge', inr(q.surcharge)) : ''}
        ${q.tax ? line(`GST (${q.gst_percent}%)`, inr(q.tax)) : ''}
        ${line('Total payable', inr(q.total), 'total')}
        <p class="small muted" style="margin:8px 0 0">All prices in Indian Rupees (INR), inclusive of applicable taxes.</p>
      </div>` : ''}`;
  }

  function updateSummary() {
    renderSummary();
    refreshQuote();
  }

  // ---------- Navigation ----------
  function validateStep(n) {
    if (n === 1 && !state.treatment) return 'Please choose a treatment';
    if (n === 3 && (!state.date || !state.time)) return 'Please choose a date and time slot';
    if (n === 4) return validateDetails();
    if (n === 5 && !qs('#agree').checked) return 'Please accept the cancellation policy to continue';
    return null;
  }

  function goTo(n) {
    state.step = n;
    showError('');
    stepEls.forEach((el) => el.classList.toggle('active', Number(el.dataset.step) === n));
    qsa('#stepper li').forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle('current', s === n);
      li.classList.toggle('done', s < n);
    });
    qs('#back-btn').style.visibility = n === 1 ? 'hidden' : 'visible';
    qs('#next-btn').textContent = 'Continue →';
    if (n === 2) renderStep2();
    if (n === 3) renderDays();
    if (n === 5) renderReview();
    qs('.booking-layout').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  qs('#back-btn').addEventListener('click', () => goTo(Math.max(1, state.step - 1)));
  qs('#next-btn').addEventListener('click', async () => {
    const err = validateStep(state.step);
    if (err) return showError(err);
    if (state.step < 5) return goTo(state.step + 1);
    if (state.retryPayment) return state.retryPayment();
    await submit();
  });

  // ---------- Submit & payment ----------
  async function submit() {
    const btn = qs('#next-btn');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Please wait…';
    showError('');
    try {
      const d = detailsPayload();
      const out = await api('/bookings', {
        method: 'POST',
        body: {
          ...d,
          treatment_id: state.treatment.id,
          therapist_id: state.therapistId === 'any' ? null : Number(state.therapistId),
          mode: state.mode, date: state.date, time: state.time,
          package_id: state.packageId, package_code: state.credit?.code,
          coupon_code: state.coupon || undefined,
          payment_method: state.payment,
        },
      });
      const a = out.appointment;
      FX.rememberBooking(a.ref, a.phone);
      const done = () => { location.href = `/manage?ref=${encodeURIComponent(a.ref)}&new=1`; };
      if (!out.payment.required) return done();
      if (out.payment.provider === 'razorpay') return payWithRazorpay(a, out.payment, d, done);
      return demoCheckout(a, done);
    } catch (err) {
      showError(err.message);
      if (err.status === 409) { state.time = null; goTo(3); }
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load payment gateway. Check your internet connection.'));
      document.head.appendChild(s);
    });
  }

  async function payWithRazorpay(a, p, d, done) {
    await loadScript('https://checkout.razorpay.com/v1/checkout.js');
    const rzp = new window.Razorpay({
      key: p.key_id,
      amount: p.amount,
      currency: 'INR',
      name: S.clinic_name,
      description: `${a.treatment_name} · ${a.ref}`,
      order_id: p.order_id,
      prefill: { name: d.patient_name, email: d.email, contact: `+91${a.phone}` },
      notes: { ref: a.ref },
      theme: { color: '#0f766e' },
      handler: async (resp) => {
        try {
          await api(`/bookings/${a.ref}/verify-payment`, { method: 'POST', body: resp });
          done();
        } catch (err) {
          showError(err.message);
        }
      },
      modal: {
        ondismiss: () => showError(`Payment not completed. Your slot is held for ${S.pending_payment_ttl_min} minutes. Click the button again to retry, or choose "Pay at clinic".`),
      },
    });
    rzp.on('payment.failed', (r) => showError(`Payment failed: ${r.error?.description || 'please try again'}`));
    // Retrying reopens the same order rather than creating a second booking.
    state.retryPayment = () => rzp.open();
    rzp.open();
  }

  function demoCheckout(a, done) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal demo-pay" role="dialog" aria-modal="true" aria-label="Payment">
      <div class="alert alert-warn small">Demo payment gateway: no real money is charged. Configure Razorpay keys to accept real payments.</div>
      <div class="muted">${esc(S.clinic_name)} · ${esc(a.ref)}</div>
      <div class="amount">${inr(a.total)}</div>
      <div class="upi-methods">
        <button class="option selected" type="button">📱 UPI</button>
        <button class="option" type="button">💳 Card</button>
        <button class="option" type="button">🏦 Netbanking</button>
      </div>
      <button class="btn btn-primary btn-block btn-lg" id="demo-pay-btn">Pay ${inr(a.total)}</button>
      <button class="btn btn-ghost btn-block" id="demo-cancel" style="margin-top:8px">Cancel</button>
    </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('.upi-methods').addEventListener('click', (e) => {
      const b = e.target.closest('.option');
      if (b) wrap.querySelectorAll('.upi-methods .option').forEach((x) => x.classList.toggle('selected', x === b));
    });
    wrap.querySelector('#demo-cancel').addEventListener('click', () => {
      wrap.remove();
      showError(`Payment not completed. Your slot is held for ${S.pending_payment_ttl_min} minutes. You can pay from the Manage booking page.`);
      setTimeout(done, 2500);
    });
    wrap.querySelector('#demo-pay-btn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Processing…';
      try {
        await api(`/bookings/${a.ref}/demo-pay`, { method: 'POST', body: { phone: a.phone } });
        done();
      } catch (err) {
        wrap.remove();
        showError(err.message);
      }
    });
  }

  // ---------- Init ----------
  renderTreatments();
  const preTreatment = Number(params.get('treatment'));
  if (preTreatment && treatments.some((t) => t.id === preTreatment)) {
    await selectTreatment(preTreatment);
    renderTreatments();
    goTo(2);
  } else if (params.get('therapist') || params.get('package')) {
    goTo(1);
    const pick = params.get('therapist') ? 'Pick a treatment to see this therapist’s availability.' : 'Pick the treatment you want this package for.';
    qs('#treatment-list').insertAdjacentHTML('beforebegin', `<div class="alert alert-info small">${pick}</div>`);
  } else {
    goTo(1);
  }
  if (params.get('credit')) {
    qs('#credit-box').classList.remove('hidden');
    qs('#credit-code').value = params.get('credit');
    qs('#credit-phone').value = FX.recallBooking(params.get('credit')) || '';
  }
})().catch((err) => FX.toast(err.message, 'error'));
