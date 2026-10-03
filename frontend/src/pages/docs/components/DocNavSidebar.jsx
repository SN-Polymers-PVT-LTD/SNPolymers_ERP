import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const DocNavSidebar = ({ sections, activePageId, searchQuery = '', onItemClick }) => {
  // Track manual open/close overrides for sections
  const [manualToggles, setManualToggles] = useState({});

  const toggleSection = (sectionId) => {
    setManualToggles((prev) => {
      const section = sections.find((s) => s.id === sectionId);
      const hasActivePage = section ? section.pages.some((page) => page.id === activePageId) : false;
      const isCurrentlyExpanded = prev[sectionId] !== undefined
        ? prev[sectionId]
        : (hasActivePage || searchQuery.trim() !== '');
      return {
        ...prev,
        [sectionId]: !isCurrentlyExpanded
      };
    });
  };

  return (
    <nav className="p-6 space-y-6">
      {sections.map((section) => {
        // Filter pages if search query is present (matching titles or headings)
        const filteredPages = section.pages.filter((page) => {
          const q = searchQuery.toLowerCase();
          if (page.title.toLowerCase().includes(q)) return true;
          if (page.headings && page.headings.some((h) => h.text.toLowerCase().includes(q))) return true;
          return false;
        });

        // If a section has no matching pages and search is active, hide the section
        if (searchQuery.trim() !== '' && filteredPages.length === 0) {
          return null;
        }

        const hasActivePage = section.pages.some((page) => page.id === activePageId);
        const isExpanded = manualToggles[section.id] !== undefined
          ? manualToggles[section.id]
          : (hasActivePage || searchQuery.trim() !== '');

        return (
          <div key={section.id} className="space-y-2">
            {/* Section Header */}
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between py-1.5 text-left group"
            >
              <div className="flex items-center gap-2.5">
                <span className={`text-slate-400 group-hover:text-slate-200 transition-colors ${hasActivePage ? 'text-amber-500 font-extrabold' : ''}`}>
                  {section.icon}
                </span>
                <span className={`text-[10px] font-extrabold uppercase tracking-widest transition-colors ${
                  hasActivePage ? 'text-slate-100' : 'text-slate-400 group-hover:text-slate-300'
                }`}>
                  {section.label}
                </span>
              </div>
              <span className="text-slate-500 group-hover:text-slate-300 transition-colors">
                {isExpanded ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                )}
              </span>
            </button>

            {/* Section Pages List */}
            {isExpanded && (
              <ul className="pl-4 space-y-1 border-l border-white/5 ml-2 mt-1 transition-all">
                {filteredPages.map((page) => {
                  const isActive = page.id === activePageId;
                  const targetUrl = `/docs/${page.id}${searchQuery.trim() ? `?q=${encodeURIComponent(searchQuery.trim())}` : ''}`;
                  return (
                    <li key={page.id}>
                      <Link
                        to={targetUrl}
                        onClick={onItemClick}
                        className={`block py-1.5 px-3 rounded-lg text-xs tracking-wide transition-all ${
                          isActive
                            ? 'bg-amber-500/10 border-l-2 border-amber-500 text-amber-400 font-extrabold pl-4'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]'
                        }`}
                      >
                        {page.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
};

export default DocNavSidebar;
