import React from 'react';

const TimelineProgress = ({ status }) => {
  const stages = [
    { label: 'Draft', key: 'draft' },
    { label: 'Submitted', key: 'submitted' },
    { label: 'Accounts Sheet', key: 'accounts' },
    { label: 'HO Outcome', key: 'outcome' }
  ];

  const getStageState = (stageKey) => {
    if (stageKey === 'draft') {
      return status === 'Draft' ? 'active' : 'completed';
    }
    if (stageKey === 'submitted') {
      return status === 'Draft' ? 'upcoming' : 'completed';
    }
    if (stageKey === 'accounts') {
      return status === 'Draft' || status === 'Cancelled' ? 'upcoming' : status === 'Pending' ? 'active' : 'completed';
    }
    if (stageKey === 'outcome') {
      return ['Approved', 'Hold', 'Returned', 'Rejected', 'Cancelled'].includes(status) ? 'completed' : 'upcoming';
    }

    return 'upcoming';
  };

  return (
    <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent text-left">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-6">Approval Timeline</span>
      <div className="relative flex items-center justify-between">
        
        {/* Connector Line */}
        <div className="absolute left-4 right-4 h-0.5 bg-slate-800 -translate-y-2 pointer-events-none z-0" />

        {stages.map((stage) => {
          const state = getStageState(stage.key);
          
          let circleClass = "bg-slate-900 border-slate-700 text-slate-600";
          let labelClass = "text-slate-500";
          let checkIcon;

          if (state === 'completed') {
            circleClass = "bg-emerald-500/20 border-emerald-500 text-emerald-400 z-10 scale-110";
            labelClass = "text-slate-300 font-extrabold";
            checkIcon = (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            );
          } else if (state === 'active') {
            circleClass = "bg-amber-500/20 border-amber-500 text-amber-400 z-10 scale-110 animate-pulse";
            labelClass = "text-amber-400 font-extrabold";
            checkIcon = (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            );
          } else {
            checkIcon = (
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            );
          }

          return (
            <div key={stage.key} className="flex flex-col items-center relative z-10 flex-1">
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center -translate-y-2 transition-all duration-300 ${circleClass}`}>
                {checkIcon}
              </div>
              <span className={`text-[10px] uppercase font-bold tracking-wider text-center mt-2 ${labelClass}`}>
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TimelineProgress;
