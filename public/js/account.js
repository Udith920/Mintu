(async function () {
  const { api, inr, esc, qs, qsa, prettyDate, prettyTime } = FX;
  const next = new URLSearchParams(location.search).get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const me = await FX.me();

  if (me && me.role !== 'patient') { location.href = '/admin'; return; }
  if (!me) return showAuth();
  showDash(me);

  function showAuth() {
    qs('#auth').classList.remove('hidden');
    qsa('#auth .tab').forEach((t) => t.addEventListener('click', () => {
      qsa('#auth .tab').forEach((x) => x.classList.toggle('active', x === t));
      qs('#login-form').classList.toggle('hidden', t.dataset.tab !== 'login');
      qs('#register-form').classList.toggle('hidden', t.dataset.tab !== 'register');
    }));
    const done = (u) => { location.href = u.role === 'patient' ? (safeNext || '/account') : '/admin'; };
    qs('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      qs('#login-err').textContent = '';
      try {
        done(await api('/auth/login', { method: 'POST', body: { email: e.target.email.value, password: e.target.password.value } }));
      } catch (err) { qs('#login-err').textContent = err.message; }
    });
    qs('#register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      qs('#register-err').textContent = '';
      const f = e.target;
      try {
        done(await api('/auth/register', { method: 'POST', body: { name: f.name.value, phone: f.phone.value, email: f.email.value, password: f.password.value } }));
      } catch (err) { qs('#register-err').textContent = err.message; }
    });
  }

  async function showDash(user) {
    qs('#dash').classList.remove('hidden');
    qs('#hello').textContent = `Hello, ${user.name.split(' ')[0]} 👋`;
    qs('#profile-kv').innerHTML = `<dt>Name</dt><dd>${esc(user.name)}</dd><dt>Email</dt><dd>${esc(user.email)}</dd><dt>Mobile</dt><dd>${esc(user.phone || '–')}</dd>`;
    qsa('#dash .tab').forEach((t) => t.addEventListener('click', () => {
      qsa('#dash .tab').forEach((x) => x.classList.toggle('active', x === t));
      ['upcoming', 'past', 'packages', 'profile'].forEach((k) => qs(`#dtab-${k}`).classList.toggle('hidden', t.dataset.dtab !== k));
    }));
    qs('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/auth/change-password', { method: 'POST', body: { current_password: qs('#pw-cur').value, new_password: qs('#pw-new').value } });
        e.target.reset();
        FX.toast('Password updated');
      } catch (err) { FX.toast(err.message, 'error'); }
    });

    const [bookings, packages, cfg] = await Promise.all([api('/auth/my-bookings'), api('/auth/my-packages'), FX.config()]);
    bookings.forEach((b) => FX.rememberBooking(b.ref, b.phone));
    const isUpcoming = (b) => ['confirmed', 'pending_payment'].includes(b.status) && b.date >= cfg.today;
    const item = (b) => `<div class="list-item">
      <div class="row" style="flex-wrap:nowrap;align-items:flex-start">
        <div style="font-size:1.6rem" aria-hidden="true">${b.treatment_icon}</div>
        <div><b>${esc(b.treatment_name)}</b> ${FX.badge(b.status)}<br>
          <span class="small">${prettyDate(b.date)} · ${prettyTime(b.start_time)} · ${FX.MODE_LABEL[b.mode]}</span><br>
          <span class="small muted">${esc(b.therapist_name)} · ${esc(b.ref)} · ${inr(b.total)} ${b.payment_status === 'paid' ? '(paid)' : ''}</span></div>
      </div>
      <a class="btn btn-ghost btn-sm" href="/manage?ref=${b.ref}">View${b.can_reschedule ? ' / reschedule' : ''}</a>
    </div>`;
    const upcoming = bookings.filter(isUpcoming).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
    const past = bookings.filter((b) => !isUpcoming(b));
    qs('#dtab-upcoming').innerHTML = upcoming.map(item).join('') || '<div class="empty">No upcoming appointments.<br><a class="btn btn-primary btn-sm" style="margin-top:12px" href="/book">Book now</a></div>';
    qs('#dtab-past').innerHTML = past.map(item).join('') || '<div class="empty">Nothing here yet.</div>';
    qs('#dtab-packages').innerHTML = packages.map((p) => {
      const left = p.sessions_total - p.sessions_used;
      return `<div class="list-item"><div><b>${esc(p.package_name)}</b> · ${esc(p.treatment_name)}<br>
        <span class="small muted">Code ${esc(p.code)} · ${left} of ${p.sessions_total} sessions left · valid till ${prettyDate(p.expires_on)} · ${p.status}</span></div>
        ${left > 0 && p.status === 'active' && p.expires_on >= cfg.today ? `<a class="btn btn-primary btn-sm" data-credit="${esc(p.code)}" data-phone="${esc(p.phone)}" href="/book?credit=${encodeURIComponent(p.code)}">Book session</a>` : ''}</div>`;
    }).join('') || '<div class="empty">You have no packages. Save up to 18% with a <a href="/#packages">recovery package</a>.</div>';
    qsa('[data-credit]').forEach((a) => FX.rememberBooking(a.dataset.credit, a.dataset.phone));
  }
})().catch((err) => FX.toast(err.message, 'error'));
