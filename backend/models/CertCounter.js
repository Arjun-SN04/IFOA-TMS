const mongoose = require('mongoose');

const certCounterSchema = new mongoose.Schema(
  {
    training_type: { type: String, required: true, unique: true },
    seq:           { type: Number, default: 0 },
    floor:         { type: Number, default: 0 },
  },
  { timestamps: false }
);

const CertCounter = mongoose.model('CertCounter', certCounterSchema);

const TO_CODE = {
  'Dispatch Graduate': 'FDI',
  'Human Factors':     'HF',
  'Recurrent':         'FDR',
};

/**
 * Reserve the next unique certificate sequence number for a training type.
 * Smart allocation: fills gaps (revoked numbers) before issuing new sequential numbers.
 * Atomic: uses a conditional findOneAndUpdate so two simultaneous calls
 * can never receive the same number.
 */
async function reserveCertSequence(training_type) {
  const code = TO_CODE[training_type] || training_type;

  // Lazy-require Participant to avoid circular dependency at module load
  const Participant = require('./Participant');

  // ── Step 1: read current counter state ───────────────────────────────────
  const counterDoc = await CertCounter.findOne({ training_type: code }).lean();
  const currentSeq = counterDoc ? (counterDoc.seq   || 0) : 0;
  const floor      = counterDoc ? (counterDoc.floor || 0) : 0;

  let nextSeq;

  if (floor > 0 && currentSeq < floor) {
    // Reset mode: admin set a floor — start from floor, ignore old data
    nextSeq = floor;
  } else {
    // Smart mode: check for gaps (revoked numbers) first
    // Get all assigned cert_sequences for this training type, sorted
    const allSequences = await Participant.find(
      { training_type: code, cert_sequence: { $exists: true, $ne: null } },
      { cert_sequence: 1 },
      { sort: { cert_sequence: 1 } }
    ).lean();

    const usedNumbers = new Set(allSequences.map(p => p.cert_sequence || 0).filter(n => n > 0));

    // Find the first available number starting from 1
    let candidate = 1;
    while (usedNumbers.has(candidate)) {
      candidate++;
    }

    // Use the found gap, or the next sequential number if no gaps
    nextSeq = candidate;
  }

  // ── Step 2: atomic write — only succeeds if counter hasn't moved past nextSeq ─
  // This prevents two concurrent requests from getting the same number.
  const updated = await CertCounter.findOneAndUpdate(
    { training_type: code, seq: { $lt: nextSeq } }, // guard: only update if still behind
    { $set: { seq: nextSeq } },
    { upsert: false, new: true }
  );

  if (!updated) {
    // Race condition: another request already advanced the counter.
    // Safely grab the next unique slot by incrementing
    const raced = await CertCounter.findOneAndUpdate(
      { training_type: code },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    console.warn(`[cert] Race resolved for ${code}: issued ${raced.seq} (was competing for ${nextSeq})`);
    return raced.seq;
  }

  return nextSeq;
}

module.exports = { CertCounter, reserveCertSequence };
