import React, { useState } from 'react';
import { Select, Button } from '../ui';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const rowsFor = (slabs, m) => slabs.filter(s => s.month === m).map(({ lower_bound, upper_bound, deduction_amount }) => ({ lower_bound, upper_bound, deduction_amount }));
const amountKey = v => v === null ? null : String(v).replace(/^0+(?=\d)/, '').replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
const same = (a, b) => JSON.stringify(a.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, amountKey(v)])))) === JSON.stringify(b.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, amountKey(v)]))));
const blank = () => ({ lower_bound: '', upper_bound: null, deduction_amount: '' });

function formatIndianCurrency(val) {
  if (val === null || val === undefined || val === '') return '';
  const str = String(val);
  const clean = str.replace(/,/g, '');
  if (!clean) return '';

  const hasTrailingDot = clean.endsWith('.');
  const [intPart, ...decParts] = clean.split('.');

  let formattedInt = intPart;
  if (intPart.length > 3) {
    const lastThree = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    formattedInt = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
  }

  if (decParts.length > 0) {
    return formattedInt + '.' + decParts.join('');
  }
  if (hasTrailingDot) {
    return formattedInt + '.';
  }
  return formattedInt;
}

export default function PTSlabEditor({ slabs, onChange, effectiveFrom }) {
  const [noLevy, setNoLevy] = useState(() => slabs.length === 12 && slabs.every(s => amountKey(s.lower_bound) === '0' && s.upper_bound === null && amountKey(s.deduction_amount) === '0'));
  const [month, setMonth] = useState('2');
  const [showExceptions, setShowExceptions] = useState(false);
  const [explicit, setExplicit] = useState([]);

  const schedules = months.map((_, i) => rowsFor(slabs, i + 1));
  const base = schedules.reduce((best, rows) => schedules.filter(s => same(s, rows)).length > schedules.filter(s => same(s, best)).length ? rows : best, schedules[0]);
  const exceptions = months.map((_, i) => i + 1).filter(m => explicit.includes(m) || !same(rowsFor(slabs, m), base));

  const write = (normal, overrides) => onChange(months.flatMap((_, i) => (overrides[i + 1] || normal).map(s => ({ ...s, month: i + 1 }))));
  const update = (m, rows) => {
    const overrides = Object.fromEntries(exceptions.map(n => [n, rowsFor(slabs, n)]));
    if (m === 0) write(rows, overrides);
    else write(base, { ...overrides, [m]: rows });
  };

  const handleAmountChange = (e, m, rows, rowIndex, key) => {
    const input = e.target;
    const cursorPos = typeof input.selectionStart === 'number' ? input.selectionStart : null;
    const oldVal = input.value;
    const rawVal = e.target.value;
    let clean = rawVal.replace(/,/g, '').trim();

    // Normalize leading zeros before non-zero digits
    if (/^0+[1-9]/.test(clean)) {
      clean = clean.replace(/^0+/, '');
    }

    // Validate decimal format: digits, optional dot, at most 4 decimals
    if (clean !== '' && !/^\d*(\.\d{0,4})?$/.test(clean)) {
      return;
    }

    const stateVal = (key === 'upper_bound' && clean === '') ? null : clean;
    update(m, rows.map((r, j) => j === rowIndex ? { ...r, [key]: stateVal } : r));

    if (cursorPos !== null) {
      const commasBefore = (oldVal.slice(0, cursorPos).match(/,/g) || []).length;
      const digitsBefore = Math.max(0, cursorPos - commasBefore);
      const newFormatted = formatIndianCurrency(stateVal ?? '');

      let newCursor = 0;
      let digitsSeen = 0;
      while (newCursor < newFormatted.length && digitsSeen < digitsBefore) {
        if (newFormatted[newCursor] !== ',') {
          digitsSeen++;
        }
        newCursor++;
      }

      requestAnimationFrame(() => {
        if (input && document.activeElement === input && typeof input.setSelectionRange === 'function') {
          input.setSelectionRange(newCursor, newCursor);
        }
      });
    }
  };

  const table = (rows, m, prefix) => (
    <div className="space-y-3">
      {/* Table Column Headers */}
      {rows.length > 0 && (
        <div className="hidden sm:grid sm:grid-cols-12 gap-3 px-3 py-1 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          <div className="sm:col-span-1 text-center">#</div>
          <div className="sm:col-span-4">Salary From (₹)</div>
          <div className="sm:col-span-4">Salary To (₹)</div>
          <div className="sm:col-span-2">Monthly Tax (₹)</div>
          <div className="sm:col-span-1 text-center">Action</div>
        </div>
      )}

      {/* Rows */}
      {rows.map((s, i) => (
        <div
          key={i}
          className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center p-3 sm:p-2.5 rounded-xl bg-slate-950/40 border border-white/5 hover:border-white/10 transition"
        >
          {/* Slab index */}
          <div className="sm:col-span-1 flex items-center justify-between sm:justify-center">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-800 text-slate-300 border border-white/5">
              #{i + 1}
            </span>
            <span className="sm:hidden text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {prefix} {i + 1}
            </span>
          </div>

          {/* Lower bound */}
          <div className="sm:col-span-4">
            <label htmlFor={`${prefix}-${m}-${i}-lower_bound`} className="sr-only">
              {prefix} {i + 1} lower bound
            </label>
            <div className="relative flex items-center w-full">
              <span className="absolute left-3 text-slate-500 font-mono text-xs select-none pointer-events-none">₹</span>
              <input
                id={`${prefix}-${m}-${i}-lower_bound`}
                aria-label={`${prefix} ${i + 1} lower bound`}
                type="text"
                inputMode="decimal"
                value={formatIndianCurrency(s.lower_bound ?? '')}
                onChange={e => handleAmountChange(e, m, rows, i, 'lower_bound')}
                placeholder="0"
                className="w-full glass-input pl-7 pr-3 py-2 text-sm font-mono font-medium rounded-xl outline-none focus:border-amber-400/60 focus:ring-1 focus:ring-amber-400/30 text-slate-100 placeholder:text-slate-600 transition"
              />
            </div>
          </div>

          {/* Upper bound */}
          <div className="sm:col-span-4">
            <label htmlFor={`${prefix}-${m}-${i}-upper_bound`} className="sr-only">
              {prefix} {i + 1} upper bound
            </label>
            <div className="relative flex items-center w-full">
              <span className="absolute left-3 text-slate-500 font-mono text-xs select-none pointer-events-none">₹</span>
              <input
                id={`${prefix}-${m}-${i}-upper_bound`}
                aria-label={`${prefix} ${i + 1} upper bound`}
                type="text"
                inputMode="decimal"
                value={formatIndianCurrency(s.upper_bound ?? '')}
                onChange={e => handleAmountChange(e, m, rows, i, 'upper_bound')}
                placeholder="No limit (Max)"
                className="w-full glass-input pl-7 pr-3 py-2 text-sm font-mono font-medium rounded-xl outline-none focus:border-amber-400/60 focus:ring-1 focus:ring-amber-400/30 text-slate-100 placeholder:text-slate-600 transition"
              />
            </div>
          </div>

          {/* Deduction amount */}
          <div className="sm:col-span-2">
            <label htmlFor={`${prefix}-${m}-${i}-deduction_amount`} className="sr-only">
              {prefix} {i + 1} deduction amount
            </label>
            <div className="relative flex items-center w-full">
              <span className="absolute left-3 text-slate-500 font-mono text-xs select-none pointer-events-none">₹</span>
              <input
                id={`${prefix}-${m}-${i}-deduction_amount`}
                aria-label={`${prefix} ${i + 1} deduction amount`}
                type="text"
                inputMode="decimal"
                value={formatIndianCurrency(s.deduction_amount ?? '')}
                onChange={e => handleAmountChange(e, m, rows, i, 'deduction_amount')}
                placeholder="0"
                className="w-full glass-input pl-7 pr-3 py-2 text-sm font-mono font-medium rounded-xl outline-none focus:border-amber-400/60 focus:ring-1 focus:ring-amber-400/30 text-slate-100 placeholder:text-slate-600 transition"
              />
            </div>
          </div>

          {/* Remove action button */}
          <div className="col-span-1 flex justify-end sm:justify-center">
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="h-9 w-full sm:w-9 px-2.5 sm:px-0 rounded-xl flex items-center justify-center gap-1.5"
              title={`Remove ${prefix.toLowerCase()} ${i + 1}`}
              aria-label={`Remove ${prefix.toLowerCase()} ${i + 1}`}
              onClick={() => update(m, rows.filter((_, j) => i !== j))}
            >
              <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="sm:hidden text-xs font-semibold">Remove {prefix.toLowerCase()} {i + 1}</span>
              <span className="sr-only">Remove {prefix.toLowerCase()} {i + 1}</span>
            </Button>
          </div>
        </div>
      ))}

      {/* Add slab button */}
      <div className="pt-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => update(m, [...rows, blank()])}
          className="font-medium hover:border-amber-400/40 border border-white/10 rounded-xl"
          icon={<svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>}
        >
          {m === 0 ? 'Add slab' : `Add ${months[m - 1]} slab`}
        </Button>
      </div>
    </div>
  );

  return (
    <fieldset className="col-span-full rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-4">
      {/* Schedule Header */}
      <div className="space-y-1">
        <legend className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          PT slab schedule
        </legend>
        <p className="text-xs text-slate-400">
          Effective from {effectiveFrom || 'the revision effective date'}. This normal schedule applies to every month unless a month exception is recorded. New rates require a new effective-dated revision.
        </p>
      </div>

      {/* No PT Levy Toggle Card */}
      <div className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition">
        <label className="flex items-center gap-2.5 text-sm font-medium text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={noLevy}
            onChange={e => {
              setNoLevy(e.target.checked);
              setExplicit([]);
              setShowExceptions(false);
              onChange(e.target.checked ? months.map((_, i) => ({ month: i + 1, lower_bound: '0', upper_bound: null, deduction_amount: '0' })) : []);
            }}
            className="rounded border-white/20 text-amber-500 focus:ring-amber-500/30 w-4 h-4 bg-slate-800"
          />
          <span>No PT levy for this state during this effective period</span>
        </label>
      </div>

      {noLevy ? (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          An explicit zero schedule will be saved for this revision. Record the government notification in the confirmation evidence; no employee exemption is created.
        </div>
      ) : (
        <>
          {table(base, 0, 'Slab')}

          {/* Helper notice */}
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-slate-950/40 border border-white/5 text-slate-400 text-xs">
            <svg className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Salary ranges use lower inclusive / upper exclusive boundaries. Leave the final upper limit blank.</span>
          </div>

          {/* Month Exceptions Trigger */}
          <div className="pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowExceptions(v => !v)}
              className="text-xs font-semibold text-slate-300 hover:text-white"
            >
              {showExceptions ? 'Hide month exceptions' : 'Month exceptions (optional)'}
            </Button>
          </div>

          {/* Month Exceptions Drawer */}
          {(showExceptions || exceptions.length > 0) && (
            <div className="space-y-4 pt-3 border-t border-white/5">
              <p className="text-xs text-slate-400">
                Use only when the government schedule specifies different collection amounts for a particular month.
              </p>

              {exceptions.map(m => (
                <fieldset key={m} className="border border-white/5 rounded-2xl p-3.5 bg-white/[0.02] space-y-3">
                  <legend className="text-xs font-bold text-amber-400 uppercase tracking-wider px-2">
                    {months[m - 1]} exception
                  </legend>
                  {table(rowsFor(slabs, m), m, months[m - 1] + ' slab')}
                  <div className="flex justify-end pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-rose-400 hover:text-rose-300"
                      onClick={() => {
                        setExplicit(old => old.filter(n => n !== m));
                        write(base, Object.fromEntries(exceptions.filter(n => n !== m).map(n => [n, rowsFor(slabs, n)])));
                      }}
                    >
                      Use normal schedule for {months[m - 1]}
                    </Button>
                  </div>
                </fieldset>
              ))}

              <div className="flex flex-col sm:flex-row items-end gap-3 p-3.5 rounded-xl bg-slate-950/40 border border-white/5">
                <div className="w-full sm:w-64">
                  <Select
                    label="Exception month"
                    value={month}
                    options={months.map((name, i) => ({ value: String(i + 1), label: name }))}
                    onChange={e => setMonth(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  disabled={exceptions.includes(Number(month)) || !base.length}
                  onClick={() => {
                    setExplicit(old => [...old, Number(month)]);
                    write(base, { ...Object.fromEntries(exceptions.map(m => [m, rowsFor(slabs, m)])), [Number(month)]: base });
                  }}
                >
                  Add month exception
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
