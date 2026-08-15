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
  PickedSongFile,
  BulkUploadEntry,
} from '../types';
import { getStorage } from '../utils';
import Constants from 'expo-constants';

const getDevHostIp = () => {
  try {
    const hostUri =
      Constants.expoConfig?.hostUri ||
      (Constants as any).manifest?.debuggerHost ||
      (Constants as any).manifest2?.extra?.expoGo?.debuggerHost;
    if (hostUri) {
      const ip = hostUri.split(':')[0];
      if (ip && ip !== 'localhost' && ip !== '127.0.0.1') return ip;
    }
  } catch (e) {}
  return null;
};

const getDefaultBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
    const hostname = window.location.hostname || 'localhost';
    return `http://${hostname}:8088/api/v1`;
  }
  const devIp = getDevHostIp();
  if (devIp && devIp !== '10.225.134.105') {
    return `http://${devIp}:8088/api/v1`;
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8088/api/v1';
  }
  return 'http://localhost:8088/api/v1';
};

let activeBaseUrl = getDefaultBaseUrl();

export const getBaseUrl = (): string => activeBaseUrl;

export const setBaseUrl = (newUrl: string): void => {
  activeBaseUrl = newUrl;
  apiClient.defaults.baseURL = newUrl;
};

export const BASE_URL = activeBaseUrl;
const storage = getStorage('spotibase-auth');

const apiClient: AxiosInstance = axios.create({
  baseURL: activeBaseUrl,
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
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean; _retryNetwork?: boolean };
    if (!error.response && originalRequest && !originalRequest._retryNetwork) {
      originalRequest._retryNetwork = true;
      const devIp = getDevHostIp();
      const currentUrl = getBaseUrl();

      const candidates = Platform.OS === 'android'
        ? [
            'http://10.0.2.2:8088/api/v1',
            devIp ? `http://${devIp}:8088/api/v1` : null,
            'http://localhost:8088/api/v1',
          ].filter((u): u is string => Boolean(u) && u !== currentUrl)
        : [
            'http://localhost:8088/api/v1',
            devIp ? `http://${devIp}:8088/api/v1` : null,
          ].filter((u): u is string => Boolean(u) && u !== currentUrl);

      for (const candidate of candidates) {
        try {
          const token = storage.getString('accessToken');
          const relativeUrl = originalRequest.url?.startsWith('http')
            ? originalRequest.url.replace(/^https?:\/\/[^/]+\/api\/v1/, '')
            : originalRequest.url;
          const fullUrl = `${candidate}${relativeUrl || ''}`;

          const res = await axios({
            method: originalRequest.method || 'GET',
            url: fullUrl,
            data: originalRequest.data,
            headers: {
              ...originalRequest.headers,
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            timeout: originalRequest.timeout || 30000,
          });

          setBaseUrl(candidate);
          return res;
        } catch (retryErr: any) {
          if (retryErr.response) {
            setBaseUrl(candidate);
            return Promise.reject(retryErr);
          }
        }
      }
    }
    if ((error.response?.status === 401 || (error.response?.status === 403 && storage.getString('refreshToken'))) && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = storage.getString('refreshToken');
        if (!refreshToken) throw new Error('No refresh token');

        const res = await axios.post(`${getBaseUrl()}/auth/refresh`, { refreshToken });
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
  delete: (id: string) => apiClient.delete(`/songs/${id}`),
  stream: (id: string) => `${getBaseUrl()}/songs/${id}/stream`,
  /**
   * Bulk upload: one or more audio files in a single multipart request.
   * Metadata is optional per file (server parses FLAC/MP3 tags when absent).
   * Files are stored as-is, so FLAC is streamed back as FLAC.
   */
  uploadBulk: async (
    files: PickedSongFile[],
    requests: BulkUploadEntry[] = [],
    onProgress?: (loaded: number, total: number) => void
  ): Promise<SongResponse[]> => {
    const formData = new FormData();
    for (const file of files) {
      if (Platform.OS === 'web') {
        // Web needs a real File/Blob (document picker returns a blob: URI)
        const blob = await fetch(file.uri).then((r) => r.blob());
        formData.append('files', new File([blob], file.name, { type: file.mimeType || 'audio/flac' }));
      } else {
        // React Native accepts { uri, name, type } objects in FormData
        formData.append('files', {
          uri: file.uri,
          name: file.name,
          type: file.mimeType || 'audio/flac',
        } as unknown as Blob);
      }
    }
    if (requests.length > 0) {
      formData.append('requests', JSON.stringify(requests));
    }
    const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
    const res = await apiClient.post<SongResponse[]>('/songs/bulk', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0, // large FLAC files can take a while
      onUploadProgress: (e) => onProgress?.(e.loaded, e.total || totalBytes),
    });
    return res.data;
  },
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
  forceDeletePlaylist: (id: string) => apiClient.delete(`/admin/playlists/${id}`),
  forceDeleteAlbum: (id: string) => apiClient.delete(`/admin/albums/${id}`),
  forceDeleteArtist: (id: string) => apiClient.delete(`/admin/artists/${id}`),
  forceDeleteUser: (id: string) => apiClient.delete(`/admin/users/${id}`),
  featureSong: (songId: string) => apiClient.post('/admin/feature/song', { songId }),
  featurePlaylist: (playlistId: string) =>
    apiClient.post('/admin/feature/playlist', { playlistId }),
  syncStorage: () => apiClient.post<AdminDashboardResponse>('/admin/storage/sync'),
  clearAllStorage: () => apiClient.post<AdminDashboardResponse>('/admin/storage/clear-all'),
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
