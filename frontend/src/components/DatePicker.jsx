import { useState, useRef, useEffect } from 'react';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str + 'T00:00:00');
  return isNaN(d) ? null : d;
}

function toYMD(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfMonth(y, m) { return new Date(y, m, 1); }
function daysInMonth(y, m)  { return new Date(y, m + 1, 0).getDate(); }

export default function DatePicker({ value, onChange, min, placeholder = 'mm/dd/yyyy', disabled = false, className = '' }) {
  const selected  = parseDate(value);
  const minDate   = parseDate(min);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [open,    setOpen]    = useState(false);
  const [viewY,   setViewY]   = useState((selected || today).getFullYear());
  const [viewM,   setViewM]   = useState((selected || today).getMonth());
  const [showYM,  setShowYM]  = useState(false); // month/year selector overlay

  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setShowYM(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Sync view to selected value when opened
  const handleOpen = () => {
    if (disabled) return;
    const base = selected || today;
    setViewY(base.getFullYear());
    setViewM(base.getMonth());
    setShowYM(false);
    setOpen(true);
  };

  const prevMonth = () => {
    if (viewM === 0) { setViewM(11); setViewY(y => y - 1); }
    else setViewM(m => m - 1);
  };
  const nextMonth = () => {
    if (viewM === 11) { setViewM(0); setViewY(y => y + 1); }
    else setViewM(m => m + 1);
  };

  const selectDay = (day) => {
    const d = new Date(viewY, viewM, day);
    onChange(toYMD(d));
    setOpen(false);
    setShowYM(false);
  };

  const clearDate = () => {
    onChange('');
    setOpen(false);
    setShowYM(false);
  };

  const goToday = () => {
    const t = new Date();
    setViewY(t.getFullYear());
    setViewM(t.getMonth());
    onChange(toYMD(t));
    setOpen(false);
    setShowYM(false);
  };

  // Build calendar grid
  const firstDow = startOfMonth(viewY, viewM).getDay(); // 0=Sun
  const dim      = daysInMonth(viewY, viewM);
  const prevDim  = daysInMonth(viewY, viewM === 0 ? 11 : viewM - 1);

  const cells = [];
  // leading days from prev month
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ day: prevDim - i, cur: false });
  // current month days
  for (let d = 1; d <= dim; d++) cells.push({ day: d, cur: true });
  // trailing days
  const trailing = 42 - cells.length;
  for (let d = 1; d <= trailing; d++) cells.push({ day: d, cur: false });

  const isDisabled = (day) => {
    if (!minDate) return false;
    const d = new Date(viewY, viewM, day);
    d.setHours(0, 0, 0, 0);
    return d < minDate;
  };

  const isSelected = (day) => {
    if (!selected) return false;
    return selected.getFullYear() === viewY &&
           selected.getMonth()    === viewM &&
           selected.getDate()     === day;
  };

  const isToday = (day) => {
    return today.getFullYear() === viewY &&
           today.getMonth()    === viewM &&
           today.getDate()     === day;
  };

  // Display value in input
  const displayVal = selected
    ? `${String(selected.getMonth()+1).padStart(2,'0')}/${String(selected.getDate()).padStart(2,'0')}/${selected.getFullYear()}`
    : '';

  // Years for selector
  const yearList = [];
  for (let y = today.getFullYear() - 5; y <= today.getFullYear() + 10; y++) yearList.push(y);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Input trigger */}
      <div
        onClick={handleOpen}
        className={`w-full flex items-center justify-between px-3 py-2 border border-primary-300 rounded-lg bg-white text-sm cursor-pointer transition-all duration-200 focus-within:ring-2 focus-within:ring-accent-400 focus-within:border-transparent ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary-400'}`}
      >
        <span className={displayVal ? 'text-primary-800' : 'text-primary-400'}>
          {displayVal || placeholder}
        </span>
        {/* Calendar icon */}
        <svg className="w-4 h-4 text-primary-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>

      {/* Dropdown calendar */}
      {open && (
        <div className="absolute z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-64"
          style={{ colorScheme: 'light' }}>

          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth}
              className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Month / Year label — click to open selector */}
            <button type="button" onClick={() => setShowYM(v => !v)}
              className="flex items-center gap-1 text-sm font-semibold text-gray-800 hover:text-blue-600 transition-colors px-2 py-0.5 rounded hover:bg-gray-100">
              {MONTHS[viewM]} {viewY}
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <button type="button" onClick={nextMonth}
              className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Month/Year overlay */}
          {showYM && (
            <div className="absolute inset-0 bg-white rounded-xl p-3 z-10 overflow-y-auto" style={{ maxHeight: '260px' }}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Month</p>
              <div className="grid grid-cols-3 gap-1 mb-3">
                {MONTHS.map((mo, i) => (
                  <button key={mo} type="button"
                    onClick={() => { setViewM(i); setShowYM(false); }}
                    className={`py-1 text-xs rounded-lg font-medium transition-colors ${
                      i === viewM ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-700'
                    }`}>
                    {mo.slice(0, 3)}
                  </button>
                ))}
              </div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Year</p>
              <div className="grid grid-cols-3 gap-1">
                {yearList.map(y => (
                  <button key={y} type="button"
                    onClick={() => { setViewY(y); setShowYM(false); }}
                    className={`py-1 text-xs rounded-lg font-medium transition-colors ${
                      y === viewY ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-700'
                    }`}>
                    {y}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((cell, idx) => {
              if (!cell.cur) {
                return <div key={idx} className="text-center py-1 text-xs text-gray-300">{cell.day}</div>;
              }
              const sel  = isSelected(cell.day);
              const dis  = isDisabled(cell.day);
              const tod  = isToday(cell.day);
              return (
                <button key={idx} type="button"
                  disabled={dis}
                  onClick={() => !dis && selectDay(cell.day)}
                  className={`text-center py-1 text-xs rounded-lg font-medium transition-colors leading-5
                    ${dis  ? 'text-gray-300 cursor-not-allowed' :
                      sel  ? 'bg-blue-600 text-white' :
                      tod  ? 'border border-blue-500 text-blue-600 hover:bg-blue-50' :
                             'text-gray-700 hover:bg-gray-100'}`}>
                  {cell.day}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <button type="button" onClick={clearDate}
              className="text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors">
              Clear
            </button>
            <button type="button" onClick={goToday}
              className="text-xs text-blue-600 hover:text-blue-700 font-semibold transition-colors">
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
