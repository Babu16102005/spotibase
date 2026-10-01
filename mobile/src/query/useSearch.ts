/**
 * Debounced search query preserving the SearchScreen contract:
 * 300ms debounce + AbortSignal cancellation so slow responses can never
 * overwrite fresh ones. One cache entry per (debounced query, types) with a
 * 60s stale window.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchApi } from '../api/client';
import { TTL_MS } from '../cache/ttl';
import { queryKeys } from './queryKeys';
import type { SearchResponse } from '../types';

export const SEARCH_DEBOUNCE_MS = 300;
export const DEFAULT_SEARCH_TYPES = 'song,album,artist,playlist';

/** Debounce any value by `delay` ms. */
export const useDebouncedValue = <T>(value: T, delay: number = SEARCH_DEBOUNCE_MS): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
};

interface UseSearchOptions {
  types?: string;
  enabled?: boolean;
}

export const useSearch = (
  query: string,
  { types = DEFAULT_SEARCH_TYPES, enabled = true }: UseSearchOptions = {}
) => {
  // 300ms debounce: the query key (and therefore the network request) only
  // changes after the user pauses typing.
  const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const searchEnabled = enabled && debounced.length > 0;

  const result = useQuery({
    // Keyed on the *debounced* value: keystrokes within the window never
    // create entries and never fire requests.
    queryKey: queryKeys.search(debounced, types),
    queryFn: ({ signal }) =>
      // AbortSignal forwarded: superseded searches are cancelled in flight.
      searchApi.search(debounced, types, 0, signal).then((r) => r.data as SearchResponse),
    enabled: searchEnabled,
    staleTime: TTL_MS.SEARCH,
    gcTime: 30 * 60 * 1000,
    // Single retry: search is user-paced, fast failure beats hanging.
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return { ...result, debouncedQuery: debounced };
};
