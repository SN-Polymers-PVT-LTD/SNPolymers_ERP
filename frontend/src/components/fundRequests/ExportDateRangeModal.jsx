import React, { useState } from 'react';
import { Button, Input } from '../ui';

const ExportDateRangeModal = ({ onConfirm, onClose }) => {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const handleExport = () => {
    onConfirm({ start, end });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <div className="glass-panel p-6 rounded-3xl max-w-md w-full border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.7)] text-left">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-500/10 border border-amber-500/10">
            <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-100">
              Export to Excel
            </h2>
            <p className="text-[10px] text-slate-400 font-mono mt-0.5">FILTER DATA BY HO APPROVAL / ZO DATE</p>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-400 mb-2">
              Start Date (Optional)
            </label>
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full bg-slate-900/50 border-white/10 text-slate-200"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-400 mb-2">
              End Date (Optional)
            </label>
            <Input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="w-full bg-slate-900/50 border-white/10 text-slate-200"
            />
          </div>
          <p className="text-[10px] text-slate-500 italic">
            * Leave both dates blank to export the entire list matching your current dashboard view.
          </p>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-slate-200 font-bold text-xs uppercase tracking-wider transition"
          >
            Cancel
          </button>
          <Button
            onClick={handleExport}
            variant="primary"
            size="sm"
          >
            Export Excel
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ExportDateRangeModal;
