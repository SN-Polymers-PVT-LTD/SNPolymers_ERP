import React from 'react';

const CancelFundRequestModal = ({ requestNo, onConfirm, onClose, isCancelling }) => {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
      <div className="glass-panel p-6 rounded-3xl max-w-sm w-full border border-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.7)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-red-500/10 border border-red-500/10">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-100">
            Cancel Request
          </h2>
        </div>
        <p className="text-xs text-slate-400 mb-6 font-medium">
          Are you sure you want to cancel fund request <span className="font-mono text-slate-200 font-bold">{requestNo}</span>? This action cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={isCancelling}
            className="px-4 py-2 text-slate-400 hover:text-slate-200 font-bold text-xs uppercase tracking-wider transition disabled:opacity-40"
          >
            Go Back
          </button>
          <button
            onClick={onConfirm}
            disabled={isCancelling}
            className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md bg-red-500/90 hover:bg-red-500 text-white disabled:opacity-50 flex items-center gap-1.5"
          >
            {isCancelling ? (
              <>
                <span className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-white" />
                Cancelling...
              </>
            ) : (
              'Confirm Cancel'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CancelFundRequestModal;
