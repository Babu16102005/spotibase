export const formatDuration = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const formatCount = (count: number): string => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
};

export const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
};

export const getRelativeTime = (dateStr: string): string => {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateStr);
};

export const getImageUrl = (url?: string, size: number = 300): string => {
  if (!url) return '';
  if (url.includes('supabase.co')) {
    return `${url}?width=${size}&quality=80`;
  }
  return url;
};

// MMKV storage cache
let mmkvInstance: any = null;

const memoryStore: Record<string, string> = {};

const makeFallbackStorage = (id: string) => {
  const webStorage =
    typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  const prefix = `mmkv:${id}:`;
  return {
    getString: (key: string) => {
      if (webStorage) return webStorage.getItem(prefix + key);
      return memoryStore[key] || null;
    },
    set: (key: string, value: string) => {
      if (webStorage) webStorage.setItem(prefix + key, value);
      else memoryStore[key] = value;
    },
    clearAll: () => {
      if (webStorage) {
        Object.keys(webStorage)
          .filter((k) => k.startsWith(prefix))
          .forEach((k) => webStorage.removeItem(k));
      } else {
        Object.keys(memoryStore).forEach((k) => delete memoryStore[k]);
      }
    },
  };
};

export const getStorage = (id: string) => {
  if (!mmkvInstance) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { MMKV } = require('react-native-mmkv');
      mmkvInstance = new MMKV({ id });
    } catch {
      // Fallback for environments where MMKV is not available (web, tests):
      // localStorage on web, in-memory otherwise.
      mmkvInstance = makeFallbackStorage(id);
    }
  }
  return mmkvInstance;
};
