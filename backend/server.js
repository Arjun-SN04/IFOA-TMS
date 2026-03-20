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

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    process.env.FRONTEND_URL,        // set this in Render env vars if needed
  ].filter(Boolean),
  credentials: true,
}));
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

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../frontend/dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📡 Database status: ${dbConnected ? 'connected' : 'offline'}`);
  });
}, 100);
