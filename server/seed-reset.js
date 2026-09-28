// Deletes the local database and recreates it with the default treatments, therapists, coupons and admin.
// Usage: npm run seed   (DANGER: removes all bookings)
const fs = require('fs');
const config = require('./config');
const { openDb } = require('./db');

for (const suffix of ['', '-wal', '-shm']) {
  const f = config.dbFile + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
openDb().close();
console.log(`Database reset at ${config.dbFile}`);
