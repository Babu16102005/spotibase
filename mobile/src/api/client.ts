import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  HomeResponse,
  SearchResponse,
  SongResponse,
  AlbumResponse,
  ArtistResponse,
  PlaylistResponse,
  QueueResponse,
  LibraryResponse,
  PagedResponse,
  UserResponse,
  UserSettingsResponse,
  CreatePlaylistRequest,
  UpdateProfileRequest,
  UpdateSettingsRequest,
  NotificationResponse,
  AdminDashboardResponse,
  DownloadResponse,
  DownloadStatsResponse,
} from '../types';
import { getStorage } from '../utils';

const storage = getStorage('spotibase-auth');

export const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8088/api/v1';

const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = storage.getString('accessToken');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = storage.getString('refreshToken');
        if (!refreshToken) throw new Error('No refresh token');

        const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefresh } = res.data as AuthResponse;

        storage.set('accessToken', accessToken);
        storage.set('refreshToken', newRefresh);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError) {
        storage.clearAll();
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  register: (data: RegisterRequest) => apiClient.post<AuthResponse>('/auth/register', data),
  login: (data: LoginRequest) => apiClient.post<AuthResponse>('/auth/login', data),
  refresh: (refreshToken: string) => apiClient.post<AuthResponse>('/auth/refresh', { refreshToken }),
  socialAuth: (provider: string, idToken: string) => apiClient.post<AuthResponse>(`/auth/social/${provider}`, { idToken }),
  forgotPassword: (email: string) => apiClient.post('/auth/forgot-password', { email }),
  resetPassword: (token: string, newPassword: string) => apiClient.post('/auth/reset-password', { token, newPassword }),
};

export const userApi = {
  getMe: () => apiClient.get<UserResponse>('/users/me'),
  updateProfile: (data: UpdateProfileRequest) => apiClient.put<UserResponse>('/users/me', data),
  deleteAccount: () => apiClient.delete('/users/me'),
  updateAvatar: (file: FormData) => apiClient.put<UserResponse>('/users/me/avatar', file, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  updateCover: (file: FormData) => apiClient.put<UserResponse>('/users/me/cover', file, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  changePassword: (oldPassword: string, newPassword: string) =>
    apiClient.put('/users/me/password', { oldPassword, newPassword }),
  getUser: (id: string) => apiClient.get<UserResponse>(`/users/${id}`),
  followUser: (id: string) => apiClient.post(`/users/${id}/follow`),
  unfollowUser: (id: string) => apiClient.delete(`/users/${id}/follow`),
  getFollowers: (id: string, page: number = 0) => apiClient.get(`/users/${id}/followers?page=${page}`),
  getFollowing: (id: string, page: number = 0) => apiClient.get(`/users/${id}/following?page=${page}`),
};

export const songApi = {
  getAll: (page = 0, size = 20) =>
    apiClient.get<PagedResponse<SongResponse>>(`/songs?page=${page}&size=${size}`),
  getById: (id: string) => apiClient.get<SongResponse>(`/songs/${id}`),
  getTrending: (limit = 20) => apiClient.get<SongResponse[]>(`/songs/trending?limit=${limit}`),
  getNewReleases: (limit = 20) => apiClient.get<SongResponse[]>(`/songs/new-releases?limit=${limit}`),
  getFeatured: (limit = 20) => apiClient.get<SongResponse[]>(`/songs/featured?limit=${limit}`),
  like: (id: string) => apiClient.post(`/songs/${id}/like`),
  unlike: (id: string) => apiClient.delete(`/songs/${id}/like`),
  stream: (id: string) => `${BASE_URL}/songs/${id}/stream`,
};

export const albumApi = {
  getAll: (page = 0, size = 20) =>
    apiClient.get<PagedResponse<AlbumResponse>>(`/albums?page=${page}&size=${size}`),
  getById: (id: string) => apiClient.get<AlbumResponse>(`/albums/${id}`),
  getFeatured: (limit = 20) => apiClient.get<AlbumResponse[]>(`/albums/featured?limit=${limit}`),
  getNewReleases: (limit = 20) => apiClient.get<AlbumResponse[]>(`/albums/new-releases?limit=${limit}`),
  like: (id: string) => apiClient.post(`/albums/${id}/like`),
  unlike: (id: string) => apiClient.delete(`/albums/${id}/like`),
};

export const artistApi = {
  getAll: (page = 0, size = 20) =>
    apiClient.get<PagedResponse<ArtistResponse>>(`/artists?page=${page}&size=${size}`),
  getById: (id: string) => apiClient.get<ArtistResponse>(`/artists/${id}`),
  getTop: (limit = 20) => apiClient.get<ArtistResponse[]>(`/artists/top?limit=${limit}`),
  getFeatured: (limit = 20) => apiClient.get<ArtistResponse[]>(`/artists/featured?limit=${limit}`),
  follow: (id: string) => apiClient.post(`/artists/${id}/follow`),
  unfollow: (id: string) => apiClient.delete(`/artists/${id}/follow`),
};

export const playlistApi = {
  getAll: () => apiClient.get<PlaylistResponse[]>('/playlists'),
  getById: (id: string) => apiClient.get<PlaylistResponse>(`/playlists/${id}`),
  create: (data: CreatePlaylistRequest) => apiClient.post<PlaylistResponse>('/playlists', data),
  update: (id: string, data: Partial<CreatePlaylistRequest>) =>
    apiClient.put<PlaylistResponse>(`/playlists/${id}`, data),
  delete: (id: string) => apiClient.delete(`/playlists/${id}`),
  duplicate: (id: string) => apiClient.post<PlaylistResponse>(`/playlists/${id}/duplicate`),
  addSongs: (id: string, songIds: string[]) => apiClient.post(`/playlists/${id}/songs`, { songIds }),
  removeSong: (id: string, songId: string) => apiClient.delete(`/playlists/${id}/songs/${songId}`),
  reorder: (id: string, reorderList: { songId: string; newPosition: number }[]) =>
    apiClient.put(`/playlists/${id}/songs/reorder`, reorderList),
  like: (id: string) => apiClient.post(`/playlists/${id}/like`),
  unlike: (id: string) => apiClient.delete(`/playlists/${id}/like`),
  getFeatured: (limit = 20) => apiClient.get<PlaylistResponse[]>(`/playlists/featured?limit=${limit}`),
  togglePublic: (id: string) => apiClient.put(`/playlists/${id}/public`),
  toggleCollaborative: (id: string) => apiClient.put(`/playlists/${id}/collaborative`),
};

export const searchApi = {
  search: (query: string, types = 'song,album,artist,playlist', page = 0) =>
    apiClient.get<SearchResponse>(
      `/search?query=${encodeURIComponent(query)}&types=${types}&page=${page}`
    ),
  suggestions: (query: string, limit = 10) =>
    apiClient.get<string[]>(
      `/search/suggestions?query=${encodeURIComponent(query)}&limit=${limit}`
    ),
  trending: () => apiClient.get<string[]>('/search/trending'),
};

export const homeApi = {
  getHome: () => apiClient.get<HomeResponse>('/home'),
};

export const queueApi = {
  getQueue: () => apiClient.get<QueueResponse>('/queue'),
  addToQueue: (songId: string, source: string) => apiClient.post('/queue', { songId, source }),
  playNext: (songId: string, source: string) => apiClient.post('/queue/play-next', { songId, source }),
  remove: (id: string) => apiClient.delete(`/queue/${id}`),
  move: (id: string, newPosition: number) => apiClient.put(`/queue/${id}/move`, { newPosition }),
  clear: () => apiClient.delete('/queue/clear'),
  save: () => apiClient.post('/queue/save'),
  restore: () => apiClient.post<QueueResponse>('/queue/restore'),
};

export const libraryApi = {
  getLibrary: () => apiClient.get<LibraryResponse>('/library'),
  getPlaylists: () => apiClient.get<PlaylistResponse[]>('/library/playlists'),
  getAlbums: () => apiClient.get<AlbumResponse[]>('/library/albums'),
  getArtists: () => apiClient.get<ArtistResponse[]>('/library/artists'),
  getLikedSongs: () => apiClient.get<SongResponse[]>('/library/liked-songs'),
  getRecent: () => apiClient.get<SongResponse[]>('/library/recent'),
  getHistory: (page = 0) =>
    apiClient.get<PagedResponse<SongResponse>>(`/library/history?page=${page}`),
};

export const settingsApi = {
  getSettings: () => apiClient.get<UserSettingsResponse>('/settings'),
  updateSettings: (data: UpdateSettingsRequest) =>
    apiClient.put<UserSettingsResponse>('/settings', data),
  updateTheme: (theme: string) =>
    apiClient.put<UserSettingsResponse>('/settings/theme', { theme }),
};

export const notificationApi = {
  getNotifications: (page = 0) =>
    apiClient.get<PagedResponse<NotificationResponse>>(`/notifications?page=${page}`),
  getUnreadCount: () => apiClient.get<{ count: number }>('/notifications/unread-count'),
  markAsRead: (id: string) => apiClient.put(`/notifications/${id}/read`),
  markAllAsRead: () => apiClient.put('/notifications/read-all'),
};

export const adminApi = {
  getDashboard: () => apiClient.get<AdminDashboardResponse>('/admin/dashboard'),
  getUsers: (page = 0) => apiClient.get(`/admin/users?page=${page}`),
  updateUserRole: (id: string, role: string) =>
    apiClient.put(`/admin/users/${id}/role`, { role }),
  forceDeleteSong: (id: string) => apiClient.delete(`/admin/songs/${id}`),
  featureSong: (songId: string) => apiClient.post('/admin/feature/song', { songId }),
  featurePlaylist: (playlistId: string) =>
    apiClient.post('/admin/feature/playlist', { playlistId }),
  getUserGrowth: () => apiClient.get('/admin/analytics/user-growth'),
  getTopSongs: () => apiClient.get('/admin/analytics/top-songs'),
  getTopGenres: () => apiClient.get('/admin/analytics/top-genres'),
};

export const downloadApi = {
  getAll: () => apiClient.get<DownloadResponse[]>('/downloads'),
  getByStatus: (status: string) => apiClient.get<DownloadResponse[]>(`/downloads?status=${status}`),
  getStats: () => apiClient.get<DownloadStatsResponse>('/downloads/stats'),
  start: (songId: string, quality = 'HIGH') => apiClient.post<DownloadResponse>('/downloads', { songId, quality }),
  delete: (songId: string) => apiClient.delete(`/downloads/${songId}`),
  clearCompleted: () => apiClient.delete('/downloads'),
  markPlayed: (songId: string) => apiClient.put<DownloadResponse>(`/downloads/${songId}/play`),
};

export { storage };
export default apiClient;
