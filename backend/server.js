// Force Google public DNS so MongoDB Atlas SRV lookups work on
// corporate/restrictive networks whose DNS blocks SRV records.
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

// ── Auto-fix: ensure Dispatch_graduate.pdf and HumanFactors.pdf exist ──────────
// If they were deleted or are missing, copy from recurrent (same green design)
(function ensureGreenTemplates() {
  const root = path.join(__dirname, '..');
  const src  = path.join(root, 'recurrent_training_with_modules.pdf');
  const targets = ['Dispatch_graduate.pdf', 'HumanFactors.pdf'];
  if (!fs.existsSync(src)) return;
  targets.forEach(name => {
    const dst = path.join(root, name);
    if (!fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      console.log(`[startup] Created missing template: ${name}`);
    }
  });
})();

// Clear any cached models so nodemon restarts start completely fresh
// This prevents stale pre-save hook stacking across hot reloads
delete mongoose.models.Participant;
delete mongoose.models.Admin;
delete mongoose.models.Airline;
delete mongoose.models.CertCounter;

// Register all models fresh
require('./models/Admin');
require('./models/Airline');
require('./models/Participant');
require('./models/CertCounter');

const { initDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS: allow ALL origins.
// Security is enforced via JWT tokens on every protected route,
// not by restricting which domains can call the API.
app.use(cors({
  origin: true,               // reflect the request origin — allows any domain
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Handle preflight OPTIONS requests for every route
app.options('*', cors({ origin: true, credentials: true }));
app.use(express.json());

let dbConnected = false;

app.get('/api/health', (req, res) => {
  res.json({ 
    status: dbConnected ? 'ok' : 'degraded',
    database: dbConnected ? 'connected' : 'offline',
    timestamp: new Date().toISOString() 
  });
});

// Start DB initialization but don't block server startup
initDB()
  .then(() => {
    dbConnected = true;
    console.log('✅ Database initialization complete');
  })
  .catch((err) => {
    dbConnected = false;
    console.warn('⚠️  Server starting in offline mode (database unavailable)');
    console.warn('   Some API endpoints may not work until database is reachable');
  });

// Setup routes immediately (they'll handle offline state)
setTimeout(() => {
  const participantsRouter    = require('./routes/participants');
  const certificatesRouter    = require('./routes/certificates');
  const notificationsRouter   = require('./routes/notifications');
  const { router: authRouter } = require('./routes/auth');

  app.use('/api/auth', authRouter);
  app.use('/api/participants', participantsRouter);
  app.use('/api/certificates', certificatesRouter);
  app.use('/api/notifications', notificationsRouter);

  // Frontend is served separately (localhost in dev, or its own host in prod).
  // The backend is API-only — do NOT serve static files from here.

  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📡 Database status: ${dbConnected ? 'connected' : 'offline'}`);
  });
}, 100);
