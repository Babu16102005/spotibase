import { Platform } from 'react-native';

export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
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

export const coverSource = (url?: string | null): { uri: string } | number =>
  url ? { uri: url } : PLACEHOLDER_IMAGE;

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

export const getStorage = (id: string) => {
  if (!mmkvInstances[id]) {
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
