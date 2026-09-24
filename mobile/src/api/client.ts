import axios, { AxiosHeaders, AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
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
    const C = Constants as any;
    // Expo Go runs as a StoreClient; its packager host is surfaced via the
    // Expo Go config rather than expoConfig.hostUri, so read both (plus the
    // legacy manifest fields) before giving up.
    const isStoreClient =
      C.executionEnvironment === 'storeClient' ||
      C.appOwnership === 'expo' ||
      C.expoGoConfig != null;
    const expoGoHostCandidates: (string | undefined | null)[] = [
      C.expoGoConfig?.debuggerHost,
      C.expoGoConfig?.packagerOpts?.host,
    ];
    const hostCandidates: (string | undefined | null)[] = isStoreClient
      ? [
          ...expoGoHostCandidates,
          C.expoConfig?.hostUri,
          C.manifest?.debuggerHost,
          C.manifest2?.extra?.expoGo?.debuggerHost,
          C.manifest2?.extra?.expoClient?.host,
        ]
      : [
          C.expoConfig?.hostUri,
          ...expoGoHostCandidates,
          C.manifest?.debuggerHost,
          C.manifest2?.extra?.expoGo?.debuggerHost,
          C.manifest2?.extra?.expoClient?.host,
        ];
    for (const hostUri of hostCandidates) {
      if (typeof hostUri === 'string' && hostUri.length > 0) {
        const ip = hostUri.split(':')[0]?.trim();
        if (ip && ip !== 'localhost' && ip !== '127.0.0.1' && ip !== '::1') return ip;
      }
    }
    // Last resort: derive the LAN IP from the Expo Go / dev-client link URL.
    const linkingUri: unknown = C.linkingUri ?? C.experienceUrl;
    if (typeof linkingUri === 'string') {
      const match = linkingUri.match(/:\/\/([^/:]+)/);
      const ip = match?.[1]?.trim();
      if (ip && ip !== 'localhost' && ip !== '127.0.0.1' && ip !== '::1') return ip;
    }
  } catch (e) {}
  return null;
};

const getDefaultBaseUrl = () => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  // Web: if accessed from a network IP (e.g. mobile browser), use that hostname instead of localhost
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      const host = window.location.hostname;
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return `http://${host}:8088/api/v1`;
      }
    }
    return 'http://localhost:8088/api/v1';
  }
  // Physical Android devices reach the dev server over the LAN IP discovered
  // above (devIp:8088). The 10.0.2.2 loopback below is emulator-only, so it is
  // strictly a fallback when no dev IP is known.
  const devIp = getDevHostIp();
  if (devIp) {
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

/**
 * Returns the direct stream URL for a song.
 * When a song has a direct Cloudflare R2 / Storage URL (fileUrl), native mobile
 * and web players can stream it directly from the CDN with 0 backend latency,
 * avoiding localhost/IP routing failures and 302 redirect stalls on mobile.
 */
export const getTrackStreamUrl = (track: { id?: string; fileUrl?: string }): string => {
  if (track?.fileUrl && (track.fileUrl.startsWith('http://') || track.fileUrl.startsWith('https://'))) {
    return track.fileUrl;
  }
  return `${getBaseUrl()}/songs/${track?.id}/stream`;
};

const storage = getStorage('spotibase-auth');

// Single-flight refresh: concurrent 401s share one /auth/refresh call instead
// of racing (a loser could otherwise wipe tokens stored by the winner).
let refreshPromise: Promise<AuthResponse> | null = null;

const isNetworkError = (err: any): boolean =>
  !err?.response &&
  (err?.message === 'Network Error' || err?.code === 'ERR_NETWORK' || err?.code === 'ECONNABORTED');

const isInvalidGrant = (err: any): boolean => {
  const status = err?.response?.status;
  // Only an explicit auth rejection means the refresh token is dead. Network
  // errors/timeouts and 5xx responses are transient — offline is not logged out.
  return status === 401 || status === 403;
};

/**
 * P0-415: multipart uploads must NEVER send the apiClient
 * `application/json` default nor a bare `multipart/form-data` value without
 * boundary (both yield HTTP 415). Axios merges defaults + per-request via
 * `AxiosHeaders.concat`: omitting the key keeps the default, while an
 * explicit `undefined` value deletes it so the adapter wires
 * `multipart/form-data; boundary=...` on the wire.
 *
 * Handles both header shapes:
 * - `AxiosHeaders` instances via `.delete()` / `.set(..., undefined)`
 * - plain objects via `delete headers[...]` + explicit `undefined` marker
 * (Expo SDK 57 / RN 0.86: FormData is spec-compliant; the adapter sets the
 * boundary only when no Content-Type is present after merge).
 */
export const clearContentType = (headers: any): any => {
  if (headers && typeof (headers as AxiosHeaders).delete === 'function') {
    try {
      (headers as AxiosHeaders).delete('Content-Type');
    } catch {}
  }
  if (headers && typeof headers === 'object') {
    try {
      delete headers['Content-Type'];
    } catch {}
    try {
      delete headers['content-type'];
    } catch {}
    try {
      if (typeof (headers as AxiosHeaders).set === 'function') {
        (headers as AxiosHeaders).set('Content-Type', undefined as any);
      } else {
        headers['Content-Type'] = undefined;
      }
    } catch {}
  }
  return headers;
};

/**
 * Per-request headers for FormData uploads. Returns an `AxiosHeaders`
 * instance whose Content-Type is the merge-time delete-marker, so
 * `AxiosHeaders.concat({application/json default}, perRequest)` yields no
 * Content-Type and the wire carries the adapter-generated boundary.
 */
export const multipartHeaders = (): any => {
  const h = new AxiosHeaders({ 'Content-Type': undefined } as any);
  return clearContentType(h);
};

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

          // Re-read the token per attempt and drop a stale Authorization header
          // when the session is gone (e.g. logout raced this retry) instead of
          // replaying a dead credential against the next candidate.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawHeaders: any = originalRequest.headers as any;
          const retryHeaders: any =
            rawHeaders && typeof rawHeaders.toJSON === 'function'
              ? { ...rawHeaders.toJSON() }
              : { ...(rawHeaders || {}) };
          if (token) {
            retryHeaders.Authorization = `Bearer ${token}`;
          } else {
            delete retryHeaders.Authorization;
          }
          // Preserve multipart wire headers: never replay application/json or a
          // bare multipart value without boundary for FormData — clear so axios
          // regenerates `multipart/form-data; boundary=...` on the retry.
          // Handles both AxiosHeaders instances and plain objects.
          if (typeof FormData !== 'undefined' && originalRequest.data instanceof FormData) {
            if (retryHeaders && typeof (retryHeaders as AxiosHeaders).delete === 'function') {
              try {
                (retryHeaders as AxiosHeaders).delete('Content-Type');
              } catch {}
            }
            delete retryHeaders['Content-Type'];
            delete retryHeaders['content-type'];
            retryHeaders['Content-Type'] = undefined;
          }

          const res = await axios({
            method: originalRequest.method || 'GET',
            url: fullUrl,
            data: originalRequest.data,
            headers: retryHeaders,
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
      const refreshToken = storage.getString('refreshToken');
      if (!refreshToken) {
        // No way to recover the session — drop the dead access token.
        storage.clearAll();
        return Promise.reject(new Error('No refresh token'));
      }
      try {

        if (!refreshPromise) {
          const currentRefreshToken: string = refreshToken;
          refreshPromise = axios
            .post(`${getBaseUrl()}/auth/refresh`, { refreshToken: currentRefreshToken })
            .then((r) => r.data as AuthResponse)
            .finally(() => {
              refreshPromise = null;
            });
        }
        const { accessToken, refreshToken: newRefresh } = await refreshPromise;

        storage.set('accessToken', accessToken);
        storage.set('refreshToken', newRefresh);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }
        return apiClient(originalRequest);
      } catch (refreshError: any) {
        // Keep the stored session on network errors/timeouts so the user stays
        // logged in while offline; only wipe when the backend explicitly
        // rejects the refresh grant (401/403). The original 401 is rejected so
        // screens can redirect to Login; it is tagged when the refresh never
        // reached the server so screens don't wipe a still-valid session.
        if (!isNetworkError(refreshError) && isInvalidGrant(refreshError)) {
          storage.clearAll();
        }
        if (isNetworkError(refreshError)) {
          (error as any)._refreshNetworkError = true;
          return Promise.reject(error);
        }
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
  // P0-415: never send bare `multipart/form-data` (no boundary => 415).
  // Clear the application/json default so the adapter wires
  // `multipart/form-data; boundary=...` (same as aiApi.voice).
  updateAvatar: (file: FormData) => apiClient.put<UserResponse>('/users/me/avatar', file, {
    headers: multipartHeaders(),
  }),
  updateCover: (file: FormData) => apiClient.put<UserResponse>('/users/me/cover', file, {
    headers: multipartHeaders(),
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
        // Web needs a real File/Blob (use mapped File directly, or fallback to fetch blob)
        if (file.file instanceof File) {
          formData.append('files', file.file);
        } else {
          const blob = await fetch(file.uri).then((r) => r.blob());
          formData.append('files', new File([blob], file.name, { type: file.mimeType || 'audio/flac' }));
        }
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
    // P0-415: clear Content-Type so the adapter wires the multipart boundary
    // (a bare `multipart/form-data` value without boundary yields HTTP 415).
    const res = await apiClient.post<SongResponse[]>('/songs/bulk', formData, {
      headers: multipartHeaders(),
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
  search: (query: string, types = 'song,album,artist,playlist', page = 0, signal?: AbortSignal) =>
    apiClient.get<SearchResponse>(
      `/search?query=${encodeURIComponent(query)}&types=${types}&page=${page}`,
      signal ? { signal } : undefined
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

export const aiApi = {
  text: (text: string, context?: any) =>
    apiClient.post("/ai/text", { text, context }),

  voice: (audioUri: string, transcriptFallback?: string, context?: any, filename = "audio.webm") => {
    const formData = new FormData();
    const lower = (filename || "").toLowerCase();
    const mimeType = lower.endsWith(".m4a") || lower.endsWith(".mp4") || lower.endsWith(".aac")
      ? "audio/mp4"
      : lower.endsWith(".ogg")
        ? "audio/ogg"
        : lower.endsWith(".wav")
          ? "audio/wav"
          : lower.endsWith(".mp3")
            ? "audio/mpeg"
            : "audio/webm";
    formData.append("audio", {
      uri: audioUri,
      name: filename,
      type: mimeType,
    } as unknown as Blob);
    if (transcriptFallback) formData.append("transcript_fallback", transcriptFallback);
    if (context) formData.append("context", JSON.stringify(context));
    // Explicitly clear the apiClient application/json default so axios sets
    // `multipart/form-data; boundary=...` on the wire (a manual multipart
    // value without boundary yields HTTP 415). Uses AxiosHeaders.delete +
    // plain deletes + explicit undefined merge-marker (see multipartHeaders).
    return apiClient.post("/ai/voice", formData, {
      headers: multipartHeaders(),
      timeout: 30000,
    });
  },

  /**
   * Lightweight live-text partial for realtime voice search: POST
   * /ai/voice-partial { text, context }. The backend may not implement this
   * route yet (404/405) — callers (voiceOrchestrator) treat unsupported as
   * a signal to use the /search fallback instead of surfacing an error.
   */
  voicePartial: (text: string, context?: any, signal?: AbortSignal) =>
    apiClient.post("/ai/voice-partial", { text, context }, signal ? { signal, timeout: 8000 } : { timeout: 8000 }),

  health: () => apiClient.get("/ai/health"),
};
