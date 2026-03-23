const express = require('express');
const router = express.Router();
const Participant = require('../models/Participant');
const { generateCertificate, MODULES_LIST } = require('../services/certificateGenerator');
const { authMiddleware } = require('./auth');
const { CertCounter, reserveCertSequence } = require('../models/CertCounter');

// Certificate routes accept token via Authorization header OR ?token= query param
// (needed for iframe/anchor direct URL access that can't set custom headers)
function certAuth(req, res, next) {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  return authMiddleware(req, res, next);
}

router.use(certAuth);

// ── Helper: assign cert_sequence if not yet set; check collision if already set ───
async function ensureUniqueCertSequence(participant) {
  if (!participant.cert_sequence) {
    // Fresh assignment — never had a cert number before
    participant.cert_sequence = await reserveCertSequence(participant.training_type);
    await participant.save();
    return;
  }
  // Cert number already assigned — only reassign if there is an actual collision
  const collision = await Participant.findOne({
    _id:           { $ne: participant._id },
    training_type: participant.training_type,
    cert_sequence: participant.cert_sequence,
  });
  if (collision) {
    console.warn(`[cert] COLLISION: ${participant.participant_name} cert ${participant.cert_sequence} clashes with ${collision.participant_name}. Reassigning.`);
    participant.cert_sequence = await reserveCertSequence(participant.training_type);
    await participant.save();
  }
  // No collision — preserve existing cert_sequence exactly
}

// ── Helper: set PDF response headers ──────────────────────────────────────────
function setPdfHeaders(res, filename, disposition = 'attachment') {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
}

// ── Ownership check ────────────────────────────────────────────────────────────
// Returns true if the requesting user is allowed to access this participant.
function canAccess(req, participant) {
  const role = req.admin?.role;
  // Admins can access everything
  if (role === 'admin' || role === 'Administrator') return true;
  if (role !== 'airline') return false;
  // Airline must own the participant via submitted_by ObjectId
  if (participant.submitted_by && String(participant.submitted_by) === String(req.admin.id)) return true;
  // Legacy records without submitted_by — fallback to name match
  if (!participant.submitted_by && req.admin.airlineName) {
    const n = req.admin.airlineName.toLowerCase();
    if ((participant.airline_name || '').toLowerCase() === n) return true;
    if ((participant.company      || '').toLowerCase() === n) return true;
  }
  return false;
}

// ── Is admin helper ────────────────────────────────────────────────────────────
function isAdmin(req) {
  return req.admin?.role === 'admin' || req.admin?.role === 'Administrator';
}

// ── GET /generate/:id — download PDF ──────────────────────────────────────────
// ADMIN ONLY. Airlines cannot call this — it auto-assigns cert_sequence which
// is an admin privilege. Airlines download via /download/:id after cert is issued.
router.get('/generate/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Certificate generation is restricted to IFOA administrators.' });
    }

    const participant = await Participant.findById(req.params.id);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    const incomingVariant = req.query.variant || 'default';
    await ensureUniqueCertSequence(participant);
    // Mark certificate as released — airlines can now preview/download
    participant.cert_released = true;
    if (participant.templateVariant !== incomingVariant) {
      participant.templateVariant = incomingVariant;
    }
    await participant.save();

    const data = participant.toObject();
    data.templateVariant = incomingVariant;

    const pdfBuffer = await generateCertificate(data);
    const sanitizedName = participant.participant_name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Certificate_${sanitizedName}_${participant.training_type.replace(/\s+/g, '_')}.pdf`;

    setPdfHeaders(res, filename, 'attachment');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Certificate generation error:', error);
    res.status(500).json({ error: 'Failed to generate certificate' });
  }
});

// ── GET /preview/:id — inline PDF preview ─────────────────────────────────────
// Admin: full preview (works even before cert_sequence is assigned).
// Airline: only allowed if (1) they own the participant AND (2) cert_sequence exists.
router.get('/preview/:id', async (req, res) => {
  try {
    const participant = await Participant.findById(req.params.id);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    if (!isAdmin(req)) {
      // Ownership check
      if (!canAccess(req, participant)) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      // cert_released must be true — admin explicitly released this certificate
      if (!participant.cert_released) {
        return res.status(403).json({ error: 'Certificate has not been released yet by IFOA.' });
      }
    }

    const data = participant.toObject();

    // Module override allowed only for admin (used by the admin preview tool)
    if (isAdmin(req) && req.query.modules) {
      data.modules = req.query.modules;
    }

    data.templateVariant = req.query.variant || participant.templateVariant || 'default';

    const pdfBuffer = await generateCertificate(data);
    const sanitizedName = participant.participant_name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Certificate_${sanitizedName}_Preview.pdf`;

    setPdfHeaders(res, filename, 'inline');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Certificate preview error:', error);
    res.status(500).json({ error: 'Failed to preview certificate' });
  }
});

// ── POST /generate/:id — generate with custom modules (recurrent) ──────────────
// ADMIN ONLY. Same reasoning as GET /generate.
router.post('/generate/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Certificate generation is restricted to IFOA administrators.' });
    }

    const participant = await Participant.findById(req.params.id);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    await ensureUniqueCertSequence(participant);

    if (req.body.modules) {
      participant.modules = Array.isArray(req.body.modules)
        ? req.body.modules.join(',')
        : req.body.modules;
    }

    const postVariant = req.body.templateVariant || req.query.variant || 'default';
    participant.templateVariant = postVariant;
    // Mark certificate as released — airlines can now preview/download
    participant.cert_released = true;
    await participant.save();

    const data = participant.toObject();
    data.templateVariant = postVariant;

    const pdfBuffer = await generateCertificate(data);
    const sanitizedName = participant.participant_name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Certificate_${sanitizedName}_${participant.training_type.replace(/\s+/g, '_')}.pdf`;

    setPdfHeaders(res, filename, 'attachment');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Certificate generation error (POST):', error);
    res.status(500).json({ error: 'Failed to generate certificate' });
  }
});

// ── GET /download/:id — airline download of an already-issued certificate ──────
// Airline-facing download endpoint. Requires cert_sequence to exist (admin issued).
// Does NOT assign or change cert_sequence — read-only regeneration from saved data.
router.get('/download/:id', async (req, res) => {
  try {
    const participant = await Participant.findById(req.params.id);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    // Ownership check
    if (!canAccess(req, participant)) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    // cert_released must be true — admin must have explicitly released this certificate
    if (!participant.cert_released) {
      return res.status(403).json({ error: 'Certificate has not been released yet by IFOA.' });
    }

    const data = participant.toObject();
    data.templateVariant = participant.templateVariant || 'default';

    const pdfBuffer = await generateCertificate(data);
    const sanitizedName = participant.participant_name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `Certificate_${sanitizedName}_${participant.training_type.replace(/\s+/g, '_')}.pdf`;

    setPdfHeaders(res, filename, 'attachment');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Certificate download error:', error);
    res.status(500).json({ error: 'Failed to download certificate' });
  }
});

// ── GET /modules — list available modules ─────────────────────────────────────
router.get('/modules', (req, res) => {
  res.json(MODULES_LIST);
});

// ── GET /counters — current cert sequence counters per training type ───────────
router.get('/counters', async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin access required.' });
    const counters = await CertCounter.find({}).sort({ training_type: 1 }).lean();
    res.json(counters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /counters/reset ───────────────────────────────────────────────────────
router.post('/counters/reset', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const rawStart  = Number(req.body.startFrom);
    const startFrom = (!isNaN(rawStart) && rawStart >= 0) ? rawStart : 1;
    const isZeroReset = startFrom === 0;
    const mode = req.body.mode === 'hard' ? 'hard' : 'soft';
    const types = [];

    if (req.body.all) {
      const counters = await CertCounter.find({}).lean();
      const ptypes   = await Participant.distinct('training_type');
      const allTypes = new Set([...counters.map(c => c.training_type), ...ptypes]);
      types.push(...allTypes);
    } else {
      if (!req.body.training_type) {
        return res.status(400).json({ error: 'training_type or all:true is required' });
      }
      types.push(req.body.training_type);
    }

    const results = [];

    for (const type of types) {
      if (isZeroReset || mode === 'hard') {
        await Participant.updateMany({ training_type: type }, { $set: { cert_sequence: null } });
        const effectiveNext = isZeroReset ? 1 : startFrom;
        await CertCounter.findOneAndUpdate(
          { training_type: type },
          { $set: { seq: 0, floor: effectiveNext } },
          { upsert: true }
        );
        results.push({
          type, mode: isZeroReset ? 'zero-reset' : 'hard', nextNumber: effectiveNext,
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
    console.error('POST /counters/reset error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
