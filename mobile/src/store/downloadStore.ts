import { create } from 'zustand';
import { DownloadResponse, DownloadStatsResponse } from '../types';
import { downloadApi } from '../api/client';
import { useAuthStore } from './authStore';

interface DownloadState {
  downloads: DownloadResponse[];
  stats: DownloadStatsResponse | null;
  isLoading: boolean;
  error: string | null;

  fetchDownloads: () => Promise<void>;
  fetchStats: () => Promise<void>;
  startDownload: (songId: string, quality?: string) => Promise<DownloadResponse | null>;
  deleteDownload: (songId: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
  markPlayed: (songId: string) => Promise<void>;
  getDownload: (songId: string) => DownloadResponse | undefined;
  isDownloaded: (songId: string) => boolean;
  isDownloading: (songId: string) => boolean;
  getDownloadProgress: (songId: string) => number;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  downloads: [],
  stats: null,
  isLoading: false,
  error: null,

  fetchDownloads: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await downloadApi.getAll();
      set({ downloads: response.data, isLoading: false });
      await get().fetchStats();
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  fetchStats: async () => {
    try {
      const response = await downloadApi.getStats();
      set({ stats: response.data });
    } catch (err) {
      console.error('Failed to fetch download stats:', err);
    }
  },

  startDownload: async (songId, quality = 'HIGH') => {
    set({ error: null });
    try {
      const response = await downloadApi.start(songId, quality);
      const newDownload = response.data;
      set((state) => ({
        downloads: [...state.downloads.filter(d => d.songId !== songId), newDownload],
      }));
      await get().fetchStats();
      return newDownload;
    } catch (err: any) {
      set({ error: err.message });
      return null;
    }
  },

  deleteDownload: async (songId) => {
    set({ error: null });
    try {
      await downloadApi.delete(songId);
      set((state) => ({
        downloads: state.downloads.filter(d => d.songId !== songId),
      }));
      await get().fetchStats();
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  clearCompleted: async () => {
    set({ error: null });
    try {
      await downloadApi.clearCompleted();
      set((state) => ({
        downloads: state.downloads.filter(d => d.status !== 'COMPLETED'),
      }));
      await get().fetchStats();
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  markPlayed: async (songId) => {
    try {
      const response = await downloadApi.markPlayed(songId);
      set((state) => ({
        downloads: state.downloads.map(d =>
          d.songId === songId ? response.data : d
        ),
      }));
    } catch (err) {
      console.error('Failed to mark download as played:', err);
    }
  },

  getDownload: (songId) => {
    return get().downloads.find(d => d.songId === songId);
  },

  isDownloaded: (songId) => {
    const download = get().downloads.find(d => d.songId === songId);
    return download?.status === 'COMPLETED';
  },

  isDownloading: (songId) => {
    const download = get().downloads.find(d => d.songId === songId);
    return download?.status === 'DOWNLOADING' || download?.status === 'PENDING';
  },

  getDownloadProgress: (songId) => {
    const download = get().downloads.find(d => d.songId === songId);
    if (!download) return 0;
    if (download.status === 'COMPLETED') return 100;
    if (download.status === 'FAILED') return -1;
    return 50; // indeterminate for DOWNLOADING/PENDING
  },
}));

// Auto-fetch downloads when auth state changes
if (typeof window !== 'undefined') {
  useAuthStore.subscribe((state) => {
    if (state.isAuthenticated && state.user) {
      useDownloadStore.getState().fetchDownloads();
    } else {
      useDownloadStore.setState({ downloads: [], stats: null });
    }
  });
}