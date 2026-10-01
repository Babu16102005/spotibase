/**
 * Home feed query: stale-while-revalidate over MMKV initialData.
 *
 * Paints instantly from `spotibase-cache/homeData` (synchronous MMKV read),
 * then revalidates in the background when older than TTL.HOME. The AbortSignal
 * comes from React Query and is forwarded to the API client so unmounted /
 * superseded fetches are cancelled instead of resolving stale.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { homeApi } from '../api/client';
import { getGreeting } from '../utils';
import { TTL_MS } from '../cache/ttl';
import { readHomeFeed, writeHomeFeed } from '../cache/homeFeedCache';
import { queryKeys } from './queryKeys';

export const fetchHomeFeed = async (signal?: AbortSignal): Promise<any> => {
  const res = await homeApi.getHome(signal);
  return { ...res.data, greeting: getGreeting() };
};

interface UseHomeOptions {
  /** Skip the network fetch (e.g. while logged out). Defaults to true. */
  enabled?: boolean;
}

export const useHome = ({ enabled = true }: UseHomeOptions = {}) => {
  const query = useQuery({
    queryKey: queryKeys.home,
    queryFn: ({ signal }) => fetchHomeFeed(signal),
    staleTime: TTL_MS.HOME,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
    enabled,
    // Instant paint: MMKV snapshot from the last good fetch.
    initialData: () => readHomeFeed() ?? undefined,
  });

  // Persist the last good payload so the next cold start paints instantly.
  // Best-effort: writeHomeFeed never throws.
  useEffect(() => {
    if (query.data) writeHomeFeed(query.data);
  }, [query.data]);

  return query;
};
