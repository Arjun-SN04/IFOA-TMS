'use strict';
const mongoose = require('mongoose');

const certCounterSchema = new mongoose.Schema(
  {
    training_type: { type: String, required: true, unique: true },
    // high_water: the highest cert_sequence number ever issued for this type.
    // This ONLY ever increases — it is never decremented on revoke.
    high_water: { type: Number, default: 0 },
    // floor: admin-set minimum for the next new (non-gap) number.
    // 0 means no floor is set.
    floor: { type: Number, default: 0 },
  },
  { timestamps: false }
);

const CertCounter = mongoose.model('CertCounter', certCounterSchema);

// Maps every accepted training_type value to the canonical counter bucket.
// All aliases for the same certificate family share ONE counter so sequence
// numbers never collide across aliases.
const TO_CODE = {
  // Dispatch Graduate family
  'Dispatch Graduate': 'FDI',
  FDI: 'FDI',
  FDA: 'FDI',
  GD:  'FDI',
  TCD: 'FDI',
  // Human Factors family
  'Human Factors': 'HF',
  HF:  'HF',
  NDG: 'HF',
  // Recurrent family
  'Recurrent': 'FDR',
  FDR: 'FDR',
  FTL: 'FDR',
};

/**
 * Ensure a CertCounter document exists for `code`.
 * Uses findOneAndUpdate with upsert:true so it is safe under concurrency.
 * Returns the document (always non-null after this call).
 */
async function ensureCounter(code) {
  return CertCounter.findOneAndUpdate(
    { training_type: code },
    { $setOnInsert: { training_type: code, high_water: 0, floor: 0 } },
    { upsert: true, returnDocument: 'after', new: true }
  );
}

/**
 * Reserve the next unique certificate sequence number for a given training type.
 *
 * Algorithm:
 *   1. Ensure the CertCounter document exists (creates it if first time).
 *   2. Query every cert_sequence in use across ALL aliases of this type.
 *   3. Scan upward from 1 to find the lowest positive integer NOT in use.
 *      - Gap-fill (holes below high_water) always happens before issuing new numbers.
 *      - If admin set a floor and the first free number is below it, jump to floor.
 *   4. If chosen > high_water, atomically advance the counter with upsert:true.
 *      - If a concurrent writer beat us, retry.
 *   5. If chosen <= high_water (gap fill), no counter update needed — return directly.
 *
 * Every training type starts at 00001 (sequence 1) unless admin set a floor.
 */
async function reserveCertSequence(training_type) {
  const code = TO_CODE[training_type] || training_type;

  // Lazy-require to avoid circular dependency at module load time
  const Participant = require('./Participant');

  const MAX_SCAN_RETRIES = 15;

  // Ensure counter document exists before we start (safe under concurrency)
  await ensureCounter(code);

  for (let scanAttempt = 1; scanAttempt <= MAX_SCAN_RETRIES; scanAttempt++) {

    // -- Step 1: fetch all aliases for this code ------------------------------
    const aliasTypes = Object.keys(TO_CODE).filter(k => TO_CODE[k] === code);
    const queryTypes = [...new Set([code, ...aliasTypes])];

    // -- Step 2: fetch all in-use sequence numbers across ALL aliases ---------
    const inUseDocs = await Participant.find(
      {
        training_type: { $in: queryTypes },
        cert_sequence: { $exists: true, $ne: null },
      },
      { cert_sequence: 1 },
      { sort: { cert_sequence: 1 } }
    ).lean();

    const inUse = new Set(
      inUseDocs
        .map(p => p.cert_sequence)
        .filter(n => typeof n === 'number' && n > 0)
    );

    // -- Step 3: read current counter state -----------------------------------
    const counterDoc = await CertCounter.findOne({ training_type: code }).lean();
    const floor      = counterDoc ? (counterDoc.floor || 0) : 0;
    const highWater  = counterDoc ? (counterDoc.high_water || 0) : 0;

    // -- Step 4: find lowest unused positive integer --------------------------
    // Always start scanning from 1 so we gap-fill first.
    let candidate = 1;
    while (inUse.has(candidate)) {
      candidate++;
    }

    // If the lowest free number is below the admin floor AND above highWater
    // (i.e. it's a new number, not a gap), jump to the floor instead.
    if (candidate > highWater && floor > 0 && candidate < floor) {
      candidate = floor;
      while (inUse.has(candidate)) {
        candidate++;
      }
    }

    const chosen = candidate;

    // -- Step 5: advance high-water if needed ---------------------------------
    if (chosen > highWater) {
      // Atomically advance the counter only if nobody else already pushed past chosen.
      // upsert:true so this also handles the first-ever issuance correctly.
      const updateResult = await CertCounter.findOneAndUpdate(
        { training_type: code, high_water: { $lt: chosen } },
        { $set: { high_water: chosen } },
        { upsert: true, returnDocument: 'after', new: true }
      );

      if (!updateResult) {
        // Another concurrent request advanced the counter — re-scan with fresh state.
        console.warn(
          `[cert] Concurrent write detected for ${code} at candidate ${chosen}` +
          ` (scan attempt ${scanAttempt}/${MAX_SCAN_RETRIES}) — retrying`
        );
        continue;
      }
    }
    // chosen <= highWater means it's a gap fill — no counter update needed.

    console.log(
      `[cert] Reserved sequence #${chosen} for ${code}` +
      ` (highWater was ${highWater}, floor=${floor}, attempt=${scanAttempt})`
    );
    return chosen;
  }

  throw new Error(
    `[cert] reserveCertSequence failed for ${code} after ${MAX_SCAN_RETRIES} scan attempts. ` +
    'Check for extreme concurrency or stale CertCounter documents.'
  );
}

module.exports = { CertCounter, reserveCertSequence, TO_CODE };
