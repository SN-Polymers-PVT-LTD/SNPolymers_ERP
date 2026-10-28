import React from 'react';
const labels={PAY_HISTORY_OUTDATED:'FM: correct draft sources, then recalculate',MISSING_PAY_SOURCE:'Admin: salary effective dates missing',MISSING_POLICY:'Admin: salary calculation policy missing',ATTENDANCE_NOT_LOCKED:'Attendance awaiting lock',MISSING_LOCKED_ATTENDANCE:'Locked attendance missing',STATUTORY_PROFILE_REQUIRED:'Accounts: deduction setup required'};
import {groupPayrollBlockers} from './groupPayrollBlockers';
export default function PayrollBlockers({blockers=[]}){
 const groups=groupPayrollBlockers(blockers);
 return <div className="space-y-1 text-xs text-amber-300">
  <ul>{groups.map((g,i)=><li key={i}>{labels[g.code]||g.code}{g.dates.length>0?` — ${g.dates.length===1?g.dates[0]:`${g.dates.length} affected dates (${g.dates[0]} to ${g.dates.at(-1)})`}`:g.count>1?` (${g.count} checks)`:''}</li>)}</ul>
  {blockers.length>0&&<details><summary className="cursor-pointer">Daily diagnostic details ({blockers.length})</summary><ul className="max-h-48 overflow-auto">{blockers.map((b,i)=><li key={i}>{b.code} {b.date||''} {b.field||''}{b.reference?` · ${JSON.stringify(b.reference)}`:''}</li>)}</ul></details>}
 </div>;
}
