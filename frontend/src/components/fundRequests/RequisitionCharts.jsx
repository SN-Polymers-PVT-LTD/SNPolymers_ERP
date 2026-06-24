import React from 'react';

const RequisitionCharts = ({ requests, onReviewNowClick, isApprover }) => {
  const pendingCount = requests.filter(r => r.request_status === 'Pending').length;
  
  // Sum up pending request amounts
  const pendingSum = requests
    .filter(r => r.request_status === 'Pending')
    .reduce((sum, r) => sum + Number(r.zo_fr_amount || 0), 0);

  const formatCurrency = (val) =>
    `₹ ${Number(val).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  return (
    <div className="grid grid-cols-1 mb-8 text-left">
      
      {/* 1. Urgent Approval Queue / Requisition Status */}
      <div className="glass-panel p-6 rounded-3xl relative overflow-hidden flex flex-col justify-between min-h-[180px]">
        <div className="absolute top-0 right-0 p-5 opacity-[0.03] pointer-events-none">
          <svg className="w-36 h-36 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500 font-mono">
            {isApprover ? "Urgent Queue" : "Submission Status"}
          </span>
          <h3 className="text-base font-extrabold text-slate-200 mt-1">
            {isApprover ? "Approval Deadlines" : "Pending Approvals"}
          </h3>
          <p className="text-xs text-slate-400 mt-2 font-medium">
            {pendingCount > 0 ? (
              isApprover ? (
                <>There are <strong className="text-amber-500">{pendingCount} requests</strong> pending review. Total value awaiting approval is <strong className="text-slate-200">{formatCurrency(pendingSum)}</strong>.</>
              ) : (
                <>You have <strong className="text-amber-500">{pendingCount} requests</strong> pending review by HO. Total value submitted is <strong className="text-slate-200">{formatCurrency(pendingSum)}</strong>.</>
              )
            ) : (
              isApprover ? "All requisition items processed. Zero pending queues." : "No pending requests. All submitted requisitions have been processed."
            )}
          </p>
        </div>
        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest font-extrabold text-amber-500/80 bg-amber-950/20 border border-amber-900/30 px-2.5 py-0.5 rounded-lg">
            {isApprover ? "Critical Path" : "Awaiting HO"}
          </span>
          {pendingCount > 0 && (
            <button
              onClick={onReviewNowClick}
              className="px-4 py-1.5 rounded-xl text-[10px] font-bold uppercase bg-white hover:bg-slate-100 text-slate-950 transition-all shadow-md transform hover:-translate-y-0.5"
            >
              {isApprover ? "Review Now →" : "Filter Pending →"}
            </button>
          )}
        </div>
      </div>

    </div>
  );
};

export default RequisitionCharts;
