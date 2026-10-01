import { songApi } from '../api/client';
import { getStorage } from '../utils';
import { SongResponse } from '../types';
import { TTL_MS, isFresh } from './ttl';

/** Songs list freshness window — single source of truth lives in cache/ttl. */
export const SONGS_FRESH_MS = TTL_MS.SONGS;
/** Page size shared by the songs list + prefetch so cache and UI stay in sync. */
export const SONGS_PAGE_SIZE = 30;

const storage = getStorage('spotibase-cache');

export const getCachedSongs = (): SongResponse[] => {
  try {
    const cached = storage.getString('allSongsData');
    return cached ? (JSON.parse(cached) as SongResponse[]) : [];
  } catch {
    return [];
  }
};

export const getSongsAt = (): number => {
  try {
    return storage.getNumber('songsAt') ?? 0;
  } catch {
    return 0;
  }
};

export const isSongsFresh = (freshMs: number = SONGS_FRESH_MS): boolean => {
  try {
    return isFresh(getSongsAt(), freshMs);
  } catch {
    return false;
  }
};

export const setCachedSongs = (songs: SongResponse[]) => {
  try {
    storage.set('allSongsData', JSON.stringify(songs));
    storage.set('songsAt', Date.now());
  } catch {}
};

/**
 * Prunes deleted song ids from the MMKV songs cache (best-effort). Called
 * after bulk/single delete so a stale MMKV hydrate never resurrects rows.
 */
export const pruneCachedSongs = (ids: string[] | Set<string>) => {
  try {
    const doomed = ids instanceof Set ? ids : new Set(ids);
    if (doomed.size === 0) return;
    const cached = getCachedSongs().filter((s) => !doomed.has(s.id));
    storage.set('allSongsData', JSON.stringify(cached));
    storage.set('songsAt', Date.now());
  } catch {}
};

/**
 * Warm the songs cache (best-effort). Called on login submit and session
 * restore so AllSongsScreen can hydrate instantly from MMKV.
 */
export const prefetchSongs = async () => {
  try {
    if (isSongsFresh()) return;
    const res = await songApi.getAll(0, SONGS_PAGE_SIZE);
    const content = res.data?.content ?? [];
    if (content.length > 0) setCachedSongs(content);
  } catch {
    // Warmup is best-effort; AllSongsScreen still fetches on focus.
  }
};
