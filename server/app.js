const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { loadUser } = require('./lib/auth');
const B = require('./lib/bookings');
const razorpay = require('./lib/razorpay');

function createApp(db) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
        frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://www.google.com'],
        connectSrc: ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Razorpay webhook needs the raw body for signature verification (registered before the JSON parser).
  app.post('/api/payments/razorpay-webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    if (!razorpay.verifyWebhookSignature(req.body, req.get('x-razorpay-signature'))) return res.status(400).json({ error: 'Bad signature' });
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad payload' }); }
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const payment = event.payload?.payment?.entity;
      const orderId = payment?.order_id || event.payload?.order?.entity?.id;
      const appt = orderId && db.prepare('SELECT id FROM appointments WHERE razorpay_order_id = ?').get(orderId);
      if (appt) B.markPaid(db, B.getById(db, appt.id), { paymentId: payment?.id || null, method: 'online' });
    }
    res.json({ ok: true });
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadUser(db));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/admin', require('./routes/admin')(db));
  app.use('/api', require('./routes/public')(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: '1h' }));
  app.use((_req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message });
  });

  return app;
}

function startJobs(db) {
  const run = async () => {
    try {
      B.expirePending(db);
      await B.sendDueReminders(db);
    } catch (err) {
      console.error('[jobs]', err);
    }
  };
  run();
  const timer = setInterval(run, 5 * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { createApp, startJobs };
