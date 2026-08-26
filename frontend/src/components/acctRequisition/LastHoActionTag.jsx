import React from 'react';
import { Badge } from '../ui';

const PROCESS_VARIANTS = {
  Approved: 'emerald',
  'Partially Approved': 'emerald',
  Hold: 'amber',
  'Returned for Correction': 'orange',
  Rejected: 'red'
};

// NB1: reads last_ho_process / last_ho_remarks — the snapshot of the PRIOR HO
// decision, populated by resubmit/reopen just before the live ho_process/
// ho_remarks columns are cleared. Deliberately NOT reading ho_process/ho_remarks
// here — those reflect the live/current cycle, not "last".
const LastHoActionTag = ({ item }) => {
  if (!item) return null;
  const shouldShow = (item.revision_number > 0 || item.is_reopened) && item.last_ho_process;
  if (!shouldShow) return null;

  return (
    <div className="flex flex-col gap-1 w-full">
      <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">
        Last HO Action
      </span>
      <Badge variant={PROCESS_VARIANTS[item.last_ho_process] || 'slate'}>
        {item.last_ho_process}
      </Badge>
      {item.last_ho_remarks && (
        <span className="text-[11px] text-slate-400 italic leading-snug line-clamp-2" title={item.last_ho_remarks}>
          "{item.last_ho_remarks}"
        </span>
      )}
    </div>
  );
};

export default LastHoActionTag;
