# Flexura Physio Care: Appointment Booking System

An end-to-end online appointment booking system for **Flexura Physio Care**. It covers every kind of physiotherapy treatment, with all pricing in **Indian Rupees (₹ INR)**.

It is one Node.js app: an Express REST API, a SQLite database and a responsive HTML/CSS/JS frontend. There is no build step, so it is easy to host anywhere.

---

## Features

### Patient website
| Feature | Details |
|---|---|
| **Treatment catalogue** | 18 physiotherapy services: assessment, back and neck, knee and joint, frozen shoulder, sports injury, post-surgical, neuro, paediatric, geriatric, women's health, cardio-pulmonary, dry needling, cupping, manual therapy, kinesio taping, electrotherapy, ergonomics, tele-physio. Prices in ₹ with Indian digit grouping (₹1,00,000). |
| **5-step booking wizard** | Treatment → visit type and therapist → date and time → patient details and pain assessment → review and pay. A live price summary stays visible throughout. |
| **Real-time availability** | Slots are built from each therapist's weekly hours and breaks, clinic holidays, therapist leave and existing bookings. The 7-day strip shows how many slots each day has. |
| **Double-booking protection** | Booking runs in a database transaction, backed by a unique index. |
| **3 visit types** | In-clinic, home visit (extra ₹ charge plus a travel buffer blocked in the therapist's calendar) and online video consult. |
| **"Any available therapist"** | Picks the least-busy qualified therapist automatically. Therapists are matched to treatments by specialisation. |
| **Multi-session packages** | For example 5 sessions at 10% off or 10 sessions at 18% off. Each package gets a code (`PK-XXXXXX`) that the patient uses to book the remaining sessions. |
| **Coupons** | Percentage or flat ₹, with minimum order, maximum discount, usage limit and expiry. |
| **Server-side pricing** | Subtotal − package discount − coupon + home-visit charge + optional GST. Prices are never trusted from the browser. |
| **Payments** | **Razorpay** (UPI / GPay / PhonePe / cards / netbanking) with signature verification and webhook, or **pay at clinic**. Online payments hold the slot for 15 minutes. |
| **Manage booking** | Look up by booking reference + mobile number. Reschedule, cancel (with a configurable free-cancellation window), download `.ics` calendar file, print receipt or invoice, WhatsApp the clinic. |
| **Patient accounts** | Register or log in to see upcoming and past bookings and packages. Earlier guest bookings with the same email appear automatically. |
| **Notifications** | Confirmation (with calendar attachment), reschedule, cancellation and **automatic 24-hour reminder** emails. The clinic also gets an email for each new booking. |
| **Mobile friendly** | Responsive layout, accessible forms and a floating WhatsApp button. |

### Admin and therapist portal (`/admin`)
| Feature | Details |
|---|---|
| **Dashboard** | Today's appointments, next 7 days, month's revenue in ₹, amount still to collect, cancellation and no-show rates, pending refunds, 30-day revenue chart, top treatments, visit-type split. |
| **Appointments** | Search and filter by date, status, therapist and visit type. Open a booking to view the patient's pain assessment and history; mark completed or no-show; record payment; mark refunded; add clinical notes; reschedule; cancel. **Export to CSV/Excel.** |
| **Day calendar** | One column per therapist, showing working hours, breaks, leave and home-visit travel buffers. |
| **Treatments and prices** | Add or edit treatments, ₹ price, duration and allowed visit types. |
| **Therapists and hours** | Profiles, specialisations and weekly schedule with breaks. |
| **Holidays and leave** | Block the whole clinic or one therapist for a date. |
| **Coupons and packages** | Full management, plus a list of sold packages and sessions used. |
| **Staff logins** | Therapist logins see **only their own** appointments. Admins have full access. |
| **Clinic settings** | Name, contact details, WhatsApp, address, home-visit fee, GST % and GSTIN, slot interval, booking window, same-day notice, cancellation window, payment-hold time. |

### Security
- Passwords hashed with bcrypt. Sessions use JWT in an httpOnly cookie.
- Helmet security headers with a strict Content Security Policy.
- Rate limiting on login and booking endpoints.
- Input validation for Indian mobile numbers and emails.
- Role-based access: patient / therapist / admin.
- Razorpay payment and webhook signatures are verified with HMAC-SHA256.

---

## Run locally

Requirements: **Node.js 18.18+** (Node 20 or 22 recommended).

```bash
npm install
cp .env.example .env        # then edit values (optional for local testing)
npm start
```

Open:
- Website: <http://localhost:3000>
- Admin portal: <http://localhost:3000/admin>. The default login is `admin@flexuraphysio.in` / `Admin@12345` unless you set `ADMIN_EMAIL` / `ADMIN_PASSWORD`. **Change it after the first login.**

With `PAYMENT_DEMO=true` and no Razorpay keys, a **demo payment screen** appears so you can try the full online-payment flow without real money.

Other commands:
```bash
npm test         # API tests (booking, pricing, payments, packages, admin, roles)
npm run dev      # auto-restart on file changes
npm run seed     # ⚠️ deletes the database and recreates the default data
```

---

## Going live checklist

1. **Set `JWT_SECRET`** to a long random string and **`ADMIN_PASSWORD`** to a strong password.
2. **Set `BASE_URL`** to your domain (e.g. `https://book.flexuraphysio.in`) so email links work.
3. **Razorpay:** create an account at <https://razorpay.com>, complete KYC and copy the **Key ID / Key Secret** into `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. Set `PAYMENT_DEMO=false`.
   - Optional but recommended: in the Razorpay dashboard, add a webhook to `https://YOUR-DOMAIN/api/payments/razorpay-webhook` for the events `payment.captured` and `order.paid`, and put its secret in `RAZORPAY_WEBHOOK_SECRET`. This confirms bookings even if the patient closes the browser right after paying.
4. **Email:** fill in the `SMTP_*` settings. Any SMTP provider works (Gmail with an App Password, Zoho Mail, Brevo, SendGrid, Amazon SES).
5. **Clinic details:** log in to `/admin` → **Clinic settings** and update the address, phone, WhatsApp number, home-visit fee and so on. Adjust treatments, prices and therapist hours to match your clinic.
6. **Persistent storage:** the SQLite database file (`DB_FILE`) **must live on a persistent disk or volume**, otherwise bookings are lost when the server restarts.
7. **Backups:** copy the `.db` file regularly (e.g. a daily cron job: `sqlite3 flexura.db ".backup backup-$(date +%F).db"`).

---

## Hosting options

### Option A: Render (easiest)
1. Push this repository to GitHub.
2. On <https://render.com>: **New → Blueprint**, then select the repo. `render.yaml` sets up the web service **with a 1 GB persistent disk** (Starter plan, because free instances have no persistent disk).
3. Fill in the environment variables it asks for (`BASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, Razorpay, SMTP).
4. Add your custom domain under **Settings → Custom Domains**.

### Option B: Railway
1. **New Project → Deploy from GitHub repo**. Railway detects the `Dockerfile`.
2. Add a **Volume** mounted at `/data` (the Dockerfile already sets `DB_FILE=/data/flexura.db`).
3. Add the environment variables from `.env.example`.

### Option C: Any VPS (DigitalOcean, AWS Lightsail, Hostinger VPS, etc.) with Docker
```bash
git clone <your-repo> flexura && cd flexura
cp .env.example .env && nano .env      # set your values
docker compose up -d --build
```
Put Nginx or Caddy in front for HTTPS. For example, a Caddyfile:
```
book.flexuraphysio.in {
    reverse_proxy localhost:3000
}
```

### Option D: VPS without Docker
```bash
npm ci --omit=dev
npm install -g pm2
pm2 start server/index.js --name flexura
pm2 save && pm2 startup
```

> **Shared hosting / static hosts (Netlify, GitHub Pages, Vercel static)** won't work on their own. The app needs a running Node.js server and a writable disk.

---

## Project structure

```
server/
  index.js              # entry point (starts HTTP server + background jobs)
  app.js                # Express app, security headers, routes, Razorpay webhook
  config.js             # environment configuration
  db.js                 # SQLite schema + seed data (treatments, therapists, packages, coupons)
  lib/
    availability.js     # slot engine (hours, breaks, leave, buffers, lead time)
    bookings.js         # create / pay / cancel / reschedule / expire / reminders
    pricing.js          # INR price calculation, coupons, packages, GST
    razorpay.js         # order creation + signature verification
    mailer.js           # HTML emails (SMTP or console)
    ics.js              # calendar invites
    auth.js, settings.js, time.js (IST helpers), format.js
  routes/
    public.js           # catalogue, availability, quote, bookings, payments
    auth.js             # register / login / my bookings
    admin.js            # dashboard, appointments, calendar, CRUD, settings, CSV
public/
  index.html            # home page: treatments & prices, team, packages, FAQ
  book.html             # booking wizard
  manage.html           # booking confirmation / manage / receipt
  account.html          # patient login, register, dashboard
  admin.html            # admin & therapist portal
  css/styles.css, js/*.js
tests/api.test.js       # end-to-end API tests
```

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/config` | Clinic info, payment options, today's date (IST) |
| GET | `/api/treatments` · `/api/therapists?treatment_id=` · `/api/packages` | Catalogue |
| GET | `/api/availability?treatment_id&date&mode&therapist_id` | Free slots for a day |
| GET | `/api/availability/days?treatment_id&mode&therapist_id&from&days` | Slot counts per day |
| POST | `/api/quote` | Price breakdown (validates coupon) |
| POST | `/api/bookings` | Create booking |
| GET | `/api/bookings/:ref?phone=` | View booking |
| POST | `/api/bookings/:ref/cancel` · `/reschedule` · `/verify-payment` | Manage booking |
| GET | `/api/bookings/:ref/ics?phone=` | Calendar file |
| POST | `/api/payments/razorpay-webhook` | Razorpay webhook |
| * | `/api/auth/*` | Register, login, logout, my bookings/packages |
| * | `/api/admin/*` | Staff-only management API |

All times are **Indian Standard Time (IST)** and all amounts are whole **Indian Rupees**.
