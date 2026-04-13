import { useEffect, useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HiOutlineClipboardList,
  HiOutlineSearch,
  HiOutlineChartBar,
  HiOutlineDocumentText,
  HiOutlineUsers,
  HiOutlineCheckCircle,
  HiOutlinePlus,
  HiOutlineTrash,
  HiOutlinePencil,
  HiOutlineX,
  HiOutlineDownload,
  HiOutlineEye,
  HiOutlineRefresh,
  HiOutlineAcademicCap,
  HiOutlineUpload,
  HiOutlineExclamationCircle,
} from 'react-icons/hi';
import toast from 'react-hot-toast';
import {
  getExamResults,
  createExamResult,
  updateExamResult,
  deleteExamResult,
  issueResultSheet,
  getExamBatches,
  parseExamResultsExcel,
  importExamResultsExcel,
} from '../api';
import { useAuth } from '../context/AuthContext';

// ── Constants ─────────────────────────────────────────────────────────────────
const COURSE_TYPES = [
  { value: 'FDI', label: 'FDI – Flight Dispatch Initial' },
  { value: 'FDR', label: 'FDR – Flight Dispatch Recurrent' },
  { value: 'FDA', label: 'FDA – Flight Dispatch Advanced' },
  { value: 'FTL', label: 'FTL – Flight Time Limitations' },
  { value: 'NDG', label: 'NDG – Dangerous Goods No-Carry' },
  { value: 'HF',  label: 'HF – Human Factors for OCC' },
  { value: 'GD',  label: 'GD – Ground Operations' },
  { value: 'TCD', label: 'TCD – Training Competencies Development' },
];

const DEFAULT_SUBJECTS = [
  { abbr: 'LAW', name: 'Air Law',                      max_marks: 100, marks_obtained: null },
  { abbr: 'SYS', name: 'Aircraft Systems',              max_marks: 100, marks_obtained: null },
  { abbr: 'MON', name: 'Flight Monitoring',             max_marks: 100, marks_obtained: null },
  { abbr: 'M&B', name: 'Mass & Balance',                max_marks: 100, marks_obtained: null },
  { abbr: 'ATM', name: 'Air Traffic Management',        max_marks: 100, marks_obtained: null },
  { abbr: 'COM', name: 'Communication',                 max_marks: 100, marks_obtained: null },
  { abbr: 'NAV', name: 'Navigation',                    max_marks: 100, marks_obtained: null },
  { abbr: 'POF', name: 'Principles of Flight & Performance', max_marks: 100, marks_obtained: null },
  { abbr: 'DGR', name: 'Dangerous Goods',               max_marks: 100, marks_obtained: null },
  { abbr: 'MET', name: 'Meteorology',                   max_marks: 100, marks_obtained: null },
  { abbr: 'FPL', name: 'Flight Planning',               max_marks: 100, marks_obtained: null },
];

const TABS = ['Overview', 'Student Results', 'Subject Analysis', 'Result Sheets'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function gradeFromMark(m) {
  if (m == null || m === '') return null;
  const n = Number(m);
  if (n > 95)  return 'OUTSTANDING';
  if (n >= 90) return 'DISTINCTION';
  if (n >= 76) return 'MERIT';
  if (n >= 75) return 'PASS';
  return 'FAILED';
}

function gradeBadge(grade) {
  if (!grade) return 'bg-gray-100 text-gray-500';
  if (grade === 'OUTSTANDING') return 'bg-purple-100 text-purple-700';
  if (grade === 'DISTINCTION') return 'bg-blue-100 text-blue-700';
  if (grade === 'MERIT')       return 'bg-emerald-100 text-emerald-700';
  if (grade === 'PASS')        return 'bg-green-100 text-green-700';
  return 'bg-red-100 text-red-700';
}

function courseTypeBadge(type) {
  if (['FDI', 'FDA'].includes(type)) return 'bg-emerald-100 text-emerald-700';
  if (['FDR', 'FTL'].includes(type)) return 'bg-violet-100 text-violet-700';
  if (type === 'HF')  return 'bg-amber-100 text-amber-700';
  if (type === 'NDG') return 'bg-red-100 text-red-700';
  return 'bg-blue-100 text-blue-700';
}

function emptyForm() {
  return {
    first_name: '', last_name: '', batch_name: '', course_name: '',
    course_type: 'FDI', training_mode: 'HYBRID',
    start_date: '', end_date: '', company: '',
    lead_instructor: '', instructors: '',
    subjects: DEFAULT_SUBJECTS.map(s => ({ ...s })),
    final_exam_score: '', final_marks: '', sheet_issued: false, sheet_date: '',
  };
}

// ── Import Excel Modal ────────────────────────────────────────────────────────
function ImportExcelModal({ onClose, onImported }) {
  const fileRef  = useRef(null);

  // step: 'upload' | 'preview' | 'importing' | 'done'
  const [step, setStep]           = useState('upload');
  const [file, setFile]           = useState(null);
  const [dragOver, setDragOver]   = useState(false);
  const [parsing, setParsing]     = useState(false);
  const [parseError, setParseError] = useState('');

  // Parsed preview data
  const [batchMeta, setBatchMeta] = useState(null);
  const [students, setStudents]   = useState([]);

  // Import overrides
  const [batchName,  setBatchName]  = useState('');
  const [courseType, setCourseType] = useState('FDI');
  const [company,    setCompany]    = useState('');

  // Import result
  const [importResult, setImportResult] = useState(null);

  const handleFile = (f) => {
    if (!f) return;
    if (!f.name.match(/\.xlsx?$/i)) {
      toast.error('Please select an Excel file (.xlsx or .xls)');
      return;
    }
    setFile(f);
    setParseError('');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    handleFile(f);
  };

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);
    setParseError('');
    try {
      const res = await parseExamResultsExcel(file);
      const { batchMeta: meta, students: rows } = res.data;
      setBatchMeta(meta);
      setStudents(rows);
      // Pre-fill batch name from course title if possible
      const titleUpper = (meta.courseTitle || '').toUpperCase();
      const batchGuess = titleUpper.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z\-\/\s]*\d{4}\b/);
      setBatchName(batchGuess ? batchGuess[0].replace(/\s+/g, '-') : '');
      setStep('preview');
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Failed to parse Excel file.';
      setParseError(msg);
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!batchName.trim()) {
      toast.error('Please enter a Batch Name before importing.');
      return;
    }
    setStep('importing');
    try {
      const res = await importExamResultsExcel(file, {
        batch_name:  batchName.trim(),
        course_type: courseType,
        company:     company.trim(),
      });
      setImportResult(res.data);
      setStep('done');
      onImported();
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Import failed.';
      toast.error(msg);
      setStep('preview');
    }
  };

  const reset = () => {
    setStep('upload');
    setFile(null);
    setBatchMeta(null);
    setStudents([]);
    setBatchName('');
    setParseError('');
    setImportResult(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center">
              <HiOutlineUpload className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Import Exam Results from Excel</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {step === 'upload'    && 'Upload your IFOA exam results workbook'}
                {step === 'preview'   && `${students.length} student${students.length !== 1 ? 's' : ''} found — review before importing`}
                {step === 'importing' && 'Saving records to database…'}
                {step === 'done'      && 'Import complete'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-0 px-6 pt-4 pb-2 flex-shrink-0">
          {['Upload', 'Preview', 'Import'].map((label, i) => {
            const stepIdx = { upload: 0, preview: 1, importing: 2, done: 2 }[step];
            const done    = i < stepIdx;
            const active  = i === stepIdx;
            return (
              <div key={label} className="flex items-center">
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                    ${done   ? 'bg-emerald-500 text-white'
                    : active ? 'bg-[#0000ff] text-white'
                    :          'bg-gray-100 text-gray-400'}`}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span className={`text-xs font-medium ${active ? 'text-gray-900' : 'text-gray-400'}`}>
                    {label}
                  </span>
                </div>
                {i < 2 && <div className="w-8 h-px bg-gray-200 mx-3" />}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── STEP: Upload ── */}
          {step === 'upload' && (
            <div className="space-y-5">
              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors
                  ${dragOver ? 'border-[#0000ff] bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={e => handleFile(e.target.files[0])}
                />
                <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <HiOutlineUpload className="w-7 h-7 text-emerald-500" />
                </div>
                {file ? (
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{file.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold text-gray-700">Drop your Excel file here</p>
                    <p className="text-xs text-gray-400 mt-1">or click to browse · .xlsx / .xls · max 10 MB</p>
                  </div>
                )}
              </div>

              {/* Format hint */}
              <div className="bg-blue-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-blue-700 mb-2">Expected workbook format</p>
                <ul className="text-xs text-blue-600 space-y-1 list-disc list-inside">
                  <li><strong>Sheet 1</strong> — Summary sheet with course metadata (title, date range, instructors) and a student score table</li>
                  <li><strong>Sheets 2+</strong> — Individual student result sheets (used to map subject full names)</li>
                  <li>Matches the standard IFOA Exam Results Report workbook</li>
                </ul>
              </div>

              {parseError && (
                <div className="flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
                  <HiOutlineExclamationCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700">{parseError}</p>
                </div>
              )}
            </div>
          )}

          {/* ── STEP: Preview ── */}
          {step === 'preview' && batchMeta && (
            <div className="space-y-5">
              {/* Detected metadata */}
              <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <p className="text-gray-400 font-medium mb-0.5">Course Title</p>
                  <p className="text-gray-800 font-semibold">{batchMeta.courseTitle}</p>
                </div>
                <div>
                  <p className="text-gray-400 font-medium mb-0.5">Training Mode</p>
                  <p className="text-gray-800 font-semibold">{batchMeta.trainingMode}</p>
                </div>
                <div>
                  <p className="text-gray-400 font-medium mb-0.5">Date Range</p>
                  <p className="text-gray-800 font-semibold">{batchMeta.startDate} → {batchMeta.endDate}</p>
                </div>
                <div>
                  <p className="text-gray-400 font-medium mb-0.5">Lead Instructor</p>
                  <p className="text-gray-800 font-semibold">{batchMeta.leadInstructor || '–'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-gray-400 font-medium mb-0.5">Other Instructors</p>
                  <p className="text-gray-800 font-semibold">{batchMeta.instructors.join(', ') || '–'}</p>
                </div>
              </div>

              {/* Import settings */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">Import Settings</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Batch Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. NOV-DEC 2024"
                      value={batchName}
                      onChange={e => setBatchName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Course Type</label>
                    <select
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={courseType}
                      onChange={e => setCourseType(e.target.value)}
                    >
                      {COURSE_TYPES.map(ct => (
                        <option key={ct.value} value={ct.value}>{ct.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Company / Airline</label>
                    <input
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Optional"
                      value={company}
                      onChange={e => setCompany(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Student preview table */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-3">
                  Students to Import ({students.length})
                </p>
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        <th className="px-3 py-2.5 font-semibold text-gray-600 uppercase tracking-wide">#</th>
                        <th className="px-3 py-2.5 font-semibold text-gray-600 uppercase tracking-wide">Name</th>
                        {students[0]?.subjects?.map(s => (
                          <th key={s.abbr} className="px-3 py-2.5 font-semibold text-gray-600 uppercase tracking-wide text-center">
                            {s.abbr}
                          </th>
                        ))}
                        <th className="px-3 py-2.5 font-semibold text-gray-600 uppercase tracking-wide text-center">Exam</th>
                        <th className="px-3 py-2.5 font-semibold text-gray-600 uppercase tracking-wide text-center">Avg</th>
                        <th className="px-3 py-2.5 font-semibold text-gray-600 uppercase tracking-wide text-center">Grade</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {students.map((s, i) => {
                        const grade = gradeFromMark(s.final_marks);
                        return (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                            <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">
                              {s.first_name} {s.last_name}
                            </td>
                            {s.subjects?.map(sub => (
                              <td key={sub.abbr} className="px-3 py-2 text-center text-gray-700">
                                {sub.marks_obtained ?? <span className="text-gray-300">–</span>}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-center text-gray-700">
                              {s.final_exam_score ?? <span className="text-gray-300">–</span>}
                            </td>
                            <td className="px-3 py-2 text-center font-semibold text-gray-900">
                              {s.final_marks != null ? Number(s.final_marks).toFixed(2) : '–'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`px-1.5 py-0.5 rounded-full font-semibold ${gradeBadge(grade)}`}>
                                {grade || '–'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP: Importing ── */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 border-4 border-blue-100 border-t-[#0000ff] rounded-full animate-spin" />
              <p className="text-sm font-medium text-gray-600">
                Saving {students.length} student record{students.length !== 1 ? 's' : ''} to the database…
              </p>
            </div>
          )}

          {/* ── STEP: Done ── */}
          {step === 'done' && importResult && (
            <div className="space-y-5">
              {/* Summary banner */}
              <div className={`rounded-xl p-5 flex items-center gap-4
                ${importResult.failCount === 0 ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0
                  ${importResult.failCount === 0 ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                  {importResult.failCount === 0
                    ? <HiOutlineCheckCircle className="w-7 h-7 text-emerald-600" />
                    : <HiOutlineExclamationCircle className="w-7 h-7 text-amber-600" />}
                </div>
                <div>
                  <p className={`font-semibold text-sm ${importResult.failCount === 0 ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {importResult.successCount} of {importResult.successCount + importResult.failCount} records imported successfully
                  </p>
                  <p className={`text-xs mt-0.5 ${importResult.failCount === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {importResult.failCount === 0
                      ? 'All student exam results have been added to the database.'
                      : `${importResult.failCount} record(s) failed — see details below.`}
                  </p>
                </div>
              </div>

              {/* Saved list */}
              {importResult.saved?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Imported</p>
                  <div className="space-y-1">
                    {importResult.saved.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                        <HiOutlineCheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                        {s.participant_name}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Failed list */}
              {importResult.failed?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">Failed</p>
                  <div className="space-y-1">
                    {importResult.failed.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg p-2">
                        <HiOutlineExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span><strong>{f.participant_name}</strong>: {f.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="border-t border-gray-100 p-4 flex justify-between gap-3 flex-shrink-0">
          <div>
            {step === 'preview' && (
              <button onClick={reset}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                ← Back
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              {step === 'done' ? 'Close' : 'Cancel'}
            </button>

            {step === 'upload' && (
              <button
                onClick={handleParse}
                disabled={!file || parsing}
                className="px-5 py-2 text-sm font-semibold text-white bg-[#0000ff] rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {parsing && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {parsing ? 'Parsing…' : 'Parse File →'}
              </button>
            )}

            {step === 'preview' && (
              <button
                onClick={handleImport}
                disabled={!batchName.trim()}
                className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
              >
                <HiOutlineDownload className="w-4 h-4" />
                Import {students.length} Record{students.length !== 1 ? 's' : ''}
              </button>
            )}

            {step === 'done' && importResult?.failCount > 0 && (
              <button onClick={reset}
                className="px-5 py-2 text-sm font-semibold text-white bg-[#0000ff] rounded-lg hover:bg-blue-700">
                Import Another File
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Add / Edit Modal ──────────────────────────────────────────────────────────
function ResultFormModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(() => {
    if (!initial) return emptyForm();
    return {
      ...initial,
      instructors: Array.isArray(initial.instructors) ? initial.instructors.join(', ') : '',
      subjects: initial.subjects?.length ? initial.subjects : DEFAULT_SUBJECTS.map(s => ({ ...s })),
      final_exam_score: initial.final_exam_score ?? '',
      final_marks: initial.final_marks ?? '',
    };
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const setSubject = (i, v) => {
    const subs = [...form.subjects];
    subs[i] = { ...subs[i], marks_obtained: v === '' ? null : Number(v) };
    set('subjects', subs);
  };

  const handleSave = async () => {
    if (!form.first_name || !form.last_name || !form.batch_name || !form.course_name || !form.start_date || !form.end_date) {
      toast.error('Please fill in all required fields.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        instructors: form.instructors.split(',').map(s => s.trim()).filter(Boolean),
        final_exam_score: form.final_exam_score !== '' ? Number(form.final_exam_score) : null,
        final_marks: form.final_marks !== '' ? Number(form.final_marks) : null,
      };
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white z-10 flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {initial ? 'Edit Exam Result' : 'Add Exam Result'}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Student */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Student Information</h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'First Name *', key: 'first_name' },
                { label: 'Last Name *',  key: 'last_name'  },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form[key]} onChange={e => set(key, e.target.value)} />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Company / Airline</label>
                <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.company} onChange={e => set('company', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Batch */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Batch & Course</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Batch Name *</label>
                <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. NOV-DEC 2024"
                  value={form.batch_name} onChange={e => set('batch_name', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Course Type *</label>
                <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.course_type} onChange={e => set('course_type', e.target.value)}>
                  {COURSE_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Course Name *</label>
                <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Flight Dispatch Initial Training / Promotion"
                  value={form.course_name} onChange={e => set('course_name', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start Date *</label>
                <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.start_date} onChange={e => set('start_date', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End Date *</label>
                <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.end_date} onChange={e => set('end_date', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Training Mode</label>
                <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.training_mode} onChange={e => set('training_mode', e.target.value)}>
                  {['HYBRID','ONLINE','IN-PERSON'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Lead Instructor</label>
                <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.lead_instructor} onChange={e => set('lead_instructor', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Other Instructors (comma-separated)</label>
                <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. John Smith, Jane Doe"
                  value={form.instructors} onChange={e => set('instructors', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Subject Scores */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Subject Scores</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {form.subjects.map((s, i) => (
                <div key={s.abbr}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    {s.abbr} – {s.name}
                  </label>
                  <input type="number" min="0" max="100"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="–"
                    value={s.marks_obtained ?? ''}
                    onChange={e => setSubject(i, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Final Marks */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Final Marks & Sheet</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Final Exam Score</label>
                <input type="number" min="0" max="100"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.final_exam_score} onChange={e => set('final_exam_score', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Overall Average / Final Marks</label>
                <input type="number" min="0" max="100"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.final_marks} onChange={e => set('final_marks', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sheet Date</label>
                <input type="date"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.sheet_date} onChange={e => set('sheet_date', e.target.value)} />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" className="rounded"
                    checked={form.sheet_issued}
                    onChange={e => set('sheet_issued', e.target.checked)} />
                  Sheet Already Issued
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 flex justify-end gap-3">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0000ff] rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {initial ? 'Save Changes' : 'Add Result'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Student Detail Modal ──────────────────────────────────────────────────────
function StudentDetailModal({ student, onClose, onIssueSheet }) {
  const [issuing, setIssuing] = useState(false);

  const handleIssue = async () => {
    setIssuing(true);
    try {
      await onIssueSheet(student._id || student.id);
      toast.success('Result sheet marked as issued.');
      onClose();
    } catch {
      toast.error('Failed to update sheet status.');
    } finally {
      setIssuing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white z-10 flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {student.participant_name || `${student.first_name} ${student.last_name}`}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{student.batch_name} · {student.course_type}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Score overview */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">
                {student.final_marks != null ? Number(student.final_marks).toFixed(2) : '–'}
              </p>
              <p className="text-xs text-gray-500 mt-1">Final Marks</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{student.final_exam_score ?? '–'}</p>
              <p className="text-xs text-gray-500 mt-1">Exam Score</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${gradeBadge(student.overall_grade)}`}>
                {student.overall_grade || 'N/A'}
              </span>
              <p className="text-xs text-gray-500 mt-1">Grade</p>
            </div>
          </div>

          {/* Subject scores */}
          {student.subjects?.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Subject Scores</h3>
              <div className="grid grid-cols-2 gap-2">
                {student.subjects.map((s) => (
                  <div key={s.abbr} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-xs font-semibold text-gray-700">{s.abbr}</p>
                      <p className="text-[10px] text-gray-400">{s.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{s.marks_obtained ?? '–'}</p>
                      {s.grade && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${gradeBadge(s.grade)}`}>
                          {s.grade}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Company',         student.company || '–'],
              ['Mode',            student.training_mode],
              ['Start',           student.start_date],
              ['End',             student.end_date],
              ['Lead Instructor', student.lead_instructor || '–'],
              ['Sheet Date',      student.sheet_date || '–'],
            ].map(([label, val]) => (
              <div key={label}>
                <span className="text-gray-500">{label}: </span>
                <span className="font-medium text-gray-800">{val}</span>
              </div>
            ))}
          </div>

          {/* Sheet status */}
          <div className={`rounded-xl p-4 flex items-center gap-3 ${student.sheet_issued ? 'bg-green-50' : 'bg-amber-50'}`}>
            <HiOutlineDocumentText className={`w-6 h-6 flex-shrink-0 ${student.sheet_issued ? 'text-green-600' : 'text-amber-600'}`} />
            <div className="flex-1">
              <p className={`text-sm font-semibold ${student.sheet_issued ? 'text-green-700' : 'text-amber-700'}`}>
                {student.sheet_issued ? 'Result Sheet Issued' : 'Result Sheet Pending'}
              </p>
              <p className="text-xs text-gray-500">
                {student.sheet_issued
                  ? `Issued on ${student.sheet_date || 'unknown date'}`
                  : 'Sheet has not been issued yet'}
              </p>
            </div>
            {!student.sheet_issued && (
              <button onClick={handleIssue} disabled={issuing}
                className="px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">
                {issuing ? 'Updating…' : 'Mark as Issued'}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ExamResults() {
  const { isAdmin } = useAuth();
  const [results, setResults]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState(0);
  const [search, setSearch]           = useState('');
  const [filterType, setFilterType]   = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [batches, setBatches]         = useState([]);
  const [showForm, setShowForm]       = useState(false);
  const [showImport, setShowImport]   = useState(false);
  const [editTarget, setEditTarget]   = useState(null);
  const [viewStudent, setViewStudent] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterType)  params.course_type = filterType;
      if (filterBatch) params.batch_name  = filterBatch;
      if (search)      params.search      = search;
      const [rRes, bRes] = await Promise.all([getExamResults(params), getExamBatches()]);
      setResults(rRes.data);
      setBatches(bRes.data);
    } catch {
      toast.error('Failed to load exam results.');
    } finally {
      setLoading(false);
    }
  }, [filterType, filterBatch, search]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Derived stats
  const passCount  = results.filter(r => r.overall_grade && r.overall_grade !== 'FAILED').length;
  const passRate   = results.length ? Math.round((passCount / results.length) * 100) : 0;
  const avgMark    = results.length
    ? Math.round(results.reduce((acc, r) => acc + (r.final_marks ?? 0), 0) / results.length * 10) / 10
    : 0;
  const sheetCount = results.filter(r => r.sheet_issued).length;

  // Subject averages across all results
  const subjectAverages = (() => {
    const map = {};
    results.forEach(r => {
      (r.subjects || []).forEach(s => {
        if (s.marks_obtained != null) {
          if (!map[s.abbr]) map[s.abbr] = { name: s.name, abbr: s.abbr, total: 0, count: 0 };
          map[s.abbr].total += s.marks_obtained;
          map[s.abbr].count += 1;
        }
      });
    });
    return Object.values(map).map(v => ({
      ...v,
      avg: Math.round((v.total / v.count) * 10) / 10,
    }));
  })();

  const handleSave = async (payload) => {
    try {
      if (editTarget) {
        await updateExamResult(editTarget._id || editTarget.id, payload);
        toast.success('Exam result updated.');
      } else {
        await createExamResult(payload);
        toast.success('Exam result added.');
      }
      setShowForm(false);
      setEditTarget(null);
      fetchAll();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save exam result.');
      throw err;
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete result for ${name}?`)) return;
    try {
      await deleteExamResult(id);
      toast.success('Result deleted.');
      fetchAll();
    } catch {
      toast.error('Failed to delete result.');
    }
  };

  const handleIssueSheet = async (id) => {
    await issueResultSheet(id);
    fetchAll();
  };

  const openAdd  = ()     => { setEditTarget(null); setShowForm(true); };
  const openEdit = (item) => { setEditTarget(item); setShowForm(true); };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <HiOutlineClipboardList className="w-5 h-5 text-[#0000ff]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Exam Results & Result Sheets</h1>
            <p className="text-sm text-gray-500">Manage scores, grades, and issue result sheets</p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
            >
              <HiOutlineUpload className="w-4 h-4" />
              Import Excel
            </button>
            <button onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2 bg-[#0000ff] text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors">
              <HiOutlinePlus className="w-4 h-4" />
              Add Result
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Students', value: results.length,  Icon: HiOutlineUsers,       color: 'text-blue-600',    bg: 'bg-blue-50'   },
          { label: 'Batch Average',  value: `${avgMark}%`,   Icon: HiOutlineChartBar,     color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Pass Rate',      value: `${passRate}%`,  Icon: HiOutlineCheckCircle,  color: 'text-violet-600',  bg: 'bg-violet-50' },
          { label: 'Sheets Issued',  value: sheetCount,      Icon: HiOutlineDocumentText, color: 'text-amber-600',   bg: 'bg-amber-50'  },
        ].map(({ label, value, Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Main card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TABS.map((tab, i) => (
            <button key={tab} onClick={() => setActiveTab(i)}
              className={[
                'flex-shrink-0 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === i
                  ? 'border-[#0000ff] text-[#0000ff]'
                  : 'border-transparent text-gray-500 hover:text-gray-700',
              ].join(' ')}>
              {tab}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 p-4 border-b border-gray-50">
          <div className="relative flex-1 min-w-[180px]">
            <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search student, batch, company…"
              value={search} onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">All Course Types</option>
            {COURSE_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.value}</option>)}
          </select>
          <select
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={filterBatch} onChange={e => setFilterBatch(e.target.value)}>
            <option value="">All Batches</option>
            {batches.map(b => (
              <option key={b._id?.batch_name} value={b._id?.batch_name}>{b._id?.batch_name}</option>
            ))}
          </select>
          <button onClick={fetchAll}
            className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500" title="Refresh">
            <HiOutlineRefresh className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-3 border-blue-200 border-t-[#0000ff] rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* TAB 0 — Overview table */}
              {activeTab === 0 && (
                results.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <HiOutlineClipboardList className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No exam results found.</p>
                    {isAdmin && (
                      <button onClick={() => setShowImport(true)}
                        className="mt-3 text-sm font-semibold text-emerald-600 hover:underline flex items-center gap-1 mx-auto">
                        <HiOutlineUpload className="w-4 h-4" /> Import from Excel
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-left">
                          {['#','Student','Batch','Type','Final Marks','Grade','Sheet', isAdmin && 'Actions']
                            .filter(Boolean).map(h => (
                            <th key={h} className="px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {results.map((r, i) => (
                          <tr key={r._id || r.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                            <td className="px-4 py-3">
                              <button onClick={() => setViewStudent(r)}
                                className="font-medium text-gray-900 hover:text-[#0000ff] text-left">
                                {r.participant_name || `${r.first_name} ${r.last_name}`}
                              </button>
                              {r.company && <p className="text-xs text-gray-400">{r.company}</p>}
                            </td>
                            <td className="px-4 py-3 text-gray-600">{r.batch_name}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${courseTypeBadge(r.course_type)}`}>
                                {r.course_type}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold text-gray-900">
                              {r.final_marks != null ? Number(r.final_marks).toFixed(2) : '–'}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${gradeBadge(r.overall_grade)}`}>
                                {r.overall_grade || '–'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {r.sheet_issued
                                ? <span className="text-xs text-green-600 font-medium flex items-center gap-1"><HiOutlineCheckCircle className="w-3.5 h-3.5" /> Issued</span>
                                : <span className="text-xs text-amber-600 font-medium">Pending</span>}
                            </td>
                            {isAdmin && (
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  <button onClick={() => setViewStudent(r)} title="View"
                                    className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-[#0000ff]">
                                    <HiOutlineEye className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => openEdit(r)} title="Edit"
                                    className="p-1.5 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-[#0000ff]">
                                    <HiOutlinePencil className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => handleDelete(r._id || r.id, r.participant_name || `${r.first_name} ${r.last_name}`)} title="Delete"
                                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600">
                                    <HiOutlineTrash className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {/* TAB 1 — Student cards */}
              {activeTab === 1 && (
                results.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <HiOutlineAcademicCap className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No results to display.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {results.map(r => (
                      <div key={r._id || r.id}
                        className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                        onClick={() => setViewStudent(r)}>
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h3 className="font-semibold text-gray-900 text-sm">
                              {r.participant_name || `${r.first_name} ${r.last_name}`}
                            </h3>
                            <p className="text-xs text-gray-400">{r.company || r.batch_name}</p>
                          </div>
                          <span className={`text-xs font-bold px-2 py-1 rounded-full ${gradeBadge(r.overall_grade)}`}>
                            {r.overall_grade || '–'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          {[
                            { val: r.final_marks != null ? Number(r.final_marks).toFixed(2) : '–', label: 'Avg' },
                            { val: r.final_exam_score ?? '–',  label: 'Exam'     },
                            { val: r.subjects?.filter(s => s.marks_obtained != null).length ?? 0, label: 'Subjects' },
                          ].map(({ val, label }) => (
                            <div key={label} className="bg-gray-50 rounded-lg p-2">
                              <p className="text-base font-bold text-gray-900">{val}</p>
                              <p className="text-[10px] text-gray-400">{label}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* TAB 2 — Subject analysis */}
              {activeTab === 2 && (
                subjectAverages.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <HiOutlineChartBar className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No subject scores recorded yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {subjectAverages.sort((a, b) => b.avg - a.avg).map(s => {
                      const grade = gradeFromMark(s.avg);
                      return (
                        <div key={s.abbr} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="text-base font-bold text-gray-900">{s.abbr}</p>
                              <p className="text-xs text-gray-400">{s.name}</p>
                            </div>
                            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${gradeBadge(grade)}`}>
                              {grade || '–'}
                            </span>
                          </div>
                          <div className="flex items-end gap-2 mt-2">
                            <p className="text-3xl font-bold text-gray-900">{s.avg}</p>
                            <p className="text-xs text-gray-400 mb-1">/ 100 · {s.count} students</p>
                          </div>
                          <div className="mt-3 w-full bg-gray-100 rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-[#0000ff] transition-all"
                              style={{ width: `${s.avg}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {/* TAB 3 — Result sheets */}
              {activeTab === 3 && (
                results.length === 0 ? (
                  <div className="text-center py-16 text-gray-400">
                    <HiOutlineDocumentText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No result sheets available.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 text-left">
                          {['#','Student','Batch','Sheet Date','Status','Actions'].map(h => (
                            <th key={h} className="px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {results.map((r, i) => (
                          <tr key={r._id || r.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                            <td className="px-4 py-3 font-medium text-gray-900">
                              {r.participant_name || `${r.first_name} ${r.last_name}`}
                            </td>
                            <td className="px-4 py-3 text-gray-600">{r.batch_name}</td>
                            <td className="px-4 py-3 text-gray-600">{r.sheet_date || '–'}</td>
                            <td className="px-4 py-3">
                              {r.sheet_issued
                                ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-full">
                                    <HiOutlineCheckCircle className="w-3.5 h-3.5" /> Issued
                                  </span>
                                : <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-1 rounded-full">Pending</span>}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <button onClick={() => setViewStudent(r)}
                                  className="flex items-center gap-1 text-xs font-medium text-[#0000ff] hover:underline">
                                  <HiOutlineEye className="w-3.5 h-3.5" /> View
                                </button>
                                {isAdmin && !r.sheet_issued && (
                                  <button onClick={() => handleIssueSheet(r._id || r.id)}
                                    className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:underline">
                                    <HiOutlineDownload className="w-3.5 h-3.5" /> Issue
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showImport && (
          <ImportExcelModal
            onClose={() => setShowImport(false)}
            onImported={() => { fetchAll(); }}
          />
        )}
        {showForm && (
          <ResultFormModal
            initial={editTarget}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditTarget(null); }}
          />
        )}
        {viewStudent && (
          <StudentDetailModal
            student={viewStudent}
            onClose={() => setViewStudent(null)}
            onIssueSheet={handleIssueSheet}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
