import axios, { AxiosHeaders, AxiosInstance, AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
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

/**
 * Per-request timeout budget.
 *
 * Two layers (kept compatible with the existing `axios.create({timeout: 30000})`
 * contract asserted by client.test):
 * - CREATE stays 30s: the documented ceiling for slow ops.
 * - `apiClient.defaults.timeout` is set to READ_TIMEOUT_MS (10s) right after
 *   creation: every read without an explicit override fails fast at 10s while
 *   keeping its single-argument `get(url)` call shape.
 * - Search passes an explicit 8s override (fail fast while typing).
 * - Uploads (multipart bulk/avatar/cover, voice) keep 0 (no timeout) or their
 *   existing explicit value — large FLAC files take a while.
 * - Known-slow admin storage ops opt back up to the 30s ceiling explicitly.
 */
export const READ_TIMEOUT_MS = 10_000;
export const SEARCH_TIMEOUT_MS = 8_000;

/**
 * YouTube catalog budget — aligns with the backend total 5s split
 * (Bs 3s search + Bh 2s hydration, hydration cap 20, pooled WebClient).
 * Search/trending/resolve must fail fast at 5s while typing/scrolling.
 */
export const YOUTUBE_SEARCH_TIMEOUT_MS = 5_000;

/**
 * Ordered home tier served by `GET /api/v1/home?tier=`.
 * Backend contract: critical = recently-played + trending,
 * secondary = browse/catalog, heavy = made-for-you + daily-mixes,
 * `all` = legacy full feed.
 */
export type HomeTierParam = 'critical' | 'secondary' | 'heavy';

/**
 * Per-tier client timeout budgets, wired via `reqOpts` in
 * `homeApi.getHomeTier`. Budgets sit above the server budgets
 * (critical 2000ms / secondary 2500ms / heavy 4000ms) plus network
 * headroom; blur-abort still fail-fasts via per-tier AbortController.
 */
export const HOME_TIER_TIMEOUT_MS: Record<HomeTierParam, number> = {
  critical: 5_000,
  secondary: 8_000,
  heavy: 12_000,
};

/**
 * Build an axios request config. Returns `undefined` when only a signal was
 * *not* given: no-signal reads ride the 10s instance default so call sites
 * keep their single-argument shape (`apiClient.get(url)`).
 */
const reqOpts = (
  signal?: AbortSignal,
  timeout?: number
): { signal: AbortSignal; timeout?: number } | undefined => {
  if (!signal) return undefined;
  return { signal, ...(timeout != null ? { timeout } : {}) };
};

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

// Runtime read budget: plain reads fail fast at 10s (see READ_TIMEOUT_MS).
// The 30s create value above remains the ceiling — uploads and known-slow
// ops override it explicitly per request.
apiClient.defaults.timeout = READ_TIMEOUT_MS;

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
            // Preserve the original per-request budget (e.g. YouTube 5s,
            // search 8s, reads 10s, uploads 0 = no timeout). `??` (not `||`)
            // keeps an explicit 0 (no timeout) from replaying as 30s.
            timeout: originalRequest.timeout ?? 30000,
            // Preserve cancellation: a debounced search aborted while the
            // base-URL retry was in flight must not resurrect as a stale success.
            signal: (originalRequest as { signal?: AbortSignal }).signal,
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
    if ((error.response?.status === 401) && !originalRequest._retry) {
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

/**
 * In-flight GET dedup: identical concurrent reads share one promise instead
 * of hitting the network N times (double onEndReached, focus+prefetch races,
 * StrictMode double-effects). This is the transport-level counterpart to
 * React Query's key-based dedup — screens without React Query (AllSongs
 * manual paging) get the same protection, which is why AllSongs no longer
 * needs its own `inFlightRef` guard.
 *
 * Requests carrying an AbortSignal keep their own lifecycle and are never
 * coalesced: a debounced search aborted mid-flight must not resolve another
 * caller, and vice versa.
 */
const inflightGets = new Map<string, Promise<any>>();

/** Test/dev escape hatch: drop all coalesced entries. */
export const clearRequestDedup = (): void => {
  inflightGets.clear();
};

const callGet = <T>(url: string, config?: object): Promise<AxiosResponse<T>> =>
  // Preserve the exact single-argument call shape when there is no config so
  // existing call sites/tests observing `get(url)` keep matching.
  (config === undefined ? apiClient.get<T>(url) : apiClient.get<T>(url, config));

export const dedupedGet = <T = any>(
  url: string,
  config?: { signal?: AbortSignal; timeout?: number }
): Promise<AxiosResponse<T>> => {
  if (config?.signal) return callGet<T>(url, config);
  const key = `GET ${url}`;
  const existing = inflightGets.get(key);
  if (existing) return existing as Promise<AxiosResponse<T>>;
  // callGet runs synchronously so call-site expectations (`get` invoked on
  // the same tick) hold; Promise.resolve adopts real axios promises and also
  // tolerates mocked transports that return undefined (jest).
  const p: Promise<AxiosResponse<T>> = Promise.resolve(callGet<T>(url, config));
  const cleanup = () => {
    if (inflightGets.get(key) === p) inflightGets.delete(key);
  };
  p.then(cleanup, cleanup);
  inflightGets.set(key, p);
  return p;
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
    timeout: 0, // uploads never time out on the client
  }),
  updateCover: (file: FormData) => apiClient.put<UserResponse>('/users/me/cover', file, {
    headers: multipartHeaders(),
    timeout: 0, // uploads never time out on the client
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
  getAll: (page = 0, size = 20, signal?: AbortSignal) =>
    dedupedGet<PagedResponse<SongResponse>>(`/songs?page=${page}&size=${size}`, reqOpts(signal, READ_TIMEOUT_MS)),
  getById: (id: string, signal?: AbortSignal) =>
    dedupedGet<SongResponse>(`/songs/${id}`, reqOpts(signal, READ_TIMEOUT_MS)),
  /**
   * Cursor catalogue page. Tried first by useSongs; falls back to getAll when
   * the backend answers 404/405 (see query/useSongs).
   */
  getCursor: (cursorId: string | null, size = 20, signal?: AbortSignal) => {
    const qs = [`size=${size}`];
    if (cursorId != null) qs.push(`cursorId=${encodeURIComponent(cursorId)}`);
    return dedupedGet(`/songs/cursor?${qs.join('&')}`, reqOpts(signal, READ_TIMEOUT_MS));
  },
  getTrending: (limit = 20, signal?: AbortSignal) =>
    dedupedGet<SongResponse[]>(`/songs/trending?limit=${limit}`, reqOpts(signal, READ_TIMEOUT_MS)),
  getNewReleases: (limit = 20, signal?: AbortSignal) =>
    dedupedGet<SongResponse[]>(`/songs/new-releases?limit=${limit}`, reqOpts(signal, READ_TIMEOUT_MS)),
  getFeatured: (limit = 20, signal?: AbortSignal) =>
    dedupedGet<SongResponse[]>(`/songs/featured?limit=${limit}`, reqOpts(signal, READ_TIMEOUT_MS)),
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
  getAll: (page = 0, size = 20, signal?: AbortSignal) =>
    dedupedGet<PagedResponse<AlbumResponse>>(`/albums?page=${page}&size=${size}`, reqOpts(signal, READ_TIMEOUT_MS)),
  getById: (id: string, signal?: AbortSignal) =>
    dedupedGet<AlbumResponse>(`/albums/${id}`, reqOpts(signal, READ_TIMEOUT_MS)),
  getFeatured: (limit = 20, signal?: AbortSignal) =>
    dedupedGet<AlbumResponse[]>(`/albums/featured?limit=${limit}`, reqOpts(signal, READ_TIMEOUT_MS)),
  getNewReleases: (limit = 20, signal?: AbortSignal) =>
    dedupedGet<AlbumResponse[]>(`/albums/new-releases?limit=${limit}`, reqOpts(signal, READ_TIMEOUT_MS)),
  like: (id: string) => apiClient.post(`/albums/${id}/like`),
  unlike: (id: string) => apiClient.delete(`/albums/${id}/like`),
};

export const artistApi = {
  getAll: (page = 0, size = 20, signal?: AbortSignal) =>
    dedupedGet<PagedResponse<ArtistResponse>>(`/artists?page=${page}&size=${size}`, reqOpts(signal, READ_TIMEOUT_MS)),
  getById: (id: string, signal?: AbortSignal) =>
    dedupedGet<ArtistResponse>(`/artists/${id}`, reqOpts(signal, READ_TIMEOUT_MS)),
  getTop: (limit = 20, signal?: AbortSignal) =>
    dedupedGet<ArtistResponse[]>(`/artists/top?limit=${limit}`, reqOpts(signal, READ_TIMEOUT_MS)),
  getFeatured: (limit = 20, signal?: AbortSignal) =>
    dedupedGet<ArtistResponse[]>(`/artists/featured?limit=${limit}`, reqOpts(signal, READ_TIMEOUT_MS)),
  follow: (id: string) => apiClient.post(`/artists/${id}/follow`),
  unfollow: (id: string) => apiClient.delete(`/artists/${id}/follow`),
};

export const playlistApi = {
  getAll: (signal?: AbortSignal) =>
    dedupedGet<PlaylistResponse[]>('/playlists', reqOpts(signal, READ_TIMEOUT_MS)),
  getById: (id: string, signal?: AbortSignal) =>
    dedupedGet<PlaylistResponse>(`/playlists/${id}`, reqOpts(signal, READ_TIMEOUT_MS)),
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
  getFeatured: (limit = 20, signal?: AbortSignal) =>
    dedupedGet<PlaylistResponse[]>(`/playlists/featured?limit=${limit}`, reqOpts(signal, READ_TIMEOUT_MS)),
  togglePublic: (id: string) => apiClient.put(`/playlists/${id}/public`),
  toggleCollaborative: (id: string) => apiClient.put(`/playlists/${id}/collaborative`),
};

export const searchApi = {
  search: (query: string, types = 'song,album,artist,playlist', page = 0, signal?: AbortSignal) =>
    apiClient.get<SearchResponse>(
      `/search?query=${encodeURIComponent(query)}&types=${types}&page=${page}`,
      // 8s fail-fast budget; AbortSignal forwarded so debounced keystrokes
      // cancel superseded searches. Never deduped: each keystroke owns its
      // lifecycle (see query/useSearch).
      { ...(signal ? { signal } : {}), timeout: SEARCH_TIMEOUT_MS }
    ),
  suggestions: (query: string, limit = 10, signal?: AbortSignal) =>
    apiClient.get<string[]>(
      `/search/suggestions?query=${encodeURIComponent(query)}&limit=${limit}`,
      { ...(signal ? { signal } : {}), timeout: SEARCH_TIMEOUT_MS }
    ),
  trending: (signal?: AbortSignal) =>
    dedupedGet<string[]>('/search/trending', reqOpts(signal, READ_TIMEOUT_MS)),
};

export const homeApi = {
  getHome: (signal?: AbortSignal) =>
    dedupedGet<HomeResponse>('/home', reqOpts(signal, READ_TIMEOUT_MS)),
  /**
   * Staged tier fetch: `GET /home?tier=<tier>&fields=card`.
   *
   * - `critical`  → recently-played + trending (paints first, 5s budget:
   *   server 2000ms + network headroom).
   * - `secondary` → browse/catalog sections (8s budget: server 2500ms +
   *   network headroom).
   * - `heavy`     → made-for-you + daily-mixes (12s budget: server 4000ms +
   *   network headroom).
   *
   * `fields=card` projects song items to the slim card shape. Each call
   * carries its own AbortSignal (per-tier AbortController in useHomeTiers),
   * so a superseded tier never resolves over a newer one.
   */
  getHomeTier: (
    tier: HomeTierParam,
    signal?: AbortSignal,
    fields: string = 'card'
  ) =>
    dedupedGet<HomeResponse>(
      `/home?tier=${encodeURIComponent(tier)}&fields=${encodeURIComponent(fields)}`,
      reqOpts(signal, HOME_TIER_TIMEOUT_MS[tier])
    ),
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
  getLibrary: (signal?: AbortSignal) =>
    dedupedGet<LibraryResponse>('/library', reqOpts(signal, READ_TIMEOUT_MS)),
  getPlaylists: (signal?: AbortSignal) =>
    dedupedGet<PlaylistResponse[]>('/library/playlists', reqOpts(signal, READ_TIMEOUT_MS)),
  getAlbums: (signal?: AbortSignal) =>
    dedupedGet<AlbumResponse[]>('/library/albums', reqOpts(signal, READ_TIMEOUT_MS)),
  getArtists: (signal?: AbortSignal) =>
    dedupedGet<ArtistResponse[]>('/library/artists', reqOpts(signal, READ_TIMEOUT_MS)),
  getLikedSongs: (signal?: AbortSignal) =>
    dedupedGet<SongResponse[]>('/library/liked-songs', reqOpts(signal, READ_TIMEOUT_MS)),
  getRecent: (signal?: AbortSignal) =>
    dedupedGet<SongResponse[]>('/library/recent', reqOpts(signal, READ_TIMEOUT_MS)),
  getHistory: (page = 0, signal?: AbortSignal) =>
    dedupedGet<PagedResponse<SongResponse>>(`/library/history?page=${page}`, reqOpts(signal, READ_TIMEOUT_MS)),
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
  syncStorage: () => apiClient.post<AdminDashboardResponse>('/admin/storage/sync', undefined, {
    timeout: 30000, // server-side bucket walk can take a while
  }),
  clearAllStorage: () => apiClient.post<AdminDashboardResponse>('/admin/storage/clear-all', undefined, {
    timeout: 30000, // server-side bucket walk can take a while
  }),
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
