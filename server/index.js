const config = require('./config');
const { openDb } = require('./db');
const { createApp, startJobs } = require('./app');
const razorpay = require('./lib/razorpay');

const db = openDb();
const app = createApp(db);
startJobs(db);

const server = app.listen(config.port, () => {
  console.log(`Flexura Physio Care booking system running at ${config.baseUrl} (port ${config.port})`);
  console.log(`  Online payments: ${razorpay.isEnabled() ? 'Razorpay' : config.paymentDemo ? 'DEMO mode (no real money)' : 'disabled (pay at clinic only)'}`);
  console.log(`  Email: ${config.smtp.host ? `SMTP via ${config.smtp.host}` : 'SMTP not configured (emails logged to console)'}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
