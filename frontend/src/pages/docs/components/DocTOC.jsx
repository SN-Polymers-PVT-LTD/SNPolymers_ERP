import React, { useState, useEffect } from 'react';

const DocTOC = ({ headings = [] }) => {
  const [activeId, setActiveId] = useState(() => {
    return typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
  });

  useEffect(() => {
    if (headings.length === 0) return;
    if (typeof window === 'undefined' || !window.IntersectionObserver) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find all headings currently intersecting
        const intersecting = entries.filter((entry) => entry.isIntersecting);
        if (intersecting.length > 0) {
          // Sort by bounding client rect to find the top-most intersecting one
          intersecting.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          setActiveId(intersecting[0].target.id);
        }
      },
      {
        rootMargin: '-80px 0px -60% 0px', // check headings near the top viewport line
        threshold: 0
      }
    );

    // Observe all headings elements on the page
    headings.forEach((heading) => {
      const el = document.getElementById(heading.id);
      if (el) observer.observe(el);
    });

    return () => {
      headings.forEach((heading) => {
        const el = document.getElementById(heading.id);
        if (el) observer.unobserve(el);
      });
    };
  }, [headings]);

  const handleScrollTo = (e, id) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
      if (typeof window !== 'undefined') {
        const newUrl = `${window.location.pathname}${window.location.search}#${id}`;
        window.history.replaceState(window.history.state, '', newUrl);
      }
    }
  };

  return (
    <div className="space-y-4">
      <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 block">
        In this article
      </span>
      <ul className="space-y-2.5 text-xs font-semibold">
        {headings.map((heading) => {
          const isActive = heading.id === activeId;
          const isSubheading = heading.level === 3;
          
          return (
            <li
              key={heading.id}
              className={`transition-all ${isSubheading ? 'pl-4' : 'pl-0'}`}
            >
              <a
                href={`#${heading.id}`}
                onClick={(e) => handleScrollTo(e, heading.id)}
                className={`block border-l-2 py-0.5 pl-3 transition-colors ${
                  isActive
                    ? 'border-amber-500 text-amber-500 font-extrabold'
                    : 'border-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {heading.text}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default DocTOC;
