/* Shared helpers for every page. */
(function () {
  const FX = {};

  FX.api = async function api(path, { method = 'GET', body, query } = {}) {
    let url = `/api${path}`;
    if (query) {
      const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
      if ([...qs].length) url += `?${qs}`;
    }
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  };

  FX.inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  FX.prettyDate = (d, opts = {}) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC', ...opts,
  });

  FX.prettyTime = (t) => {
    const [h, m] = t.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };

  FX.addDays = (d, n) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };

  FX.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  FX.MODE_LABEL = { clinic: 'In-clinic', home: 'Home visit', online: 'Online video' };
  FX.MODE_ICON = { clinic: '🏥', home: '🏠', online: '💻' };
  FX.STATUS_LABEL = {
    pending_payment: 'Awaiting payment', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show',
  };
  FX.PAY_LABEL = { unpaid: 'Unpaid', paid: 'Paid', refund_pending: 'Refund pending', refunded: 'Refunded' };

  FX.badge = (status) => `<span class="badge badge-${status}">${FX.STATUS_LABEL[status] || FX.PAY_LABEL[status] || status}</span>`;

  FX.qs = (sel, root = document) => root.querySelector(sel);
  FX.qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

  FX.toast = (msg, type = 'ok') => {
    let box = FX.qs('#toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 4200);
  };

  let configPromise = null;
  FX.config = () => (configPromise ||= FX.api('/config'));

  let mePromise = null;
  FX.me = (fresh = false) => {
    if (fresh || !mePromise) mePromise = FX.api('/auth/me').catch(() => null);
    return mePromise;
  };

  FX.logout = async () => {
    await FX.api('/auth/logout', { method: 'POST' });
    location.href = '/';
  };

  FX.whatsappLink = (number, text) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

  // Remember phone numbers for bookings made in this browser (so the manage page can auto-load).
  FX.rememberBooking = (ref, phone) => {
    try {
      const m = JSON.parse(localStorage.getItem('fx_bookings') || '{}');
      m[ref] = phone;
      localStorage.setItem('fx_bookings', JSON.stringify(m));
    } catch { /* storage unavailable */ }
  };
  FX.recallBooking = (ref) => {
    try { return JSON.parse(localStorage.getItem('fx_bookings') || '{}')[ref] || ''; } catch { return ''; }
  };

  async function renderChrome() {
    const header = FX.qs('#site-header');
    const [cfg, me] = await Promise.all([FX.config().catch(() => null), FX.me()]);
    const s = cfg?.settings || { clinic_name: 'Flexura Physio Care' };
    const page = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/index';
    const link = (href, label) => `<a href="${href}" class="${page === href.replace('.html', '') || (href === '/' && page === '/index') ? 'active' : ''}">${label}</a>`;
    if (header) {
      const accountLink = me
        ? (me.role === 'patient' ? link('/account', `👤 ${FX.esc(me.name.split(' ')[0])}`) : link('/admin', '🛠️ Admin portal'))
        : link('/account', 'Login');
      header.innerHTML = `
        <div class="container nav">
          <a href="/" class="brand" aria-label="${FX.esc(s.clinic_name)} home">
            <span class="brand-mark">F</span>
            <span><strong>Flexura</strong> <span class="brand-sub">Physio Care</span></span>
          </a>
          <button class="nav-toggle" aria-label="Menu" aria-expanded="false">☰</button>
          <nav class="nav-links">
            ${link('/', 'Home')}
            <a href="/#services">Treatments</a>
            <a href="/#therapists">Our team</a>
            ${link('/manage', 'Manage booking')}
            ${accountLink}
            ${me ? '<button class="linklike" id="logout-btn">Logout</button>' : ''}
            <a href="/book" class="btn btn-primary btn-sm">Book appointment</a>
          </nav>
        </div>`;
      FX.qs('.nav-toggle', header).addEventListener('click', (e) => {
        const open = header.classList.toggle('open');
        e.currentTarget.setAttribute('aria-expanded', String(open));
      });
      FX.qs('#logout-btn', header)?.addEventListener('click', FX.logout);
    }
    const footer = FX.qs('#site-footer');
    if (footer && cfg) {
      footer.innerHTML = `
        <div class="container footer-grid">
          <div>
            <div class="brand"><span class="brand-mark">F</span><span><strong>Flexura</strong> <span class="brand-sub">Physio Care</span></span></div>
            <p class="muted">${FX.esc(s.tagline)}</p>
            <p class="muted small">Registered physiotherapy clinic. All prices in Indian Rupees (₹).</p>
          </div>
          <div>
            <h4>Visit us</h4>
            <p class="muted small">${FX.esc(s.address)}</p>
            <a href="${FX.esc(s.maps_url)}" target="_blank" rel="noopener" class="small">Get directions →</a>
          </div>
          <div>
            <h4>Contact</h4>
            <p class="small"><a href="tel:${FX.esc(s.phone.replace(/\s/g, ''))}">📞 ${FX.esc(s.phone)}</a><br>
            <a href="mailto:${FX.esc(s.email)}">✉️ ${FX.esc(s.email)}</a></p>
            <p class="muted small">Mon–Sat 8:00 AM – 8:00 PM<br>Sun 9:00 AM – 1:00 PM</p>
          </div>
        </div>
        <div class="container footer-bottom small muted">© ${new Date().getFullYear()} ${FX.esc(s.clinic_name)}. All rights reserved.</div>`;
    }
    if (cfg?.settings?.whatsapp && !FX.qs('.wa-float') && !document.body.dataset.noWa) {
      const a = document.createElement('a');
      a.className = 'wa-float';
      a.href = FX.whatsappLink(cfg.settings.whatsapp, 'Hi Flexura Physio Care, I would like to know more about your treatments.');
      a.target = '_blank';
      a.rel = 'noopener';
      a.setAttribute('aria-label', 'Chat on WhatsApp');
      a.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M20.5 3.5A11.8 11.8 0 0 0 1.9 17.7L.3 23.7l6.1-1.6A11.8 11.8 0 0 0 20.5 3.5ZM12.1 21.4c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.6.9 1-3.5-.2-.4a9.8 9.8 0 1 1 8.2 4.6Zm5.4-7.3c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1l-.9 1.2c-.2.2-.3.2-.6.1a8 8 0 0 1-4-3.5c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.8.4 3.5 3.5 0 0 0-1.1 2.6c0 1.5 1.1 3 1.3 3.2s2.2 3.3 5.2 4.6c1.9.8 2.7.9 3.6.8.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4l-.5-.3Z"/></svg>';
      document.body.appendChild(a);
    }
  }

  document.addEventListener('DOMContentLoaded', renderChrome);
  window.FX = FX;
})();
