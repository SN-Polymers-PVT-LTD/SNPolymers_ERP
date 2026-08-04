import React from 'react';

const DashboardErrorBanner = ({
  visible = false,
  message = "Couldn't load some dashboard data. Showing partial results.",
  onRetry
}) => {
  if (!visible) return null;

  return (
    <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs font-bold flex items-center justify-between mb-6">
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="underline shrink-0 ml-4 hover:text-rose-300 transition"
        >
          Retry
        </button>
      )}
    </div>
  );
};

export default DashboardErrorBanner;
