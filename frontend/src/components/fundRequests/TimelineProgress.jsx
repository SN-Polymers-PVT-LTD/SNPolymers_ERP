import React from 'react';

const formatStageDate = (d) => {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short'
  });
};

const TimelineProgress = ({ status, request }) => {
  const reqStatus = status || request?.request_status || 'Draft';
  const hasImport = !!request?.accounts_line_item_id;
  const isDismissed = !!request?.accounts_import_dismissed;

  // Determine stage 3 details (Accounts Queue vs In Sheet vs Dismissed)
  let accountsLabel;
  let accountsSubtext = null;
  let accountsState;

  if (reqStatus === 'Draft') {
    accountsLabel = 'Accounts Review';
    accountsState = 'upcoming';
  } else if (isDismissed) {
    accountsLabel = 'Accounts Dismissed';
    accountsState = 'dismissed';
    accountsSubtext = 'Dismissed';
  } else if (hasImport) {
    accountsLabel = 'In Accounts Sheet';
    accountsState = ['Approved', 'Hold', 'Returned', 'Rejected'].includes(reqStatus)
      ? 'completed'
      : 'active-imported';
    accountsSubtext = request?.accounts_imported_at ? `Imported ${formatStageDate(request.accounts_imported_at)}` : 'In Sheet';
  } else if (reqStatus === 'Cancelled') {
    accountsLabel = 'Accounts Queue';
    accountsState = 'upcoming';
  } else if (reqStatus === 'Pending') {
    accountsLabel = 'Accounts Queue';
    accountsState = 'active';
    accountsSubtext = 'Awaiting import';
  } else {
    accountsLabel = 'Accounts Review';
    accountsState = 'completed';
  }

  // Determine stage 4 details (Accurate terminal outcomes)
  let outcomeLabel;
  let outcomeState;
  let outcomeSubtext;

  if (reqStatus === 'Approved') {
    outcomeLabel = 'Approved';
    outcomeState = 'approved';
    outcomeSubtext = request?.approve_ho_date ? formatStageDate(request.approve_ho_date) : 'Passed';
  } else if (reqStatus === 'Hold') {
    outcomeLabel = 'On Hold';
    outcomeState = 'hold';
    outcomeSubtext = 'Paused';
  } else if (reqStatus === 'Returned') {
    outcomeLabel = 'Returned';
    outcomeState = 'returned';
    outcomeSubtext = 'For correction';
  } else if (reqStatus === 'Rejected') {
    outcomeLabel = 'Rejected';
    outcomeState = 'rejected';
    outcomeSubtext = 'Declined';
  } else if (reqStatus === 'Cancelled') {
    outcomeLabel = 'Cancelled';
    outcomeState = 'cancelled';
    outcomeSubtext = request?.cancelled_at ? formatStageDate(request.cancelled_at) : 'By ZO';
  } else {
    outcomeLabel = 'HO Review';
    outcomeState = 'upcoming';
    outcomeSubtext = hasImport ? 'Awaiting HO' : 'Pending';
  }

  const stages = [
    {
      key: 'draft',
      label: 'Draft',
      state: reqStatus === 'Draft' ? 'active' : 'completed',
      subtext: request?.created_at ? formatStageDate(request.created_at) : null
    },
    {
      key: 'submitted',
      label: 'Submitted',
      state: reqStatus === 'Draft' ? 'upcoming' : 'completed',
      subtext: request?.submitted_at || request?.zo_date ? formatStageDate(request.submitted_at || request.zo_date) : null
    },
    {
      key: 'accounts',
      label: accountsLabel,
      state: accountsState,
      subtext: accountsSubtext
    },
    {
      key: 'outcome',
      label: outcomeLabel,
      state: outcomeState,
      subtext: outcomeSubtext
    }
  ];

  const renderIcon = (state) => {
    switch (state) {
      case 'completed':
      case 'approved':
        return (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'active':
        return <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />;
      case 'active-imported':
        return (
          <svg className="w-3 h-3 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        );
      case 'hold':
        return (
          <span className="font-mono text-[9px] font-black text-amber-400 leading-none">||</span>
        );
      case 'returned':
        return (
          <svg className="w-3 h-3 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 10h10a5 5 0 015 5v2m0 0l-4-4m4 4l4-4" />
          </svg>
        );
      case 'rejected':
      case 'dismissed':
        return (
          <svg className="w-3 h-3 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'cancelled':
        return (
          <span className="w-2 h-0.5 bg-slate-400 rounded-full" />
        );
      default:
        return <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />;
    }
  };

  const getStyles = (state) => {
    switch (state) {
      case 'completed':
      case 'approved':
        return {
          circle: 'bg-emerald-500/20 border-emerald-500 text-emerald-400 z-10 scale-110 shadow-sm shadow-emerald-500/20',
          label: 'text-slate-200 font-extrabold'
        };
      case 'active':
        return {
          circle: 'bg-amber-500/20 border-amber-500 text-amber-400 z-10 scale-110 animate-pulse shadow-sm shadow-amber-500/20',
          label: 'text-amber-400 font-extrabold'
        };
      case 'active-imported':
        return {
          circle: 'bg-indigo-500/20 border-indigo-500 text-indigo-400 z-10 scale-110 shadow-sm shadow-indigo-500/20',
          label: 'text-indigo-300 font-extrabold'
        };
      case 'hold':
        return {
          circle: 'bg-amber-500/20 border-amber-500 text-amber-400 z-10 scale-110 shadow-sm shadow-amber-500/20',
          label: 'text-amber-400 font-extrabold'
        };
      case 'returned':
        return {
          circle: 'bg-purple-500/20 border-purple-500 text-purple-400 z-10 scale-110 shadow-sm shadow-purple-500/20',
          label: 'text-purple-400 font-extrabold'
        };
      case 'rejected':
      case 'dismissed':
        return {
          circle: 'bg-rose-500/20 border-rose-500 text-rose-400 z-10 scale-110 shadow-sm shadow-rose-500/20',
          label: 'text-rose-400 font-extrabold'
        };
      case 'cancelled':
        return {
          circle: 'bg-slate-800 border-slate-600 text-slate-400 z-10',
          label: 'text-slate-400 font-bold'
        };
      default:
        return {
          circle: 'bg-slate-900 border-slate-700 text-slate-600',
          label: 'text-slate-500 font-medium'
        };
    }
  };

  return (
    <div className="glass-panel p-6 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent text-left">
      <div className="flex justify-between items-center mb-6">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Approval Timeline</span>
        {request?.updated_at && (
          <span className="text-[9px] font-medium text-slate-500">
            Last Activity: {formatStageDate(request.updated_at)}
          </span>
        )}
      </div>
      <div className="relative flex items-center justify-between">
        {/* Connector Line */}
        <div className="absolute left-6 right-6 h-0.5 bg-slate-800/80 -translate-y-3 pointer-events-none z-0" />

        {stages.map((stage) => {
          const { circle, label } = getStyles(stage.state);
          return (
            <div key={stage.key} className="flex flex-col items-center relative z-10 flex-1 px-1">
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center -translate-y-3 transition-all duration-300 ${circle}`}>
                {renderIcon(stage.state)}
              </div>
              <span className={`text-[10px] uppercase tracking-wider text-center ${label}`}>
                {stage.label}
              </span>
              {stage.subtext && (
                <span className="text-[8px] text-slate-500 font-mono text-center mt-0.5">
                  {stage.subtext}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TimelineProgress;
