#!/usr/bin/env node
/**
 * sync-cert-counters.js
 *
 * ONE-TIME (but safe to re-run) fix script.
 *
 * Problem:
 *   CertCounter.high_water values are out of sync with the actual
 *   cert_sequence numbers on participant documents.
 *   e.g. NDG has issued sequences up to #42 but high_water is stuck
 *   at 1, so the Reset Modal shows #00001 instead of #00042.
 *
 * Fix:
 *   For every training type, query the highest cert_sequence currently
 *   held by any participant and set high_water to that value.
 *   Safe to re-run: never decreases high_water, never touches participant records.
 *
 * Usage (run from the backend folder):
 *   node sync-cert-counters.js
 */

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const mongoose = require('mongoose');

const TYPES = ['FDI', 'FDA', 'FDR', 'FTL', 'NDG', 'HF', 'GD', 'TCD'];

async function main() {
  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) {
    console.error('ERROR: MONGODB_URL environment variable is not set.');
    console.error('Make sure you have a .env file with: MONGODB_URL=mongodb+srv://...');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUrl, {
    dbName: 'certificateSystem',
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  });
  console.log('✅ Connected.\n');

  const participants = mongoose.connection.collection('participants');
  const certcounters = mongoose.connection.collection('certcounters');

  console.log('Syncing high_water for each training type...\n');

  for (const type of TYPES) {
    // Find the highest cert_sequence currently assigned for this type
    const highest = await participants
      .find(
        { training_type: type, cert_sequence: { $exists: true, $gt: 0 } },
        { projection: { cert_sequence: 1 } }
      )
      .sort({ cert_sequence: -1 })
      .limit(1)
      .toArray();

    const maxSeq = highest[0]?.cert_sequence ?? 0;

    // Read current counter state for comparison
    const current = await certcounters.findOne({ training_type: type });
    const currentHW = current?.high_water ?? '(missing)';

    // Never decrease high_water — only fix counters that are behind
    if (typeof currentHW === 'number' && currentHW >= maxSeq) {
      console.log(`  ${type}: high_water=${currentHW} is already correct (max cert_sequence=${maxSeq}) — skipped`);
      continue;
    }

    await certcounters.updateOne(
      { training_type: type },
      {
        $set: { high_water: maxSeq },
        $setOnInsert: { training_type: type, floor: 0 },
      },
      { upsert: true }
    );

    console.log(`  ✅ ${type}: high_water ${currentHW} → ${maxSeq}`);
  }

  // Print final state so you can verify
  console.log('\nFinal certcounters state:');
  const all = await certcounters.find({}).sort({ training_type: 1 }).toArray();
  all.forEach(c => {
    console.log(`  ${c.training_type}: high_water=${c.high_water}, floor=${c.floor ?? 0}`);
  });

  console.log('\n✅ Sync complete. Restart your server and the Reset Modal will show the correct numbers.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
