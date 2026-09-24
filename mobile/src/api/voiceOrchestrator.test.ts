/**
 * Realtime voice search orchestrator — TestAgent suite.
 *
 * Covers the mobile contract for Expo SDK v57 (docs reviewed per
 * mobile/AGENTS.md; pure jest + @testing-library/react-native, no native
 * API change):
 * - debounce (250ms): rapid interim pushes collapse to one fetch (last wins)
 * - cancel/reset: pending debounce + in-flight abort, stale dropped
 * - stale drop: superseded requestId never commits (single live list)
 * - 404/405 probe: falls back to GET /search, then skips voice-partial
 * - extractPartialSongs: multi-shape normalize, dedupe, top-5 cap
 * - read-only: partial path never calls aiApi.text/voice (final
 *   QUEUE_SYNC single play stays on the stop path only)
 */
import { renderHook, act } from '@testing-library/react-native';
import {
  useVoiceOrchestrator,
  extractPartialSongs,
  __resetVoicePartialProbe,
  VOICE_PARTIAL_MAX_SONGS,
} from './voiceOrchestrator';
import { aiApi, searchApi } from './client';

jest.mock('./client', () => ({
  aiApi: { voicePartial: jest.fn(), text: jest.fn(), voice: jest.fn() },
  searchApi: { search: jest.fn() },
}));

const mockVoicePartial = aiApi.voicePartial as jest.Mock;
const mockSearch = searchApi.search as jest.Mock;
const mockAiText = (aiApi as any).text as jest.Mock;
const mockAiVoice = (aiApi as any).voice as jest.Mock;

const song = (id: string, title = `Title ${id}`) => ({
  id,
  title,
  artistName: 'Anirudh',
});

const flush = async () => {
  await act(async () => {});
};

describe('useVoiceOrchestrator realtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    __resetVoicePartialProbe();
    mockVoicePartial.mockResolvedValue({ data: { songs: [song('s1')] } });
    mockSearch.mockResolvedValue({ data: { songs: [song('s9')] } });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces rapid interim pushes into a single fetch (last query wins)', async () => {
    const { result } = renderHook(() => useVoiceOrchestrator({ debounceMs: 250 }));

    act(() => {
      result.current.pushInterim('play a');
      result.current.pushInterim('play an');
      result.current.pushInterim('play ani');
    });
    expect(mockVoicePartial).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    await flush();

    expect(mockVoicePartial).toHaveBeenCalledTimes(1);
    expect(mockVoicePartial).toHaveBeenCalledWith('play ani', undefined, expect.anything());
    expect(result.current.partialQuery).toBe('play ani');
  });

  it('ignores queries shorter than minChars (no fetch, clears live UI)', async () => {
    const { result } = renderHook(() => useVoiceOrchestrator({ debounceMs: 250, minChars: 2 }));

    act(() => {
      result.current.pushInterim('a');
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await flush();

    expect(mockVoicePartial).not.toHaveBeenCalled();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(result.current.partialSongs).toEqual([]);
    expect(result.current.partialLoading).toBe(false);
  });

  it('cancel() drops the pending debounce and freezes (no fetch)', async () => {
    const { result } = renderHook(() => useVoiceOrchestrator({ debounceMs: 250 }));

    act(() => {
      result.current.pushInterim('play ani');
    });
    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await flush();

    expect(mockVoicePartial).not.toHaveBeenCalled();
    expect(result.current.partialLoading).toBe(false);
  });

  it('drops stale responses: superseded request never commits', async () => {
    // First fetch hangs; second resolves fast. Only the second may commit.
    let resolveFirst!: (v: unknown) => void;
    const firstGate = new Promise((res) => {
      resolveFirst = res;
    });
    mockVoicePartial
      .mockImplementationOnce(() => firstGate)
      .mockImplementationOnce(async () => ({ data: { songs: [song('s-second')] } }));

    const { result } = renderHook(() => useVoiceOrchestrator({ debounceMs: 50 }));

    act(() => {
      result.current.pushInterim('play anir');
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    // Second interim supersedes before the first resolves.
    act(() => {
      result.current.pushInterim('play aniru');
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    await flush();
    // Late first response must be dropped as stale.
    await act(async () => {
      resolveFirst({ data: { songs: [song('s-stale')] } });
    });
    await flush();

    expect(result.current.partialSongs.map((s) => s.id)).toEqual(['s-second']);
    expect(result.current.partialSongs.map((s) => s.id)).not.toContain('s-stale');
  });

  it('falls back to /search on 404 and skips the probe next time', async () => {
    const notFound: any = new Error('not found');
    notFound.response = { status: 404 };
    mockVoicePartial.mockRejectedValueOnce(notFound);
    mockSearch.mockResolvedValueOnce({ data: { songs: [song('s-fb')] } });

    const { result } = renderHook(() => useVoiceOrchestrator({ debounceMs: 50 }));

    act(() => {
      result.current.pushInterim('play ani');
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    await flush();

    expect(mockSearch).toHaveBeenCalledWith('play ani', 'song', 0, expect.anything());
    expect(result.current.partialSongs.map((s) => s.id)).toEqual(['s-fb']);

    // Second query must skip voice-partial entirely (probe cached false).
    mockVoicePartial.mockClear();
    mockSearch.mockClear();
    mockSearch.mockResolvedValueOnce({ data: { songs: [song('s-fb2')] } });

    act(() => {
      result.current.pushInterim('play anir');
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    await flush();

    expect(mockVoicePartial).not.toHaveBeenCalled();
    expect(mockSearch).toHaveBeenCalledTimes(1);
  });

  it('retry() re-runs the last query immediately (error-row path)', async () => {
    const { result } = renderHook(() => useVoiceOrchestrator({ debounceMs: 250 }));

    act(() => {
      result.current.pushInterim('play ani');
    });
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    await flush();
    expect(mockVoicePartial).toHaveBeenCalledTimes(1);

    mockVoicePartial.mockClear();
    act(() => {
      result.current.retry();
    });
    await flush();
    expect(mockVoicePartial).toHaveBeenCalledTimes(1);
    expect(mockVoicePartial).toHaveBeenCalledWith('play ani', undefined, expect.anything());
  });

  it('partial path is read-only: never calls aiApi.text/voice (final QUEUE_SYNC stays single)', async () => {
    const { result } = renderHook(() => useVoiceOrchestrator({ debounceMs: 50 }));

    act(() => {
      result.current.pushInterim('play ani');
      result.current.pushInterim('play anirudh hits');
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    await flush();

    expect(mockAiText).not.toHaveBeenCalled();
    expect(mockAiVoice).not.toHaveBeenCalled();
    // Live chips are top-5 capped (single play happens only on stop path).
    expect(result.current.partialSongs.length).toBeLessThanOrEqual(VOICE_PARTIAL_MAX_SONGS);
  });
});

describe('extractPartialSongs', () => {
  it('normalizes songs / data.songs / partialSongs / results shapes', () => {
    expect(extractPartialSongs({ songs: [song('a')] }).map((s) => s.id)).toEqual(['a']);
    expect(extractPartialSongs({ data: { songs: [song('b')] } }).map((s) => s.id)).toEqual(['b']);
    expect(extractPartialSongs({ partialSongs: [song('c')] }).map((s) => s.id)).toEqual(['c']);
    expect(
      extractPartialSongs({ results: [{ songs: [song('d')] }] }).map((s) => s.id),
    ).toEqual(['d']);
  });

  it('dedupes by id and caps at top-5', () => {
    const six = [song('1'), song('2'), song('3'), song('4'), song('5'), song('6')];
    const out = extractPartialSongs({ songs: [...six, song('1')] });
    expect(out).toHaveLength(5);
    expect(out.map((s) => s.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('ignores non-song-like entries and null/primitive inputs', () => {
    expect(extractPartialSongs({ songs: [{ foo: 1 }, null, 'x'] as any })).toEqual([]);
    expect(extractPartialSongs(null)).toEqual([]);
    expect(extractPartialSongs(undefined)).toEqual([]);
    expect(extractPartialSongs('string' as any)).toEqual([]);
  });
});
