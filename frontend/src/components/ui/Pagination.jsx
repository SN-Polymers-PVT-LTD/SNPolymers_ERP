import React from 'react';

/**
 * Calculates a sliding window of visible page numbers, capped at `maxVisible` (default 5).
 */
const getVisiblePageNumbers = (currentPage, totalPages, maxVisible = 5) => {
  if (!totalPages || totalPages <= 0) return [];
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let end = start + maxVisible - 1;
  if (end > totalPages) {
    end = totalPages;
    start = Math.max(1, end - maxVisible + 1);
  }
  const pages = [];
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  return pages;
};

const Pagination = ({
  currentPage,
  totalPages,
  onPageChange,
  maxVisible = 5,
  showLabel = false,
  totalRecords = null,
  label = null,
  className = ""
}) => {
  if (!totalPages || totalPages <= 1) return null;

  const visiblePages = getVisiblePageNumbers(currentPage, totalPages, maxVisible);

  return (
    <div className={`px-6 py-4 bg-white/2 border-t border-white/5 flex items-center justify-between text-xs select-none ${className}`}>
      {showLabel ? (
        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
          {label ? (
            label
          ) : (
            <>
              Page {currentPage} of {totalPages} {totalRecords !== null && <span className="text-slate-600">({totalRecords} total)</span>}
            </>
          )}
        </span>
      ) : (
        <div />
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={currentPage === 1}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          className="px-3.5 py-1.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-white/5 text-slate-200 font-black uppercase text-[10px] tracking-wider transition cursor-pointer"
        >
          ‹ Prev
        </button>

        <div className="flex items-center gap-1">
          {visiblePages.map((pg) => (
            <button
              key={pg}
              type="button"
              onClick={() => onPageChange(pg)}
              className={`w-7 h-7 rounded-lg text-xs font-black transition cursor-pointer ${
                currentPage === pg
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                  : 'bg-white/5 hover:bg-white/15 border border-white/10 text-slate-300'
              }`}
            >
              {pg}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          className="px-3.5 py-1.5 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-white/5 text-slate-200 font-black uppercase text-[10px] tracking-wider transition cursor-pointer"
        >
          Next ›
        </button>
      </div>
    </div>
  );
};

export default Pagination;
