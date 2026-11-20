import { useMemo, useCallback, useRef, useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';

/**
 * URL state synchronization hook for the Documentation Hub (/docs and /docs/:pageId).
 * Handles page slug routing, debounced search (?q=...), and heading anchor hash (#heading-id).
 */
export function useDocsUrlState() {
  const { pageId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const debounceTimerRef = useRef(null);

  useEffect(() => () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  // 1. Resolved active pageId (defaulting to 'what-is-idbp')
  const activePageId = useMemo(() => {
    return pageId || 'what-is-idbp';
  }, [pageId]);

  // 2. Search query from ?q=... or ?search=...
  const searchQuery = useMemo(() => {
    return searchParams.get('q') || searchParams.get('search') || '';
  }, [searchParams]);

  // 3. Heading anchor hash
  const [activeHeadingId, setActiveHeadingId] = useState(() => {
    return typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
  });

  // Track hash changes in window
  useEffect(() => {
    const handleHashChange = () => {
      setActiveHeadingId(window.location.hash.replace('#', ''));
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Update search query with optional debounce
  const setSearchQuery = useCallback((query, { debounce = true, replace = true } = {}) => {
    const update = (q) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (q && q.trim()) {
          next.set('q', q.trim());
        } else {
          next.delete('q');
        }
        next.delete('search');
        return next;
      }, { replace });
    };

    if (debounce) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => update(query), 300);
    } else {
      update(query);
    }
  }, [setSearchParams]);

  // Clear search query
  const clearSearch = useCallback(({ replace = true } = {}) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('q');
      next.delete('search');
      return next;
    }, { replace });
  }, [setSearchParams]);

  // Navigate to another documentation page
  const navigateToPage = useCallback((newPageId, { preserveSearch = false, replace = false } = {}) => {
    const targetQuery = preserveSearch && searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : '';
    navigate(`/docs/${newPageId}${targetQuery}`, { replace });
  }, [navigate, searchQuery]);

  // Set active heading and update window hash
  const setHeadingAnchor = useCallback((headingId, { replace = true } = {}) => {
    if (typeof window === 'undefined') return;
    const cleanId = headingId ? headingId.replace('#', '') : '';
    setActiveHeadingId(cleanId);

    const newUrl = cleanId
      ? `${window.location.pathname}${window.location.search}#${cleanId}`
      : `${window.location.pathname}${window.location.search}`;

    if (replace) {
      window.history.replaceState(window.history.state, '', newUrl);
    } else {
      window.history.pushState(window.history.state, '', newUrl);
    }
  }, []);

  return {
    pageId: activePageId,
    searchQuery,
    activeHeadingId,
    setSearchQuery,
    clearSearch,
    navigateToPage,
    setHeadingAnchor,
  };
}

export default useDocsUrlState;
