import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useHomeTiers } from './useHomeTiers';
import { homeApi } from '../api/client';
import {
  isHomeTierFresh,
  readHomeFeed,
  readHomeTier,
  writeHomeTier,
} from '../cache/homeFeedCache';
import { useAuthStore } from '../store';

/**
 * Tiered home feed (Expo SDK 57 / jest-expo, no network).
 *
 * Covers the concurrent contract in useHomeTiers:
 *  1. Concurrent critical + secondary + heavy fetch via Promise.allSettled
 *     with an ordered merge (recently-played before trending before heavy)
 *     even when heavy settles first — staggered mocks prove order comes from
 *     the merge, not from network timing.
 *  2. Blur/unmount aborts in-flight tier requests and a superseded tier
 *     never commits over the newer run.
 *  3. Focus/mount refetch hits only stale tiers (fresh buckets never refetch).
 *  4. Single automatic retry: a failed tier with empty sections retries once
 *     after ~500ms (same session); 401/403 never retries (logout path).
 */

jest.mock('../api/client', () => ({
  homeApi: {
    getHome: jest.fn(),
    getHomeTier: jest.fn(),
  },
}));

jest.mock('../cache/homeFeedCache', () => {
  const actual = jest.requireActual('../cache/homeFeedCache');
  return {
    ...actual,
    readHomeTier: jest.fn(),
    readHomeFeed: jest.fn(),
    isHomeTierFresh: jest.fn(),
    writeHomeTier: jest.fn(),
  };
});

const mockedGetHomeTier = homeApi.getHomeTier as jest.Mock;
const mockedReadHomeTier = readHomeTier as jest.Mock;
const mockedReadHomeFeed = readHomeFeed as jest.Mock;
const mockedIsFresh = isHomeTierFresh as jest.Mock;
const mockedWriteTier = writeHomeTier as jest.Mock;

const sec = (id: string, title: string) => ({
  id,
  title,
  type: 'SONG',
  subtitle: '',
  items: [{ id: `${id}-item-1` }],
});

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

describe('useHomeTiers staged tiers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedReadHomeTier.mockReturnValue(null);
    mockedReadHomeFeed.mockReturnValue(null);
    mockedIsFresh.mockReturnValue(false);
    useAuthStore.setState({ isAuthenticated: true, isLoading: false } as any);
  });

  it('fetches critical + secondary + heavy concurrently and merges recent before trending before heavy', async () => {
    const recent = sec('recently-played', 'Recently Played');
    const trending = sec('trending', 'Trending Now');
    const catalog = sec('new-releases', 'New Releases');
    const madeForYou = sec('made-for-you', 'Made For You');
    const dailyMix = sec('daily-mixes', 'Daily Mixes');

    const startOrder: string[] = [];
    mockedGetHomeTier.mockImplementation(async (tier: string) => {
      // Staggered delays: heavy settles first, critical last — the
      // concurrent schedule + ordered merge must still paint critical first.
      // All three start together (launch order = map order), so the second
      // call starts before the first resolves.
      startOrder.push(tier);
      if (tier === 'critical') {
        await delay(30);
        // Reversed on purpose: intra-critical pinning must still put
        // recently-played before trending.
        return { data: { greeting: 'Good Morning', sections: [trending, recent] } };
      }
      if (tier === 'secondary') {
        await delay(10);
        return { data: { greeting: 'Good Morning', sections: [catalog] } };
      }
      return {
        data: { greeting: 'Good Morning', sections: [madeForYou, dailyMix] },
      };
    });

    const { result } = renderHook(() => useHomeTiers());

    await act(async () => {
      await result.current.refetchStale();
    });

    // Concurrent launch: all three requested together in map order
    // (critical, secondary, heavy), even though heavy settles first.
    expect(mockedGetHomeTier.mock.calls.map((c) => c[0])).toEqual([
      'critical',
      'secondary',
      'heavy',
    ]);
    expect(startOrder).toEqual(['critical', 'secondary', 'heavy']);
    // Ordered merge regardless of resolve timing or server order.
    expect(result.current.sections.map((s) => s.id)).toEqual([
      'recently-played',
      'trending',
      'new-releases',
      'made-for-you',
      'daily-mixes',
    ]);
    expect(result.current.statusPerTier).toEqual({
      critical: 'success',
      secondary: 'success',
      heavy: 'success',
    });
  });

  it('aborts in-flight tiers on blur and drops the superseded result', async () => {
    const recent = sec('recently-played', 'Recently Played');
    const catalog = sec('new-releases', 'New Releases');
    const madeForYou = sec('made-for-you', 'Made For You');
    let resolveCritical!: (value: any) => void;
    let resolveSecondary!: (value: any) => void;
    let resolveHeavy!: (value: any) => void;
    const criticalGate = new Promise<any>((resolve) => {
      resolveCritical = resolve;
    });
    const secondaryGate = new Promise<any>((resolve) => {
      resolveSecondary = resolve;
    });
    const heavyGate = new Promise<any>((resolve) => {
      resolveHeavy = resolve;
    });
    const signals: Record<string, AbortSignal> = {};
    mockedGetHomeTier.mockImplementation((tier: string, signal: AbortSignal) => {
      signals[tier] = signal;
      if (tier === 'critical') return criticalGate;
      if (tier === 'secondary') return secondaryGate;
      return heavyGate;
    });

    const { result } = renderHook(() => useHomeTiers());

    let run!: Promise<void>;
    act(() => {
      run = result.current.refetchStale();
    });
    // Concurrent: all three start together before any settles.
    await waitFor(() => expect(mockedGetHomeTier).toHaveBeenCalledTimes(3));
    expect(mockedGetHomeTier.mock.calls.map((c) => c[0]).sort()).toEqual([
      'critical',
      'heavy',
      'secondary',
    ]);

    // Blur cleanup path (HomeScreen returns abortAll from useFocusEffect).
    act(() => {
      result.current.abortAll();
    });
    expect(signals.critical.aborted).toBe(true);
    expect(signals.secondary.aborted).toBe(true);
    expect(signals.heavy.aborted).toBe(true);

    // Superseded tiers resolve late — none must ever paint.
    await act(async () => {
      resolveCritical({ data: { greeting: 'Stale', sections: [recent] } });
      resolveSecondary({ data: { greeting: 'Stale', sections: [catalog] } });
      resolveHeavy({ data: { greeting: 'Stale', sections: [madeForYou] } });
      await run;
    });

    expect(result.current.sections).toHaveLength(0);
    expect(result.current.statusPerTier.critical).not.toBe('pending');
    expect(result.current.statusPerTier.secondary).not.toBe('pending');
    expect(result.current.statusPerTier.heavy).not.toBe('pending');
    expect(result.current.isPending).toBe(false);
    expect(mockedWriteTier).not.toHaveBeenCalled();
  });

  it('refetches only stale tiers and keeps fresh buckets untouched', async () => {
    const recent = sec('recently-played', 'Recently Played');
    const catalog = sec('new-releases', 'New Releases');
    const madeForYou = sec('made-for-you', 'Made For You');

    mockedReadHomeTier.mockImplementation((tier: string) =>
      tier === 'critical'
        ? { greeting: 'Good Morning', sections: [recent] }
        : null
    );
    // Critical is fresh (paint sync, skip network); the rest are stale.
    mockedIsFresh.mockImplementation((tier: string) => tier === 'critical');
    mockedGetHomeTier.mockImplementation(async (tier: string) => {
      if (tier === 'critical') {
        throw new Error('fresh critical tier must not refetch');
      }
      await delay(1);
      return {
        data: {
          greeting: 'Good Morning',
          sections: [tier === 'secondary' ? catalog : madeForYou],
        },
      };
    });

    const { result } = renderHook(() => useHomeTiers());

    // Synchronous stale-while-revalidate paint from the fresh bucket.
    expect(result.current.sections.map((s) => s.id)).toEqual([
      'recently-played',
    ]);

    await act(async () => {
      await result.current.refetchStale();
    });

    const calledTiers = mockedGetHomeTier.mock.calls.map((c) => c[0]);
    expect(calledTiers).not.toContain('critical');
    expect(calledTiers).toEqual(
      expect.arrayContaining(['secondary', 'heavy'])
    );
    // Fresh critical data is preserved; stale tiers merge after it.
    expect(result.current.sections.map((s) => s.id)).toEqual([
      'recently-played',
      'new-releases',
      'made-for-you',
    ]);
    expect(mockedWriteTier).not.toHaveBeenCalledWith(
      'critical',
      expect.anything()
    );
  });

  it('retries once when a tier fails with empty sections, then paints', async () => {
    const recent = sec('recently-played', 'Recently Played');
    let criticalCalls = 0;
    mockedGetHomeTier.mockImplementation(async (tier: string) => {
      if (tier === 'critical') {
        criticalCalls += 1;
        if (criticalCalls === 1) {
          const err: any = new Error('flaky timeout');
          err.code = 'ECONNABORTED';
          throw err;
        }
        return { data: { greeting: 'Good Morning', sections: [recent] } };
      }
      return { data: { greeting: 'Good Morning', sections: [] } };
    });

    const { result } = renderHook(() => useHomeTiers());

    await act(async () => {
      // Includes the ~500ms retry delay plus the retry fetch.
      await result.current.refetchStale();
    });

    expect(criticalCalls).toBe(2);
    expect(result.current.sections.map((s) => s.id)).toEqual([
      'recently-played',
    ]);
    expect(result.current.statusPerTier.critical).toBe('success');
  });

  it('does not retry on 401/403 and logs out instead', async () => {
    const logoutSpy = jest.spyOn(useAuthStore.getState(), 'logout');
    let criticalCalls = 0;
    mockedGetHomeTier.mockImplementation(async (tier: string) => {
      if (tier === 'critical') {
        criticalCalls += 1;
        const err: any = new Error('unauthorized');
        err.response = { status: 401 };
        throw err;
      }
      return { data: { greeting: '', sections: [] } };
    });

    const { result } = renderHook(() => useHomeTiers());

    await act(async () => {
      await result.current.refetchStale();
    });

    // Auth path never retries: exactly one attempt, then logout.
    expect(criticalCalls).toBe(1);
    expect(logoutSpy).toHaveBeenCalled();
    expect(result.current.statusPerTier.critical).toBe('error');
    expect(result.current.sections).toHaveLength(0);
    logoutSpy.mockRestore();
    // Restore auth for subsequent tests.
    useAuthStore.setState({ isAuthenticated: true } as any);
  });

  it('does not retry when the tier already has data (keeps cached rows)', async () => {
    const recent = sec('recently-played', 'Recently Played');
    mockedReadHomeTier.mockImplementation((tier: string) =>
      tier === 'critical'
        ? { greeting: 'Good Morning', sections: [recent] }
        : null
    );
    // Stale so it refetches, but sections are non-empty.
    mockedIsFresh.mockReturnValue(false);
    let criticalCalls = 0;
    mockedGetHomeTier.mockImplementation(async (tier: string) => {
      if (tier === 'critical') {
        criticalCalls += 1;
        const err: any = new Error('server error');
        err.response = { status: 500 };
        throw err;
      }
      return { data: { greeting: '', sections: [] } };
    });

    const { result } = renderHook(() => useHomeTiers());

    await act(async () => {
      await result.current.refetchStale();
    });

    expect(criticalCalls).toBe(1);
    // Cached rows preserved, never overwritten by the failure.
    expect(result.current.sections.map((s) => s.id)).toEqual([
      'recently-played',
    ]);
    expect(result.current.statusPerTier.critical).toBe('error');
  });
});
