import React from 'react';

const EmptyState = ({ onActionClick, showAction = true }) => {
  return (
    <div className="text-center p-24 bg-white/[0.01] border border-white/5 rounded-3xl flex flex-col items-center justify-center">
      <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-400 mb-4 border border-amber-500/10">
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-200">No Fund Requests Found</h3>
      <p className="text-xs text-slate-500 mt-2 max-w-xs mx-auto">
        There are no fund requisitions created or matching your criteria. Start by submitting a new request.
      </p>
      {showAction && (
        <button
          onClick={onActionClick}
          className="mt-6 bg-white hover:bg-slate-100 text-slate-950 px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all duration-300 shadow-md transform hover:-translate-y-0.5"
        >
          Create Fund Request
        </button>
      )}
    </div>
  );
};

export default EmptyState;
