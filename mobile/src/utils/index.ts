import { Platform } from 'react-native';

export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Parse an ISO-8601 duration (e.g. "PT4M13S", "PT1H2M", "PT58M") to
 * milliseconds. Returns null when the input is not a valid ISO duration.
 * Accepts the YouTube Data API `contentDetails.duration` shape the backend
 * proxies through verbatim.
 */
export const parseIso8601DurationToMs = (iso?: string | null): number | null => {
  if (!iso || typeof iso !== 'string') return null;
  const trimmed = iso.trim();
  if (!trimmed.startsWith('PT')) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(trimmed);
  if (!match) return null;
  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseFloat(match[3]) : 0;
  if (!match[1] && !match[2] && !match[3]) return null;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return Math.round(((hours * 3600 + minutes * 60 + seconds) * 1000));
};

/**
 * Format an ISO-8601 duration to a compact label ("3:45", "1:02:03").
 * Falls back to the raw input when it is not ISO-8601 (already formatted).
 */
export const formatIso8601Duration = (iso?: string | null): string | null => {
  const ms = parseIso8601DurationToMs(iso);
  if (ms == null || ms < 0) {
    return typeof iso === 'string' && iso.length > 0 ? iso : null;
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const formatCount = (count: number): string => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
};

export const formatFileSize = (bytes?: number | null): string => {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unitIndex = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, unitIndex)).toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
};

export const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
};

export const formatDate = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export const formatYear = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return String(date.getFullYear());
};

export const formatReleaseDate = (dateStr?: string | null): string => {
  return formatDate(dateStr);
};

export const getRelativeTime = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(dateStr);
};

export const getImageUrl = (url?: string, size: number = 300): string => {
  if (!url) return '';
  if (url.includes('supabase.co')) {
    return `${url}?width=${size}&quality=80`;
  }
  return url;
};

// Bundled placeholder art (no external image service dependency).
// Used when a cover/avatar URL is missing. Imported at build time so it is
// packed into the bundle on both native and web.
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const PLACEHOLDER_IMAGE = require('../../assets/placeholder.png');

export const coverSource = (url?: string | null, size: number = 200): { uri: string } | number => {
  if (!url) return PLACEHOLDER_IMAGE;
  // Route list thumbs through getImageUrl so Supabase CDN serves a small,
  // cached variant instead of the full-size original.
  const thumb = getImageUrl(url, size);
  return { uri: thumb || url };
};

// Multi-instance MMKV & in-memory cache keyed by store ID
const mmkvInstances: Record<string, any> = {};
const memoryStore: Record<string, string> = {};

const makeFallbackStorage = (id: string) => {
  const webStorage =
    typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  const prefix = `mmkv:${id}:`;
  return {
    getString: (key: string) => {
      if (webStorage) return webStorage.getItem(prefix + key);
      return memoryStore[prefix + key] || null;
    },
    set: (key: string, value: string) => {
      if (webStorage) webStorage.setItem(prefix + key, value);
      else memoryStore[prefix + key] = value;
    },
    delete: (key: string) => {
      if (webStorage) webStorage.removeItem(prefix + key);
      else delete memoryStore[prefix + key];
    },
    clearAll: () => {
      if (webStorage) {
        Object.keys(webStorage)
          .filter((k) => k.startsWith(prefix))
          .forEach((k) => webStorage.removeItem(k));
      } else {
        Object.keys(memoryStore)
          .filter((k) => k.startsWith(prefix))
          .forEach((k) => delete memoryStore[k]);
      }
    },
  };
};

// expo-secure-store only accepts keys matching /^[\w.-]+$/, so the
// `mmkv:<id>:` prefix style is sanitized to dot-separated keys.
const sanitizeSecureKey = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, '_');
const secureKeyFor = (id: string, key: string): string => sanitizeSecureKey(`${id}.${key}`);

// Auth keys that must be purged on clearAll even when the in-memory key
// registry is empty (e.g. logout immediately after a cold start in Expo Go,
// where this module instance has not yet seen any set() calls).
const KNOWN_AUTH_KEYS = ['accessToken', 'refreshToken', 'userCache'];

type SecureStoreModule = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  deleteItemAsync?: (key: string) => Promise<void>;
};

const isThenable = (value: unknown): boolean =>
  !!value &&
  (typeof value === 'object' || typeof value === 'function') &&
  typeof (value as { then?: unknown }).then === 'function';

// Encrypted, persistent storage for the auth session. Uses the blocking sync
// SecureStore.getItem/setItem (SDK 57) so the storage interface stays
// synchronous for existing call sites. There is no sync delete, so delete() /
// clearAll() remove from the mirror synchronously and fire deleteItemAsync
// without awaiting. A localStorage/memory mirror is kept so values that
// SecureStore rejects (e.g. > ~2KB userCache JSON) still work for the session.
const makeSecureStoreStorage = (id: string) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SecureStore = require('expo-secure-store') as SecureStoreModule;
  if (typeof SecureStore?.getItem !== 'function' || typeof SecureStore?.setItem !== 'function') {
    return null;
  }
  const mirror = makeFallbackStorage(id);
  const trackedKeys = new Set<string>();
  // Probe the sync contract up front: under jest-expo the native sync methods
  // are mocked with async implementations (they return Promises), and on web
  // the native module is absent (calls throw). Either way the sync wrapper is
  // unusable here — return null so getStorage() falls back to MMKV/memory.
  try {
    const probe = SecureStore.getItem!(secureKeyFor(id, '__probe__')) as unknown;
    if (isThenable(probe)) return null;
  } catch {
    return null;
  }
  const readMirror = (key: string): string | undefined => {
    try {
      const value = mirror.getString(key) as string | null | undefined;
      return value ?? undefined;
    } catch {
      return undefined;
    }
  };
  const fireDelete = (secureKey: string) => {
    try {
      void SecureStore.deleteItemAsync?.(secureKey)?.catch(() => {});
    } catch {
      // Native module missing (web) — mirror already updated.
    }
  };
  return {
    getString: (key: string) => {
      try {
        const value = SecureStore.getItem!(secureKeyFor(id, key)) as unknown;
        // Defensive: ignore thenables if the sync contract ever breaks at
        // runtime (see probe above) and serve the mirror instead.
        if (!isThenable(value) && value !== null && value !== undefined) {
          return value as string;
        }
      } catch {
        // Native module missing (web) or key invalidated — fall back to mirror.
      }
      return readMirror(key);
    },
    set: (key: string, value: string) => {
      trackedKeys.add(key);
      try {
        mirror.set(key, value);
      } catch {
        // ignore — SecureStore is the durable copy
      }
      try {
        SecureStore.setItem!(secureKeyFor(id, key), value);
      } catch {
        // Value rejected (e.g. oversized) — mirror keeps the session value.
      }
    },
    delete: (key: string) => {
      trackedKeys.delete(key);
      try {
        mirror.delete(key);
      } catch {
        // ignore
      }
      fireDelete(secureKeyFor(id, key));
    },
    clearAll: () => {
      const keys = new Set<string>([...trackedKeys, ...KNOWN_AUTH_KEYS]);
      trackedKeys.clear();
      try {
        mirror.clearAll();
      } catch {
        // ignore
      }
      for (const k of keys) {
        fireDelete(secureKeyFor(id, k));
      }
    },
  };
};

export const getStorage = (id: string) => {
  if (!mmkvInstances[id]) {
    if (id === 'spotibase-auth') {
      // Auth session prefers encrypted SecureStore: it is bundled in Expo Go
      // (where react-native-mmkv's native module is missing and tokens would
      // otherwise fall back to a volatile in-memory store) and also works in
      // dev-client builds.
      try {
        const secure = makeSecureStoreStorage(id);
        if (secure) {
          mmkvInstances[id] = secure;
          return secure;
        }
      } catch {
        // SecureStore unavailable (web) — fall through to MMKV/fallback.
      }
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MMKV } = require('react-native-mmkv');
      mmkvInstances[id] = new MMKV({ id });
    } catch {
      // Fallback for environments where MMKV is not available (web, tests):
      // localStorage on web, in-memory otherwise.
      mmkvInstances[id] = makeFallbackStorage(id);
    }
  }
  return mmkvInstances[id];
};

export * from './playerSharedValue';
