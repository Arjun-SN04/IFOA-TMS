#!/usr/bin/env node
/**
 * fix-null-cert-sequences.js
 *
 * ONE-TIME emergency fix script. Safe to run multiple times (no-op if clean).
 *
 * Problem:
 *   The unique_cert_sequence_per_type index is sparse:true.
 *   MongoDB sparse indexes skip documents where the field is ABSENT,
 *   but they DO index documents where the field is explicitly null.
 *   All existing participants were created with cert_sequence:null,
 *   meaning the index treats every unissued participant as holding a
 *   real value of null — causing E11000 duplicate-key errors when
 *   adding, revoking or resetting multiple participants of the same training_type.
 *
 * Fix:
 *   1. DROP the broken index entirely (removes all stale null entries from it).
 *   2. Convert all participant documents with cert_sequence:null to have
 *      the field entirely absent ($unset), so the sparse index ignores them.
 *   3. RECREATE the index clean — now only real sequence numbers are indexed.
 *   4. Recreate the 3 canonical CertCounter documents (FDI, HF, FDR) if
 *      they were accidentally deleted from the certcounters collection.
 *
 * Usage (run from the backend folder):
 *   node fix-null-cert-sequences.js
 */

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) {
    console.error('ERROR: MONGODB_URL environment variable is not set.');
    console.error('Make sure you have a .env file in the backend folder with:');
    console.error('  MONGODB_URL=mongodb+srv://...');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUrl, {
    dbName: 'certificateSystem',
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  });
  console.log('✅ Connected to MongoDB Atlas.\n');

  const participants = mongoose.connection.collection('participants');

  // ── Step 1: Drop the broken index ────────────────────────────────────────
  console.log('Step 1: Dropping broken unique_cert_sequence_per_type index...');
  try {
    await participants.dropIndex('unique_cert_sequence_per_type');
    console.log('  ✅ Index dropped.\n');
  } catch (err) {
    if (err.codeName === 'IndexNotFound' || err.code === 27) {
      console.log('  ✓ Index did not exist — nothing to drop.\n');
    } else {
      throw err;
    }
  }

  // ── Step 2: Unset cert_sequence:null on all participants ──────────────────
  console.log('Step 2: Converting cert_sequence:null → absent in participants...');
  const partResult = await participants.updateMany(
    { cert_sequence: null },
    { $unset: { cert_sequence: '' } }
  );

  if (partResult.modifiedCount === 0) {
    console.log('  ✓ Already clean — no null cert_sequence values found.\n');
  } else {
    console.log(`  ✅ Fixed ${partResult.modifiedCount} participant(s).\n`);
  }

  // ── Step 3: Recreate the index cleanly ───────────────────────────────────
  console.log('Step 3: Recreating unique_cert_sequence_per_type index (clean)...');
  await participants.createIndex(
    { training_type: 1, cert_sequence: 1 },
    { unique: true, sparse: true, name: 'unique_cert_sequence_per_type' }
  );
  console.log('  ✅ Index recreated.\n');

  // ── Step 4: Recreate missing CertCounter documents ────────────────────────
  console.log('Step 4: Ensuring all independent CertCounter documents exist...');
  // Every training_type now has its OWN counter — no sharing between types.
  const canonicalBuckets = [
    { training_type: 'FDI', high_water: 0, floor: 0 },
    { training_type: 'FDA', high_water: 0, floor: 0 },
    { training_type: 'GD',  high_water: 0, floor: 0 },
    { training_type: 'TCD', high_water: 0, floor: 0 },
    { training_type: 'HF',  high_water: 0, floor: 0 },
    { training_type: 'NDG', high_water: 0, floor: 0 },
    { training_type: 'FDR', high_water: 0, floor: 0 },
    { training_type: 'FTL', high_water: 0, floor: 0 },
  ];

  for (const bucket of canonicalBuckets) {
    const res = await mongoose.connection
      .collection('certcounters')
      .updateOne(
        { training_type: bucket.training_type },
        { $setOnInsert: bucket },
        { upsert: true }
      );
    if (res.upsertedCount > 0) {
      console.log(`  ✅ Created: ${bucket.training_type} (high_water:0, floor:0)`);
    } else {
      console.log(`  ✓ Already exists: ${bucket.training_type}`);
    }
  }

  // ── Step 5: Verify — show final index list and counter state ──────────────
  console.log('\nStep 5: Verifying indexes on participants collection...');
  const indexes = await participants.indexes();
  indexes.forEach(idx => {
    console.log(`  ${idx.name}: ${JSON.stringify(idx.key)}${idx.sparse ? ' [sparse]' : ''}${idx.unique ? ' [unique]' : ''}`);
  });

  console.log('\nCurrent certcounters collection:');
  const counters = await mongoose.connection
    .collection('certcounters')
    .find({})
    .sort({ training_type: 1 })
    .toArray();

  counters.forEach(c => {
    console.log(`  ${c.training_type}: high_water=${c.high_water}, floor=${c.floor}`);
  });

  console.log('\n✅ All done. Restart your server and try adding participants again.\n');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
