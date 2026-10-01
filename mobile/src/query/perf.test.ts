/**
 * Minimal perf-project tests (React Query + cursorId/size + parallel library).
 *
 * Covers:
 * - fetchSongsPage (used by useSongs) builds cursorId/size params + 404 fallback.
 * - fetchLibraryMerged gates the featured request (no waterfall when present).
 * - invalidate* helpers target the right query keys.
 * - authStore logout clears the React Query cache (authStore.test pattern).
 */
import { queryClient } from './queryClient';
import apiClient, { songApi, libraryApi, playlistApi, authApi } from '../api/client';
import { fetchSongsPage } from './useSongs';
import { fetchLibraryMerged } from './useLibrary';
import {
  invalidateSongs,
  invalidateLibrary,
  invalidateHome,
  invalidateSearch,
  clearAllQueries,
} from './invalidate';
import { useAuthStore } from '../store/authStore';
import { getStorage } from '../utils';
import { makeAuthResponse } from '../test/fixtures';

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  songApi: { getAll: jest.fn() },
  libraryApi: {
    getLibrary: jest.fn(),
    getPlaylists: jest.fn(),
    getAlbums: jest.fn(),
    getArtists: jest.fn(),
    getLikedSongs: jest.fn(),
  },
  playlistApi: { getFeatured: jest.fn() },
  authApi: {
    login: jest.fn(),
    register: jest.fn(),
    socialAuth: jest.fn(),
    refresh: jest.fn(),
  },
  homeApi: {
    getHome: jest.fn().mockResolvedValue({ data: { greeting: 'Hi', sections: [] } }),
  },
  READ_TIMEOUT_MS: 10_000,
  SEARCH_TIMEOUT_MS: 8_000,
  clearRequestDedup: jest.fn(),
  storage: { getString: jest.fn(), set: jest.fn(), clearAll: jest.fn() },
}));

jest.mock('./queryClient', () => {
  const mock = { invalidateQueries: jest.fn(), clear: jest.fn() };
  return { __esModule: true, queryClient: mock, default: mock };
});

jest.mock('../cache/homeFeedCache', () => ({ prefetchHomeFeed: jest.fn() }));
jest.mock('../cache/songListCache', () => ({ prefetchSongs: jest.fn(), SONGS_PAGE_SIZE: 20 }));

const apiGet = apiClient.get as jest.Mock;
const songGetAll = songApi.getAll as jest.Mock;
const libGet = libraryApi.getLibrary as jest.Mock;
const featGet = playlistApi.getFeatured as jest.Mock;
const invalidateSpy = queryClient.invalidateQueries as jest.Mock;
const clearSpy = queryClient.clear as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchSongsPage (useSongs fetcher)', () => {
  it('requests size only on the first page (no cursorId)', async () => {
    apiGet.mockResolvedValue({
      data: { content: [{ id: 's1' }], page: 0, last: false, totalElements: 2 },
    });

    const page = await fetchSongsPage({ cursor: null, page: 0, cursorUnsupported: false }, 20);

    expect(apiGet).toHaveBeenCalledWith('/songs/cursor?size=20', expect.anything());
    expect(page.nextCursor).toBe('1');
    expect(page.hasMore).toBe(true);
  });

  it('appends cursorId for subsequent pages', async () => {
    apiGet.mockResolvedValue({ data: { content: [], nextCursor: null, hasMore: false } });

    await fetchSongsPage({ cursor: 'abc123', page: 1, cursorUnsupported: false }, 25);

    const url = apiGet.mock.calls[0][0] as string;
    expect(url).toContain('size=25');
    expect(url).toContain('cursorId=abc123');
  });

  it('falls back to paged getAll on 404 and flags cursorUnsupported', async () => {
    apiGet.mockRejectedValue({ response: { status: 404 } });
    songGetAll.mockResolvedValue({
      data: { content: [{ id: 's9' }], page: 0, last: false, totalElements: 1 },
    });

    const page = await fetchSongsPage({ cursor: null, page: 0, cursorUnsupported: false }, 20);

    expect(songGetAll).toHaveBeenCalledWith(0, 20, undefined);
    expect(page.cursorUnsupported).toBe(true);
    expect(page.content).toHaveLength(1);
  });

  it('rethrows non-404/405 errors instead of falling back', async () => {
    const boom = { response: { status: 500 } };
    apiGet.mockRejectedValue(boom);

    await expect(
      fetchSongsPage({ cursor: null, page: 0, cursorUnsupported: false }, 20)
    ).rejects.toBe(boom);
    expect(songGetAll).not.toHaveBeenCalled();
  });
});

describe('fetchLibraryMerged (featured gating)', () => {
  const baseLib = {
    playlists: [],
    albums: [],
    artists: [],
    likedSongs: [],
  };

  it('skips the featured request when the payload already has featuredPlaylists', async () => {
    libGet.mockResolvedValue({ data: { ...baseLib, featuredPlaylists: [{ id: 'f1' }] } });

    const lib = await fetchLibraryMerged();

    expect(featGet).not.toHaveBeenCalled();
    expect(lib.featuredPlaylists).toHaveLength(1);
  });

  it('fetches featured only when the payload lacks it', async () => {
    libGet.mockResolvedValue({ data: { ...baseLib } });
    featGet.mockResolvedValue({ data: [{ id: 'f1' }, { id: 'f2' }] });

    const lib = await fetchLibraryMerged();

    expect(featGet).toHaveBeenCalled();
    expect(lib.featuredPlaylists).toHaveLength(2);
  });

  it('degrades to an empty featured list when the featured request fails', async () => {
    libGet.mockResolvedValue({ data: { ...baseLib } });
    featGet.mockRejectedValue(new Error('featured down'));

    const lib = await fetchLibraryMerged();

    expect(lib.featuredPlaylists).toEqual([]);
  });
});

describe('invalidate helpers', () => {
  it('target the right query keys', () => {
    invalidateSongs();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['songs'] });

    invalidateLibrary();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['library'] });

    invalidateHome();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['home'] });

    invalidateSearch();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['search'] });
  });

  it('clearAllQueries tears down the whole cache', () => {
    clearAllQueries();
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe('authStore logout (query cache clear)', () => {
  const storage = getStorage('spotibase-auth');

  beforeEach(() => {
    storage.clearAll();
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null });
  });

  it('clears the query client on logout', async () => {
    (authApi.login as jest.Mock).mockResolvedValue({ data: makeAuthResponse() });
    await useAuthStore.getState().login({ email: 'a@b.com', password: 'x' });
    clearSpy.mockClear();

    useAuthStore.getState().logout();

    expect(clearSpy).toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
