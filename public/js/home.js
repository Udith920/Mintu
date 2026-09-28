(async function () {
  const { api, inr, esc, qs, qsa } = FX;
  const [treatments, therapists, packages, cfg] = await Promise.all([
    api('/treatments'), api('/therapists'), api('/packages'), FX.config(),
  ]);
  const s = cfg.settings;
  qsa('[data-cancel-hours]').forEach((el) => { el.textContent = s.cancel_window_hours; });
  qsa('[data-home-fee]').forEach((el) => { el.textContent = inr(s.home_visit_fee); });

  // ----- Services -----
  const categories = ['All', ...new Set(treatments.map((t) => t.category))];
  let current = 'All';
  const chips = qs('#category-chips');
  chips.innerHTML = categories.map((c) => `<button class="chip ${c === 'All' ? 'active' : ''}" role="tab" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    current = b.dataset.cat;
    qsa('.chip', chips).forEach((c) => c.classList.toggle('active', c === b));
    renderServices();
  });

  function renderServices() {
    const list = treatments.filter((t) => current === 'All' || t.category === current);
    qs('#service-grid').innerHTML = list.map((t) => `
      <article class="service ${t.popular ? 'popular-tag' : ''}">
        <div class="icon" aria-hidden="true">${t.icon}</div>
        <h3>${esc(t.name)}</h3>
        <p>${esc(t.description)}</p>
        <div class="tags">${t.modes.map((m) => `<span class="pill">${FX.MODE_ICON[m]} ${FX.MODE_LABEL[m]}</span>`).join('')}</div>
        <div class="meta" style="margin-top:14px">
          <div><div class="price">${inr(t.price)}</div><small class="muted">${t.duration_min} min session</small></div>
          <a class="btn btn-primary btn-sm" href="/book?treatment=${t.id}">Book</a>
        </div>
      </article>`).join('');
  }
  renderServices();

  // ----- Team -----
  const initials = (n) => n.replace(/^Dr\.?\s*/, '').split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  qs('#team-grid').innerHTML = therapists.map((th) => `
    <article class="card">
      <div class="row" style="flex-wrap:nowrap">
        <div class="avatar">${esc(initials(th.name))}</div>
        <div><h3 style="margin:0">${esc(th.name)}</h3><div class="muted small">${esc(th.title)}</div></div>
      </div>
      <p class="small" style="margin-top:12px">${esc(th.bio)}</p>
      <div class="small muted">🎓 ${esc(th.qualifications)}<br>⏳ ${th.experience_years} years · ⭐ ${th.rating.toFixed(1)}<br>🗣️ ${esc(th.languages)}</div>
      <div class="tags">${th.specializations.filter((x) => x !== 'Assessment' && x !== 'Tele-Physio').map((x) => `<span class="pill">${esc(x)}</span>`).join('')}</div>
      <a class="btn btn-ghost btn-sm btn-block" style="margin-top:14px" href="/book?therapist=${th.id}">Book with ${esc(th.name.split(' ').slice(0, 2).join(' '))}</a>
    </article>`).join('');

  // ----- Packages -----
  const ref = treatments.find((t) => t.slug === 'back-neck-pain') || treatments[0];
  qs('#pkg-grid').innerHTML = packages.map((p) => {
    const full = ref.price * p.sessions;
    const price = full - Math.round((full * p.discount_percent) / 100);
    return `<article class="card pkg">
      <span class="pill">${p.sessions} sessions</span>
      <h3 style="margin-top:12px">${esc(p.name)}</h3>
      <p class="muted small">Valid for ${p.validity_days} days. Works with any single treatment of your choice.</p>
      <div class="price">Save ${p.discount_percent}%</div>
      <p class="small">e.g. ${esc(ref.name)}: <s class="muted">${inr(full)}</s> <b>${inr(price)}</b> <span class="save">(save ${inr(full - price)})</span></p>
      <a href="/book?package=${p.id}" class="btn btn-primary btn-sm">Choose package</a>
    </article>`;
  }).join('') || '<p class="muted">No packages at the moment.</p>';

  // ----- Quick book -----
  const sel = qs('#qb-treatment');
  sel.innerHTML = treatments.map((t) => `<option value="${t.id}">${t.icon} ${esc(t.name)}</option>`).join('');
  const modeSel = qs('#qb-mode');
  function updateQuick() {
    const t = treatments.find((x) => String(x.id) === sel.value);
    [...modeSel.options].forEach((o) => { o.disabled = !t.modes.includes(o.value); });
    if (!t.modes.includes(modeSel.value)) modeSel.value = t.modes[0];
    const fee = modeSel.value === 'home' ? s.home_visit_fee : 0;
    qs('#qb-price').innerHTML = `<span>${t.duration_min} min${fee ? ` + home visit ${inr(fee)}` : ''}</span><span>${inr(t.price + fee)}</span>`;
  }
  sel.addEventListener('change', updateQuick);
  modeSel.addEventListener('change', updateQuick);
  updateQuick();
  qs('#qb-go').addEventListener('click', () => {
    location.href = `/book?treatment=${sel.value}&mode=${modeSel.value}`;
  });
})().catch((err) => FX.toast(err.message, 'error'));
