import React from 'react';
import { Link } from 'react-router-dom';

const DocContent = ({ page, prevPage, nextPage, searchQuery = '' }) => {
  const querySuffix = searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : '';

  return (
    <div className="space-y-12">
      {/* Title */}
      <header className="space-y-4">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-100 tracking-tight leading-tight">
          {page.title}
        </h1>
        <div className="h-0.5 bg-gradient-to-r from-amber-500/50 to-transparent w-24" />
      </header>

      {/* Main Content Body */}
      <article className="doc-prose text-sm text-slate-300 leading-relaxed font-normal">
        {page.content}
      </article>

      {/* Next/Prev Navigation Buttons */}
      <footer className="border-t border-white/5 pt-8 mt-12 flex flex-col sm:flex-row gap-4 justify-between items-center text-xs">
        {prevPage ? (
          <Link
            to={`/docs/${prevPage.id}${querySuffix}`}
            className="w-full sm:w-auto p-4 rounded-2xl glass-panel glass-card-hover border border-white/5 flex flex-col gap-1 items-start text-left"
          >
            <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
              Previous
            </span>
            <span className="font-bold text-amber-500 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              {prevPage.title}
            </span>
          </Link>
        ) : (
          <div className="hidden sm:block" />
        )}

        {nextPage ? (
          <Link
            to={`/docs/${nextPage.id}${querySuffix}`}
            className="w-full sm:w-auto p-4 rounded-2xl glass-panel glass-card-hover border border-white/5 flex flex-col gap-1 items-end text-right ml-auto"
          >
            <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
              Next
            </span>
            <span className="font-bold text-amber-500 flex items-center gap-1.5">
              {nextPage.title}
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </span>
          </Link>
        ) : (
          <div className="hidden sm:block" />
        )}
      </footer>
    </div>
  );
};

export default DocContent;
