/**
 * MMKV-backed JSON persister over getStorage('spotibase-cache').
 *
 * React Query keeps hot data in memory; this module is the durable layer used
 * for `initialData` (instant paint on cold start) and for persisting the last
 * good payload + timestamp per cache key. Screens keep painting from MMKV
 * synchronously while React Query revalidates in the background
 * (stale-while-revalidate).
 */
import { getStorage } from '../utils';

const storage = getStorage('spotibase-cache');

/** Read and JSON-parse a cached value. Returns null on miss/corrupt data. */
export const readJson = <T>(key: string): T | null => {
  try {
    const raw = storage.getString(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

/** JSON-stringify and store a value. Best-effort (never throws). */
export const writeJson = (key: string, value: unknown): void => {
  try {
    storage.set(key, JSON.stringify(value));
  } catch {}
};

/** Read an epoch-ms timestamp key. Returns 0 when missing. */
export const readAt = (atKey: string): number => {
  try {
    return storage.getNumber(atKey) ?? 0;
  } catch {
    return 0;
  }
};

/** Store Date.now() under an epoch-ms timestamp key. Best-effort. */
export const writeNow = (atKey: string): void => {
  try {
    storage.set(atKey, Date.now());
  } catch {}
};

/** Write a payload together with its freshness timestamp. */
export const writeEntry = (key: string, atKey: string, value: unknown): void => {
  writeJson(key, value);
  writeNow(atKey);
};

/** Remove a payload and its timestamp. Best-effort. */
export const clearEntry = (key: string, atKey: string): void => {
  try {
    storage.delete(key);
  } catch {}
  try {
    storage.delete(atKey);
  } catch {}
};

export { storage as cacheStorage };
