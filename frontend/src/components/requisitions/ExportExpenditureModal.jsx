import React, { useState } from 'react';
import { Button, Input } from '../ui';

const ExportExpenditureModal = ({ projects = [], defaultWorkOrder = '', onConfirm, onClose, loading = false }) => {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [selectedWO, setSelectedWO] = useState(defaultWorkOrder || 'All');

  const handleExport = () => {
    onConfirm({
      dateRange: { start: start || null, end: end || null },
      workOrderFilter: selectedWO === 'All' ? null : selectedWO
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="glass-panel p-6 rounded-3xl max-w-md w-full border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.7)] text-left space-y-5">
        <div className="flex items-center gap-3 pb-4 border-b border-white/5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 shrink-0">
            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-100">
              Export Expenditure Sheet
            </h2>
            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
              COMBINED INFLOW (FUND REQUESTS) &amp; OUTFLOW (REQUISITIONS)
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-400 mb-1.5">
              Work Order Filter
            </label>
            <select
              value={selectedWO}
              onChange={(e) => setSelectedWO(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/80 border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50"
            >
              <option value="All">All Work Orders</option>
              {projects.map((p) => {
                const wo = typeof p === 'string' ? p : p.work_order_no;
                const desc = typeof p === 'object' && p.site_details ? ` (${p.site_details})` : '';
                return (
                  <option key={wo} value={wo}>
                    {wo}{desc}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-400 mb-1.5">
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
              <label className="block text-[10px] uppercase tracking-wider font-extrabold text-slate-400 mb-1.5">
                End Date (Optional)
              </label>
              <Input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full bg-slate-900/50 border-white/10 text-slate-200"
              />
            </div>
          </div>

          <p className="text-[10px] text-slate-400/80 italic leading-relaxed">
            * Generates the 17-column combined cashbook format matching management requirements. Leave dates blank to export all matching records.
          </p>
        </div>

        <div className="flex gap-3 justify-end pt-3 border-t border-white/5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            loading={loading}
            onClick={handleExport}
            className="shadow-lg shadow-emerald-500/20"
          >
            Download Excel
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ExportExpenditureModal;
