import React from 'react';
import { Badge } from '../ui';

const SheetCard = ({ sheet, selected, onClick }) => {
  const isOpen = sheet.sheet_status === 'Open';

  return (
    <button
      type="button"
      onClick={() => onClick?.(sheet)}
      className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 ${
        selected
          ? 'bg-amber-500/10 border-amber-500/30'
          : 'bg-white/[0.02] border-white/10 hover:border-white/20 hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-slate-100 font-mono">{sheet.sheet_number}</span>
        <Badge variant={isOpen ? 'amber' : 'blue'}>{sheet.sheet_status}</Badge>
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
        {sheet.row_count_at_submission != null && (
          <span>{sheet.row_count_at_submission} item{sheet.row_count_at_submission === 1 ? '' : 's'}</span>
        )}
        {sheet.submitted_at && (
          <span>Submitted {new Date(sheet.submitted_at).toLocaleDateString('en-IN')}</span>
        )}
        {!sheet.submitted_at && sheet.created_at && (
          <span>Created {new Date(sheet.created_at).toLocaleDateString('en-IN')}</span>
        )}
      </div>
    </button>
  );
};

export default SheetCard;
