const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const XLSX    = require('xlsx');
const ExamResult = require('../models/ExamResult');
const { authMiddleware } = require('./auth');

// All routes require authentication
router.use(authMiddleware);

// Multer: memory storage for Excel uploads (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.match(/\.xlsx?$/)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx / .xls files are accepted.'));
    }
  },
});

// ── Helper: grade from mark ───────────────────────────────────────────────────
function gradeFromMark(m) {
  if (m == null) return null;
  if (m > 95)    return 'OUTSTANDING';
  if (m >= 90)   return 'DISTINCTION';
  if (m >= 76)   return 'MERIT';
  if (m >= 75)   return 'PASS';
  return 'FAILED';
}

// ── Helper: parse an IFOA exam-results workbook ───────────────────────────────
// Returns { batchMeta, students[] } or throws with a descriptive message.
function parseIfoaWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  // ── 1. Find the summary sheet (first sheet) ───────────────────────────────
  const summaryName = wb.SheetNames[0];
  const summaryWs   = wb.Sheets[summaryName];
  const summaryRaw  = XLSX.utils.sheet_to_json(summaryWs, { header: 1, defval: null });

  // The IFOA workbook's used range may start at row 2 (no row 1 data). XLSX.sheet_to_json
  // always starts at the sheet's first *used* row, so summaryRaw[0] = that first row.
  // We compute rowOffset so we can reference cells by their actual Excel row number.
  const sheetRef   = summaryWs['!ref'] || 'A1';
  const sheetRange = XLSX.utils.decode_range(sheetRef);
  const rowOffset  = sheetRange.s.r; // 0 if sheet starts at row 1, 1 if it starts at row 2, etc.

  // Helper: read by Excel row (1-based) and 0-based column index
  const cellVal = (excelRow, col) =>
    (summaryRaw[excelRow - 1 - rowOffset]?.[col] || '').toString().trim();

  // Course title: D2 (col index 3, Excel row 2)
  const courseTitle = cellVal(2, 3);
  if (!courseTitle) throw new Error('Could not find course title in the summary sheet (expected cell D2).');

  // Training mode: D4 (col 3, row 4)  |  date range: H4 (col 7, row 4)
  const trainingModeRaw = cellVal(4, 3).toUpperCase() || 'HYBRID';
  const trainingMode    = trainingModeRaw.includes('ONLINE')    ? 'ONLINE'
                        : trainingModeRaw.includes('IN-PERSON') ? 'IN-PERSON'
                        : 'HYBRID';

  const dateRangeRaw  = cellVal(4, 7);
  // e.g. "04 November 2024 - 06 December 2024"
  let startDate = '', endDate = '';
  const dateMatch = dateRangeRaw.match(/^(.+?)\s*-\s*(.+)$/);
  if (dateMatch) {
    const parseDate = (s) => {
      const d = new Date(s.trim());
      return isNaN(d) ? s.trim() : d.toISOString().split('T')[0];
    };
    startDate = parseDate(dateMatch[1]);
    endDate   = parseDate(dateMatch[2]);
  }

  // Instructors: O4 = lead (col 14, row 4), O5/O6/O7 = additional
  const leadInstructor = cellVal(4, 14);
  const instructors    = [cellVal(5, 14), cellVal(6, 14), cellVal(7, 14)]
    .filter(Boolean);

  // ── 2. Find header row in summary sheet ──────────────────────────────────
  // Header row: First Name | Surname | subject abbrs … | FINAL EXAM | Final Marks
  let headerRowIdx = -1;
  let headerRow    = [];
  for (let r = 0; r < summaryRaw.length; r++) {
    const row = summaryRaw[r];
    if (row && row[0] && row[0].toString().toLowerCase().includes('first')) {
      headerRowIdx = r;
      headerRow    = row.map(v => (v || '').toString().trim());
      break;
    }
  }
  if (headerRowIdx === -1) throw new Error('Could not locate the student header row in the summary sheet.');

  // Columns after "Surname" are subject abbreviations, then FINAL EXAM, Final Marks
  const subjectCols = []; // { abbr, colIdx }
  let finalExamCol  = -1;
  let finalMarksCol = -1;
  for (let c = 2; c < headerRow.length; c++) {
    const h = headerRow[c].trim();
    if (!h) continue;
    if (h.toUpperCase().replace(/\s/g,'') === 'FINALEXAM') { finalExamCol  = c; continue; }
    if (h.toLowerCase().replace(/\s/g,'') === 'finalmarks') { finalMarksCol = c; continue; }
    subjectCols.push({ abbr: h, colIdx: c });
  }

  // ── 3. Build subject name map from individual Student sheets ─────────────
  // We'll look up abbr → full name from any student sheet available
  const abbrToName = {};
  for (let si = 1; si < wb.SheetNames.length; si++) {
    const ws  = wb.Sheets[wb.SheetNames[si]];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    // Subject rows: col 0 = full name, col 5 = abbr (rows ~19–30)
    for (let r = 15; r < raw.length; r++) {
      const abbr = (raw[r]?.[5] || '').toString().trim();
      const name = (raw[r]?.[0] || '').toString().trim();
      if (abbr && name && !['NAME','GRADE','TOTAL MARKS','SUBJECTS'].includes(name.toUpperCase())) {
        abbrToName[abbr] = name;
      }
    }
    break; // one student sheet is enough
  }

  // ── 4. Parse each student row from summary ────────────────────────────────
  const students = [];
  for (let r = headerRowIdx + 1; r < summaryRaw.length; r++) {
    const row = summaryRaw[r];
    if (!row) continue;
    const firstName = (row[0] || '').toString().trim();
    const lastName  = (row[1] || '').toString().trim();
    if (!firstName && !lastName) continue; // blank row
    if (!firstName || !lastName) continue;

    const subjects = subjectCols
      .map(({ abbr, colIdx }) => {
        const marks = row[colIdx];
        const mo    = (marks != null && marks !== '') ? Number(marks) : null;
        return {
          abbr,
          name:          abbrToName[abbr] || abbr,
          max_marks:     100,
          marks_obtained: mo,
          grade:         gradeFromMark(mo),
        };
      })
      .filter(s => s.abbr); // skip empty

    const finalExamScore = finalExamCol  !== -1 && row[finalExamCol]  != null ? Number(row[finalExamCol])  : null;
    const finalMarks     = finalMarksCol !== -1 && row[finalMarksCol] != null ? Number(row[finalMarksCol]) : null;

    students.push({
      first_name:       firstName,
      last_name:        lastName,
      batch_name:       '', // caller fills this in
      course_name:      courseTitle,
      course_type:      'FDI', // default; caller may override
      training_mode:    trainingMode,
      start_date:       startDate,
      end_date:         endDate,
      lead_instructor:  leadInstructor,
      instructors,
      subjects,
      final_exam_score: finalExamScore,
      final_marks:      finalMarks != null ? Math.round(finalMarks * 1000) / 1000 : null,
      sheet_date:       endDate,
      sheet_issued:     false,
    });
  }

  if (students.length === 0) throw new Error('No student rows found in the summary sheet.');

  return {
    batchMeta: { courseTitle, trainingMode, startDate, endDate, leadInstructor, instructors },
    students,
  };
}

// ── GET all exam results ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    if (req.admin.role === 'airline') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    const { batch_name, course_type, search } = req.query;
    const filter = {};
    if (batch_name)  filter.batch_name  = batch_name;
    if (course_type) filter.course_type = course_type;
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [
        { participant_name: re },
        { first_name: re },
        { last_name: re },
        { company: re },
        { batch_name: re },
      ];
    }
    const results = await ExamResult.find(filter).sort({ created_at: -1 });
    res.json(results);
  } catch (err) {
    console.error('GET /exam-results error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET batch summary list (distinct batches with counts) ─────────────────────
router.get('/batches', async (req, res) => {
  try {
    if (req.admin.role === 'airline') return res.status(403).json({ error: 'Admin access required.' });
    const batches = await ExamResult.aggregate([
      {
        $group: {
          _id: { batch_name: '$batch_name', course_type: '$course_type', course_name: '$course_name' },
          count:        { $sum: 1 },
          avg_mark:     { $avg: '$final_marks' },
          start_date:   { $first: '$start_date' },
          end_date:     { $first: '$end_date' },
        }
      },
      { $sort: { '_id.batch_name': -1 } }
    ]);
    res.json(batches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST parse Excel preview (no DB write) ────────────────────────────────────
router.post('/parse-excel', upload.single('file'), async (req, res) => {
  try {
    if (req.admin.role === 'airline') return res.status(403).json({ error: 'Admin access required.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const { batchMeta, students } = parseIfoaWorkbook(req.file.buffer);
    res.json({ batchMeta, students });
  } catch (err) {
    console.error('POST /exam-results/parse-excel error:', err.message);
    res.status(422).json({ error: err.message });
  }
});

// ── POST import Excel → DB ────────────────────────────────────────────────────
router.post('/import-excel', upload.single('file'), async (req, res) => {
  try {
    if (req.admin.role === 'airline') return res.status(403).json({ error: 'Admin access required.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const { students } = parseIfoaWorkbook(req.file.buffer);

    // Caller can pass overrides as form fields
    const batchName  = (req.body.batch_name  || '').trim();
    const courseType = (req.body.course_type || 'FDI').trim();
    const company    = (req.body.company     || '').trim();

    if (!batchName) return res.status(400).json({ error: 'batch_name is required.' });

    const saved   = [];
    const failed  = [];

    for (const s of students) {
      try {
        const doc = new ExamResult({
          ...s,
          batch_name:  batchName,
          course_type: courseType,
          company,
          created_by:  req.admin.id,
        });
        await doc.save();
        saved.push({ participant_name: doc.participant_name, id: doc._id });
      } catch (err) {
        failed.push({ participant_name: `${s.first_name} ${s.last_name}`, error: err.message });
      }
    }

    res.status(207).json({
      message:      `Imported ${saved.length} of ${students.length} records.`,
      successCount: saved.length,
      failCount:    failed.length,
      saved,
      failed,
    });
  } catch (err) {
    console.error('POST /exam-results/import-excel error:', err.message);
    res.status(422).json({ error: err.message });
  }
});

// ── GET single exam result ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (req.admin.role === 'airline') return res.status(403).json({ error: 'Admin access required.' });
    const doc = await ExamResult.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Exam result not found.' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST create exam result ───────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (req.admin.role === 'airline') return res.status(403).json({ error: 'Admin access required.' });

    const {
      first_name, last_name, batch_name, course_name, course_type,
      training_mode, start_date, end_date, company,
      lead_instructor, instructors,
      subjects, final_exam_score, final_marks, sheet_date, sheet_issued,
    } = req.body;

    const missing = [];
    if (!first_name)   missing.push('first_name');
    if (!last_name)    missing.push('last_name');
    if (!batch_name)   missing.push('batch_name');
    if (!course_name)  missing.push('course_name');
    if (!course_type)  missing.push('course_type');
    if (!start_date)   missing.push('start_date');
    if (!end_date)     missing.push('end_date');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    const doc = new ExamResult({
      first_name: first_name.trim(),
      last_name:  last_name.trim(),
      batch_name, course_name, course_type,
      training_mode: training_mode || 'HYBRID',
      start_date, end_date,
      company:          company          || '',
      lead_instructor:  lead_instructor  || '',
      instructors:      instructors      || [],
      subjects:         subjects         || [],
      final_exam_score: final_exam_score != null ? Number(final_exam_score) : null,
      final_marks:      final_marks      != null ? Number(final_marks)      : null,
      sheet_date:       sheet_date       || end_date,
      sheet_issued:     sheet_issued     || false,
      created_by:       req.admin.id,
    });

    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    console.error('POST /exam-results error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST bulk create ──────────────────────────────────────────────────────────
router.post('/bulk', async (req, res) => {
  try {
    if (req.admin.role === 'airline') return res.status(403).json({ error: 'Admin access required.' });
    const rows = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Expected a non-empty array.' });
    }
    const results = [];
    for (const row of rows) {
      try {
        const doc = new ExamResult({ ...row, created_by: req.admin.id });
        await doc.save();
        results.push({ success: true, id: doc._id, participant_name: doc.participant_name });
      } catch (err) {
        results.push({ success: false, error: err.message });
      }
    }
    const successCount = results.filter(r => r.success).length;
    res.status(207).json({ results, successCount, failCount: rows.length - successCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT update exam result ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    if (req.admin.role === 'airline') return res.status(403).json({ error: 'Admin access required.' });
    const doc = await ExamResult.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Exam result not found.' });

    const fields = [
      'first_name','last_name','batch_name','course_name','course_type',
      'training_mode','start_date','end_date','company',
      'lead_instructor','instructors','subjects',
      'final_exam_score','final_marks','sheet_date','sheet_issued',
    ];
    fields.forEach(f => { if (req.body[f] !== undefined) doc[f] = req.body[f]; });
    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error('PUT /exam-results/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH mark sheet as issued ────────────────────────────────────────────────
router.patch('/:id/issue-sheet', async (req, res) => {
  try {
    if (req.admin.role === 'airline') return res.status(403).json({ error: 'Admin access required.' });
    const doc = await ExamResult.findByIdAndUpdate(
      req.params.id,
      { sheet_issued: true, sheet_date: req.body.sheet_date || new Date().toISOString().split('T')[0] },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Exam result not found.' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE exam result ────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (req.admin.role === 'airline') return res.status(403).json({ error: 'Admin access required.' });
    const deleted = await ExamResult.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Exam result not found.' });
    res.json({ message: 'Exam result deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
