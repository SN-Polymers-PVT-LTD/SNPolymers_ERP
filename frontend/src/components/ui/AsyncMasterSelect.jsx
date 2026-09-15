import React, { useEffect, useRef, useState } from 'react';
import SearchableSelect from './SearchableSelect';

const PAGE_SIZE = 20;
const LOAD_MORE_VALUE = '__load_more__';

/**
 * Searchable, paginated selector for large ERP master tables.
 * Active rows are fetched from the server. A persisted inactive row may be
 * injected as a selectable display-only option for an existing line.
 */
const AsyncMasterSelect = ({
  value = '',
  onChange,
  fetchOptions,
  persistedOption,
  getOptionValue,
  getOptionLabel,
  placeholder,
  required = false,
  label,
  disabled = false
}) => {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const requestId = useRef(0);

  const toOption = (item) => ({
    value: getOptionValue(item),
    label: `${getOptionLabel(item)}${item?.is_active === false ? ' (Inactive)' : ''}`,
    item
  });

  const mergeOptions = (rows, nextPage) => {
    const merged = nextPage === 1 ? rows : [...options, ...rows];
    if (persistedOption && !merged.some(item => getOptionValue(item) === getOptionValue(persistedOption))) {
      merged.unshift(persistedOption);
    }
    const unique = merged.filter((item, index, all) => all.findIndex(candidate => getOptionValue(candidate) === getOptionValue(item)) === index);
    setOptions(unique);
  };

  const fetchPage = async (nextPage, nextQuery = query) => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const response = await fetchOptions({
        is_active: 'true',
        page: nextPage,
        limit: PAGE_SIZE,
        ...(nextQuery.trim() ? { search: nextQuery.trim() } : {})
      });
      if (id !== requestId.current) return;
      const key = response.data?.subcontractors ? 'subcontractors' : 'subcontractWorks';
      const rows = response.data?.[key] || [];
      mergeOptions(rows, nextPage);
      const pagination = response.data?.pagination || {};
      setPage(nextPage);
      setHasMore(nextPage < (pagination.totalPages || 1));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!focused) return undefined;
    const timer = setTimeout(() => fetchPage(1, query), 350);
    return () => clearTimeout(timer);
  }, [query, focused]);

  useEffect(() => {
    if (!persistedOption) return;
    setOptions(current => {
      if (current.some(item => getOptionValue(item) === getOptionValue(persistedOption))) return current;
      return [persistedOption, ...current];
    });
  }, [persistedOption]);

  const selected = options.find(item => getOptionValue(item) === value);
  const displayOptions = options.map(toOption);
  if (hasMore) displayOptions.push({ value: LOAD_MORE_VALUE, label: loading ? 'Loading more…' : 'Load more results…' });

  return (
    <SearchableSelect
      label={label}
      required={required}
      value={selected ? selected.label : query}
      onFocus={() => setFocused(true)}
      onChange={(nextQuery) => {
        setQuery(nextQuery);
        if (selected && nextQuery !== selected.label) onChange('');
      }}
      onSelect={(option) => {
        if (option.value === LOAD_MORE_VALUE) {
          fetchPage(page + 1);
          return;
        }
        const item = option.item || options.find(candidate => getOptionValue(candidate) === option.value);
        setQuery(option.label);
        onChange(getOptionValue(item));
      }}
      options={displayOptions}
      placeholder={placeholder}
      disabled={disabled}
      helperText={loading ? 'Searching…' : undefined}
    />
  );
};

export default AsyncMasterSelect;
