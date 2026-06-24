import React from 'react';

const QuickFiltersSidebar = ({ filters, onFilterChange, activities }) => {
  const handleCheckboxChange = (key) => {
    onFilterChange(key, !filters[key]);
  };

  const checklistItems = [
    { key: 'myRequests', label: 'My Requests' },
    { key: 'pendingOnly', label: 'Pending Only' },
    { key: 'approvedThisMonth', label: 'Approved This Month' },
    { key: 'onHoldRequests', label: 'On Hold Requests' },
    { key: 'largeAmount', label: 'Large Amount Requests (> ₹5L)' }
  ];

  return (
    <div className="space-y-6 text-left">
      
      {/* 1. Quick Filters Panel */}
      <div className="glass-panel p-5 rounded-3xl border border-white/5 bg-gradient-to-br from-white/[0.01] to-transparent">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-4">Quick Filters</span>
        <div className="space-y-3">
          {checklistItems.map((item) => (
            <label key={item.key} className="flex items-center gap-3 cursor-pointer select-none text-xs text-slate-300 font-medium hover:text-slate-100 transition-colors">
              <input
                type="checkbox"
                checked={!!filters[item.key]}
                onChange={() => handleCheckboxChange(item.key)}
                className="w-4 h-4 rounded bg-slate-900 border-white/10 text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* 4. Recent Activity Feed */}
      <div className="glass-panel p-5 rounded-3xl border border-white/5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block mb-4">Recent Activity Feed</span>
        <div className="space-y-4">
          {activities.length > 0 ? (
            activities.map((act, idx) => (
              <div key={idx} className="flex gap-3 text-xs leading-relaxed items-start">
                <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${
                  act.status === 'Approved' ? 'bg-emerald-500' :
                  act.status === 'Hold' ? 'bg-red-500' :
                  act.status === 'Cancelled' ? 'bg-slate-500' : 'bg-amber-500'
                }`} />
                <div className="flex flex-col">
                  <span className="text-slate-300 font-bold">{act.no} {act.status}</span>
                  <span className="text-[9px] text-slate-500 mt-0.5">{act.time}</span>
                </div>
              </div>
            ))
          ) : (
            <span className="text-slate-500 text-xs">No recent activities logged.</span>
          )}
        </div>
      </div>

    </div>
  );
};

export default QuickFiltersSidebar;
