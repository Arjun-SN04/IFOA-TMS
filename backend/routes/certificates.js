const express = require('express');
const router = express.Router();
const Participant = require('../models/Participant');
const { generateCertificate, MODULES_LIST } = require('../services/certificateGenerator');
const { authMiddleware } = require('./auth');
const { CertCounter, reserveCertSequence } = require('../models/CertCounter');

// ── Token auth: accept via header OR ?token= query param ─────────────────────
// Required for iframe/anchor URLs that cannot set custom headers.
function certAuth(req, res, next) {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  return authMiddleware(req, res, next);
}
router.use(certAuth);

// ── Is admin ──────────────────────────────────────────────────────────────────
function isAdmin(req) {
  return req.admin?.role === 'admin' || req.admin?.role === 'Administrator';
}

// ── Ownership check (airline only) ────────────────────────────────────────────
// Returns true if the requesting airline account owns this participant record.
function airlineOwns(req, participant) {
  if (req.admin?.role !== 'airline') return false;
  // Primary: submitted_by ObjectId must match
  if (participant.submitted_by && String(participant.submitted_by) === String(req.admin.id)) return true;
  // Legacy fallback: records created before submitted_by existed
  if (!participant.submitted_by && req.admin.airlineName) {
    const n = req.admin.airlineName.toLowerCase();
    if ((participant.airline_name || '').toLowerCase() === n) return true;
    if ((participant.company      || '').toLowerCase() === n) return true;
  }
  return false;
}

// ── PDF response headers ──────────────────────────────────────────────────────
function setPdfHeaders(res, filename, disposition = 'attachment') {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
}

// ── Assign a guaranteed-unique cert_sequence ──────────────────────────────────
// Smart allocation: fills gaps (revoked numbers) first, then assigns next sequential.
// This is called on every generate, so revoked-then-regenerated certs get the
// lowest available unused number (filling gaps) or next sequential if no gaps exist.
async function assignNewCertSequence(participant) {
  const newSeq = await reserveCertSequence(participant.training_type);

  // Double-check: if by any edge case the number already exists in DB, keep
  // incrementing until we find a truly free slot (should never happen with the
  // smart allocation, but belt-and-suspenders).
  let seq = newSeq;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const collision = await Participant.findOne({
      _id:           { $ne: participant._id },
      training_type: participant.training_type,
      cert_sequence: seq,
    }).lean();
    if (!collision) break;
    console.warn(`[cert] Collision detected for ${participant.training_type} #${seq} — forcing next slot`);
    // Force-advance the counter and grab the next number
    const raced = await CertCounter.findOneAndUpdate(
      { training_type: participant.training_type },
      { $inc: { seq: 1 } },
      { upsert: true, new: true }
    );
    seq = raced.seq;
  }

  participant.cert_sequence = seq;
  await participant.save();
  return seq;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /generate/:id ─────────────────────────────────────────────────────────
// Admin-only. Assigns a BRAND NEW unique cert_sequence every time it is called,
// sets cert_released = true, and returns the PDF.
// This is the canonical "release" action.
router.get('/generate/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Certificate generation is restricted to IFOA administrators.' });
    }

    const participant = await Participant.findById(req.params.id);
    if (!participant) return res.status(404).json({ error: 'Participant not found.' });

    // Always assign a fresh unique number — never reuse an old one.
    await assignNewCertSequence(participant);

    const incomingVariant = req.query.variant || participant.templateVariant || 'default';
    participant.templateVariant = incomingVariant;
    participant.cert_released   = true;   // ← RELEASE: airline can now see this
    await participant.save();

    const data = participant.toObject();
    data.templateVariant = incomingVariant;

    const pdfBuffer = await generateCertificate(data);
    const safeName  = participant.participant_name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename  = `Certificate_${safeName}_${participant.training_type}.pdf`;

    setPdfHeaders(res, filename, 'attachment');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[GET /generate] error:', err);
    res.status(500).json({ error: 'Failed to generate certificate.' });
  }
});

// ── POST /generate/:id ────────────────────────────────────────────────────────
// Admin-only. Same as GET but accepts modules + templateVariant in body (used
// for FDR recurrent certs where modules must be supplied).
router.post('/generate/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Certificate generation is restricted to IFOA administrators.' });
    }

    const participant = await Participant.findById(req.params.id);
    if (!participant) return res.status(404).json({ error: 'Participant not found.' });

    // Always assign a fresh unique number — never reuse an old one.
    await assignNewCertSequence(participant);

    if (req.body.modules) {
      participant.modules = Array.isArray(req.body.modules)
        ? req.body.modules.join(',')
        : req.body.modules;
    }

    const variant = req.body.templateVariant || req.query.variant || participant.templateVariant || 'default';
    participant.templateVariant = variant;
    participant.cert_released   = true;   // ← RELEASE: airline can now see this
    await participant.save();

    const data = participant.toObject();
    data.templateVariant = variant;

    const pdfBuffer = await generateCertificate(data);
    const safeName  = participant.participant_name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename  = `Certificate_${safeName}_${participant.training_type}.pdf`;

    setPdfHeaders(res, filename, 'attachment');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[POST /generate] error:', err);
    res.status(500).json({ error: 'Failed to generate certificate.' });
  }
});

// ── GET /preview/:id ──────────────────────────────────────────────────────────
// Admin: full preview regardless of cert_released status.
// Airline: BLOCKED unless cert_released === true AND they own the record.
router.get('/preview/:id', async (req, res) => {
  try {
    const participant = await Participant.findById(req.params.id);
    if (!participant) return res.status(404).json({ error: 'Participant not found.' });

    if (!isAdmin(req)) {
      // Airline must own the record
      if (!airlineOwns(req, participant)) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      // cert_released MUST be true — hard gate
      if (!participant.cert_released) {
        return res.status(403).json({ error: 'Certificate has not been released yet by IFOA.' });
      }
    }

    const data = participant.toObject();
    // Admin-only: allow ad-hoc module override for preview tool
    if (isAdmin(req) && req.query.modules) {
      data.modules = req.query.modules;
    }
    data.templateVariant = req.query.variant || participant.templateVariant || 'default';

    const pdfBuffer = await generateCertificate(data);
    const safeName  = participant.participant_name.replace(/[^a-zA-Z0-9]/g, '_');

    setPdfHeaders(res, `Certificate_${safeName}_Preview.pdf`, 'inline');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[GET /preview] error:', err);
    res.status(500).json({ error: 'Failed to preview certificate.' });
  }
});

// ── GET /download/:id ─────────────────────────────────────────────────────────
// Airline-facing download. Read-only — never changes any DB fields.
// Hard-blocked unless cert_released === true AND airline owns the record.
router.get('/download/:id', async (req, res) => {
  try {
    const participant = await Participant.findById(req.params.id);
    if (!participant) return res.status(404).json({ error: 'Participant not found.' });

    // Ownership check
    if (!isAdmin(req) && !airlineOwns(req, participant)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // cert_released MUST be true — hard gate (applies to both admin and airline)
    if (!participant.cert_released) {
      return res.status(403).json({ error: 'Certificate has not been released yet by IFOA.' });
    }

    // cert_sequence must exist (sanity check — should always be set when released)
    if (!participant.cert_sequence) {
      return res.status(409).json({ error: 'Certificate number not assigned. Please contact IFOA.' });
    }

    const data = participant.toObject();
    data.templateVariant = participant.templateVariant || 'default';

    const pdfBuffer = await generateCertificate(data);
    const safeName  = participant.participant_name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename  = `Certificate_${safeName}_${participant.training_type}.pdf`;

    setPdfHeaders(res, filename, 'attachment');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[GET /download] error:', err);
    res.status(500).json({ error: 'Failed to download certificate.' });
  }
});

// ── GET /modules ──────────────────────────────────────────────────────────────
router.get('/modules', (req, res) => {
  res.json(MODULES_LIST);
});

// ── GET /counters ─────────────────────────────────────────────────────────────
router.get('/counters', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    const counters = await CertCounter.find({}).sort({ training_type: 1 }).lean();
    res.json(counters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /counters/reset ──────────────────────────────────────────────────────
router.post('/counters/reset', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const rawStart    = Number(req.body.startFrom);
    const startFrom   = (!isNaN(rawStart) && rawStart >= 0) ? rawStart : 1;
    const isZeroReset = startFrom === 0;
    const mode        = req.body.mode === 'hard' ? 'hard' : 'soft';
    const types       = [];

    if (req.body.all) {
      const counters  = await CertCounter.find({}).lean();
      const ptypes    = await Participant.distinct('training_type');
      const allTypes  = new Set([...counters.map(c => c.training_type), ...ptypes]);
      types.push(...allTypes);
    } else {
      if (!req.body.training_type) {
        return res.status(400).json({ error: 'training_type or all:true is required.' });
      }
      types.push(req.body.training_type);
    }

    const results = [];

    for (const type of types) {
      if (isZeroReset || mode === 'hard') {
        // Wipe cert data and revoke access for all participants of this type
        await Participant.updateMany(
          { training_type: type },
          { $set: { cert_sequence: null, cert_released: false } }
        );
        const effectiveNext = isZeroReset ? 1 : startFrom;
        await CertCounter.findOneAndUpdate(
          { training_type: type },
          { $set: { seq: 0, floor: effectiveNext } },
          { upsert: true }
        );
        results.push({
          type,
          mode: isZeroReset ? 'zero-reset' : 'hard',
          nextNumber: effectiveNext,
          message: isZeroReset
            ? `Full reset. All cert numbers wiped. Next number will be 1.`
            : `All participant cert numbers wiped. Next number: ${startFrom}.`,
        });
      } else {
        const highest = await Participant.findOne(
          { training_type: type, cert_sequence: { $exists: true, $ne: null } },
          { cert_sequence: 1 },
          { sort: { cert_sequence: -1 } }
        ).lean();
        const existingMax    = highest ? (highest.cert_sequence || 0) : 0;
        const effectiveStart = Math.max(startFrom, existingMax + 1);
        await CertCounter.findOneAndUpdate(
          { training_type: type },
          { $set: { seq: effectiveStart - 1, floor: effectiveStart } },
          { upsert: true }
        );
        const warning = effectiveStart > startFrom
          ? ` (adjusted to ${effectiveStart} to avoid collision with existing #${existingMax})` : '';
        results.push({
          type, mode: 'soft', effectiveStart,
          message: `Existing numbers preserved. Next new number: ${effectiveStart}${warning}.`,
        });
      }
    }

    res.json({ startFrom, mode, results });
  } catch (err) {
    console.error('[POST /counters/reset] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
