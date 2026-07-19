import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { docSections, findPageById, getAllPagesFlat } from './docsContent.jsx';
import BackgroundShapes from '../../components/BackgroundShapes';

// Subcomponents
import DocNavSidebar from './components/DocNavSidebar';
import DocTOC from './components/DocTOC';
import DocContent from './components/DocContent';

const Docs = () => {
  const { pageId } = useParams();
  const navigate = useNavigate();
  
  // Default to first page if pageId is missing
  const activePageId = pageId || 'what-is-idbp';
  const pageData = findPageById(activePageId);

  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Auto-collapse console sidebar when docs page opens
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', 'true');
    window.dispatchEvent(new CustomEvent('sidebar-collapse', { detail: true }));
  }, []);

  // Auto-redirect if page doesn't exist
  useEffect(() => {
    if (!pageData) {
      navigate('/docs/what-is-idbp', { replace: true });
    }
  }, [pageData, navigate]);

  if (!pageData) return null;

  const { page, section } = pageData;
  const flatPages = getAllPagesFlat();
  const currentIndex = flatPages.findIndex((p) => p.id === activePageId);
  const prevPage = currentIndex > 0 ? flatPages[currentIndex - 1] : null;
  const nextPage = currentIndex < flatPages.length - 1 ? flatPages[currentIndex + 1] : null;

  // Extract headings from page or fallback to default
  const headings = page.headings || [];

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col font-sans relative overflow-hidden">
      <BackgroundShapes />

      {/* Docs Layout Panel */}
      <div className="flex-grow flex flex-col overflow-hidden relative z-10 doc-portal-layout">
        {/* Background glow animations */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Docs Header */}
      <header className="glass-nav sticky top-0 z-50 px-6 py-4 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="md:hidden p-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-slate-100"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-extrabold text-xs tracking-wider text-slate-100 uppercase">
            Documentation Portal
          </span>
        </div>

        {/* Search Input */}
        <div className="hidden sm:block relative max-w-xs w-full mx-4">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search docs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs rounded-xl glass-input outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-slate-200 hover:text-slate-100 transition-all duration-300"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Go Back
          </button>
        </div>
      </header>

      {/* Mobile Search - under header */}
      <div className="sm:hidden px-6 py-3 bg-slate-950/40 border-b border-white/5">
        <div className="relative w-full">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="text"
            placeholder="Search docs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl glass-input outline-none"
          />
        </div>
      </div>

      {/* Main Layout Area */}
      <div className="flex-grow flex relative overflow-hidden h-full min-h-0">
        {/* Desktop Sidebar */}
        <aside className="hidden md:block w-72 border-r border-white/5 shrink-0 bg-slate-950/20 overflow-y-auto h-full">
          <DocNavSidebar
            sections={docSections}
            activePageId={activePageId}
            searchQuery={searchQuery}
          />
        </aside>

        {/* Mobile Sidebar Modal/Drawer */}
        {isMobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            {/* Drawer Content */}
            <div className="relative w-80 max-w-[85vw] bg-[#0b0f19] border-r border-white/10 flex flex-col h-full z-10 animate-fadeIn">
              <div className="p-4 flex items-center justify-between border-b border-white/5">
                <span className="font-extrabold text-xs tracking-wider text-amber-500 uppercase">
                  Documentation Menu
                </span>
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-slate-200"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-grow overflow-y-auto">
                <DocNavSidebar
                  sections={docSections}
                  activePageId={activePageId}
                  searchQuery={searchQuery}
                  onItemClick={() => setIsMobileMenuOpen(false)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Middle Content Column */}
        <main className="flex-grow px-6 py-10 md:px-12 md:py-12 overflow-y-auto h-full min-h-0 max-w-4xl mx-auto w-full">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-6">
            <span>{section.label}</span>
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-amber-500">{page.title}</span>
          </div>

          <DocContent
            page={page}
            prevPage={prevPage}
            nextPage={nextPage}
          />
        </main>

        {/* Right Sticky TOC Column (Desktop only) */}
        {headings.length > 0 && (
          <aside className="hidden lg:block w-64 shrink-0 bg-transparent overflow-y-auto h-full px-6 py-12">
            <div className="sticky top-0">
              <DocTOC headings={headings} />
            </div>
          </aside>
        )}
      </div>

      {/* Docs Footer */}
      <footer className="border-t border-white/5 bg-black/80 py-6 text-center text-[10px] text-zinc-500 font-semibold mt-auto">
        <p>&copy; {new Date().getFullYear()} SN Polymers Pvt LTD. Internal System Technical Documentation.</p>
      </footer>
      </div>
    </div>
  );
};

export default Docs;
