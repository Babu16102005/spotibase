import { create } from 'zustand';
import { NotificationResponse, PagedResponse } from '../types';
import { notificationApi } from '../api/client';
import { useAuthStore } from './authStore';

interface NotificationState {
  notifications: NotificationResponse[];
  unreadCount: number;
  /** Last successfully loaded page (0-based). */
  page: number;
  /** Whether the last loaded page was the final page. */
  last: boolean;
  isLoading: boolean;
  error: string | null;

  fetchNotifications: (page?: number) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  pushRealtimeNotification: (notification: NotificationResponse) => void;
  setUnreadCount: (count: number) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  page: 0,
  last: true,
  isLoading: false,
  error: null,

  fetchNotifications: async (page = 0) => {
    const authState = useAuthStore.getState();
    if (!authState.isAuthenticated || !authState.user) {
      set({ isLoading: false });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      if (!notificationApi || typeof notificationApi.getNotifications !== 'function') {
        set({ isLoading: false });
        return;
      }
      const res = await notificationApi.getNotifications(page);
      const paged = res.data as PagedResponse<NotificationResponse>;
      set((state) => ({
        notifications:
          page === 0 ? paged.content : [...state.notifications, ...paged.content],
        page: paged.page,
        last: paged.last,
        isLoading: false,
      }));
    } catch (err: any) {
      if (err?.response?.status !== 401 && err?.response?.status !== 403) {
        set({ error: err.message, isLoading: false });
      } else {
        set({ isLoading: false });
      }
    }
  },

  fetchUnreadCount: async () => {
    const authState = useAuthStore.getState();
    if (!authState.isAuthenticated || !authState.user) {
      return;
    }
    try {
      if (!notificationApi || typeof notificationApi.getUnreadCount !== 'function') {
        return;
      }
      const res = await notificationApi.getUnreadCount();
      if (res?.data) {
        set({ unreadCount: res.data.count });
      }
    } catch (err: any) {
      if (err?.response?.status !== 401 && err?.response?.status !== 403) {
        console.error('Failed to fetch unread count:', err);
      }
    }
  },

  markAsRead: async (id) => {
    try {
      await notificationApi.markAsRead(id);
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, isRead: true } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - (get().notifications.find((n) => n.id === id)?.isRead ? 0 : 1)),
      }));
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  },

  markAllAsRead: async () => {
    try {
      await notificationApi.markAllAsRead();
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
        unreadCount: 0,
      }));
    } catch (err) {
      console.error('Failed to mark all read:', err);
    }
  },

  pushRealtimeNotification: (notification: NotificationResponse) => {
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 100),
      unreadCount: state.unreadCount + 1,
    }));
  },

  setUnreadCount: (count: number) => set({ unreadCount: count }),
}));

// Auto-sync on login
if (typeof window !== 'undefined' || typeof (globalThis as any) !== 'undefined') {
  useAuthStore.subscribe((state) => {
    if (state.isAuthenticated) {
      useNotificationStore.getState().fetchNotifications(0);
      useNotificationStore.getState().fetchUnreadCount();
    } else {
      useNotificationStore.setState({ notifications: [], unreadCount: 0, page: 0, last: true });
    }
  });
}