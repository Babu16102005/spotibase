import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import { youtubeApi } from '../../api/youtubeApi';
import type { YouTubeVideo } from '../../types/youtube';

declare const __dirname: string;

// Runtime contract for the global MiniYouTubeOverlay (Expo SDK 57):
// Two player homes — shared (expanded/watch/fullscreen, single persistent
// WebView) + dedicated mini (own WebView, own GestureDetector + Animated
// card). Handoff preserves seconds both ways; only entering mini reloads.
// Watch-page mode renders full page; other screens keep sheet/mini/fullscreen.
jest.mock('../youtube/YouTubePlayer', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  const Stub = React.forwardRef(({ video, testID, explicitHeight, startSeconds, active, ...rest }: any, ref: any) => {
    React.useEffect(() => {
      const g = globalThis as any;
      g.__miniYtPlayerMounts = (g.__miniYtPlayerMounts ?? 0) + 1;
      const key = testID ?? 'youtube-player';
      g.__miniYtPlayerMountsById = g.__miniYtPlayerMountsById ?? {};
      g.__miniYtPlayerMountsById[key] = (g.__miniYtPlayerMountsById[key] ?? 0) + 1;
    }, []);
    React.useImperativeHandle(
      ref,
      () => ({
        getCurrentTime: async () => {
          const g = globalThis as any;
          if (typeof g.__miniYtMockTime === 'number') return g.__miniYtMockTime;
          return 42;
        },
        seekTo: (s: number) => {
          (globalThis as any).__miniYtLastSeek = s;
          const g = globalThis as any;
          g.__miniYtSeekCalls = g.__miniYtSeekCalls ?? [];
          g.__miniYtSeekCalls.push(s);
        },
        pause: () => {
          (globalThis as any).__miniYtPauseCalls = ((globalThis as any).__miniYtPauseCalls ?? 0) + 1;
        },
        play: () => {
          (globalThis as any).__miniYtPlayCalls = ((globalThis as any).__miniYtPlayCalls ?? 0) + 1;
        },
      }),
      [],
    );
    try {
      (globalThis as any).__miniYtPlayerLastProps = {
        videoId: video?.videoId ?? null,
        explicitHeight,
        startSeconds,
        active,
        testID: testID ?? 'youtube-player',
      };
      const g2 = globalThis as any;
      g2.__miniYtPlayerPropsById = g2.__miniYtPlayerPropsById ?? {};
      g2.__miniYtPlayerPropsById[testID ?? 'youtube-player'] = {
        videoId: video?.videoId ?? null,
        explicitHeight,
        startSeconds,
        active,
      };
    } catch {}
    return video ? (
      <View testID={testID ?? 'youtube-player'}>
        <Text>{`stub-player:${video.title}`}</Text>
      </View>
    ) : null;
  });
  return { __esModule: true, default: Stub };
});

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('../../api/youtubeApi', () => ({
  youtubeApi: {
    trending: jest.fn(),
    search: jest.fn(),
    resolve: jest.fn(),
  },
  YOUTUBE_DEFAULT_REGION_CODE: 'IN',
  YOUTUBE_DEFAULT_RELEVANCE_LANGUAGE: 'ta',
  YOUTUBE_DEFAULT_HL: 'ta',
  YOUTUBE_DEFAULT_LOCALE: {
    regionCode: 'IN',
    relevanceLanguage: 'ta',
    hl: 'ta',
  },
}));

const MiniYouTubeOverlay =
  require('./MiniYouTubeOverlay').default as React.ComponentType<{ testID?: string }>;
const { miniControlsFit, miniVideoWidth, miniVideoHeight } =
  require('./MiniYouTubeOverlay') as typeof import('./MiniYouTubeOverlay');

const playerMounts = (): number => (globalThis as any).__miniYtPlayerMounts ?? 0;
const mountsById = (id: string): number =>
  (globalThis as any).__miniYtPlayerMountsById?.[id] ?? 0;
const propsById = (id: string): any =>
  (globalThis as any).__miniYtPlayerPropsById?.[id] ?? {};
const lastSeek = (): number | undefined => (globalThis as any).__miniYtLastSeek;
const pauseCalls = (): number => (globalThis as any).__miniYtPauseCalls ?? 0;

const searchMock = youtubeApi.search as unknown as jest.Mock;

const vid = (videoId = 'dQw4w9WgXcQ', title = 'Lo-Fi Beats'): YouTubeVideo => ({
  videoId,
  title,
  channelTitle: 'Chill Lab',
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
});

const resetGlobals = () => {
  (globalThis as any).__miniYtPlayerMounts = 0;
  (globalThis as any).__miniYtPlayerMountsById = {};
  (globalThis as any).__miniYtPlayerPropsById = {};
  (globalThis as any).__miniYtLastSeek = undefined;
  (globalThis as any).__miniYtSeekCalls = [];
  (globalThis as any).__miniYtPauseCalls = 0;
  (globalThis as any).__miniYtPlayCalls = 0;
  (globalThis as any).__miniYtMockTime = 42;
};

describe('MiniYouTubeOverlay global player', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobals();
    searchMock.mockResolvedValue({ data: { videos: [] } });
    act(() => {
      useYouTubePlayerStore.setState({
        currentVideo: null,
        isPlaying: false,
        mode: 'expanded',
        snapPosition: null,
        watchPageActive: false,
      });
    });
  });

  it('renders null without a video (nothing floats when idle)', () => {
    const { toJSON } = render(<MiniYouTubeOverlay />);
    expect(toJSON()).toBeNull();
  });

  it('expanded mode shows the single shared player + minimize (single-instance for expanded)', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId, queryAllByTestId, queryByTestId } = render(<MiniYouTubeOverlay />);
    expect(getByTestId('mini-youtube-overlay')).toBeTruthy();
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    expect(getByTestId('mini-youtube-minimize')).toBeTruthy();
    expect(queryByTestId('mini-youtube-close')).toBeNull();
    // Single shared instance in expanded (no dedicated mini mounted).
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
    expect(queryByTestId('mini-youtube-shared-hidden')).toBeNull();
    expect(playerMounts()).toBe(1);
  });

  it('minimize collapses to dedicated mini via handoff (play/fullscreen/close, no chevron)', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId, queryByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    // Handoff is async (getCurrentTime 800ms timeout -> 0); wait for mini.
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    expect(getByTestId('mini-youtube-play-pause')).toBeTruthy();
    expect(getByTestId('mini-youtube-fullscreen')).toBeTruthy();
    expect(getByTestId('mini-youtube-close')).toBeTruthy();
    expect(getByTestId('mini-youtube-close').props.accessibilityLabel).toBe('Close video player');
    expect(queryByTestId('mini-youtube-expand')).toBeNull();
    expect(getByTestId('mini-youtube-thumb')).toBeTruthy();
    expect(getByTestId('mini-youtube-tap-expand')).toBeTruthy();
    // Dedicated mini player visible (same visible testID), shared hidden paused.
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    expect(getByTestId('mini-youtube-shared-hidden')).toBeTruthy();
  });

  it('mini transport row fits the close button at 300px and 200px min widths', () => {
    for (const w of [300, 200]) {
      const fit = miniControlsFit(w);
      expect(fit.fits).toBe(true);
      expect(fit.rightW).toBeGreaterThanOrEqual(fit.btnRowW);
      expect(fit.rightW).toBeGreaterThanOrEqual(fit.titleRowW);
    }
    expect(miniControlsFit(300).btnRowW).toBe(3 * 34 + 2 * 2);
  });

  it('expanded/watch/fullscreen share one persistent instance (no remount among them)', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId, queryAllByTestId } = render(<MiniYouTubeOverlay />);
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    const mountsAfterExpanded = playerMounts();
    expect(mountsAfterExpanded).toBe(1);
    const nonceBefore = useYouTubePlayerStore.getState().replayNonce;

    // Expanded -> fullscreen (shared, no reload).
    act(() => {
      useYouTubePlayerStore.getState().enterFullscreen();
    });
    expect(getByTestId('mini-youtube-fullscreen-exit')).toBeTruthy();
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);

    act(() => {
      useYouTubePlayerStore.getState().exitFullscreen();
    });
    expect(useYouTubePlayerStore.getState().mode).toBe('expanded');
    expect(getByTestId('mini-youtube-player')).toBeTruthy();

    // Still one shared mount, same video, nonce untouched, still playing.
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
    expect(playerMounts()).toBe(mountsAfterExpanded);
    expect(useYouTubePlayerStore.getState().replayNonce).toBe(nonceBefore);
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('dQw4w9WgXcQ');
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('expand returns from dedicated mini via handoff seek (no shared reload)', async () => {
    (globalThis as any).__miniYtMockTime = 77;
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    // Enter mini via handoff button (captures 77s).
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    expect(getByTestId('mini-youtube-tap-expand')).toBeTruthy();
    // Dedicated carries startSeconds from handoff.
    expect(propsById('mini-youtube-player').startSeconds).toBe(77);

    // Expand via title tap -> seeks shared, unmounts mini.
    (globalThis as any).__miniYtMockTime = 99;
    (globalThis as any).__miniYtLastSeek = undefined;
    fireEvent.press(getByTestId('mini-youtube-tap-expand'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('expanded'));
    expect(getByTestId('mini-youtube-minimize')).toBeTruthy();
    // Shared sought to mini position (no reload — same WebView seeks).
    await waitFor(() => expect(lastSeek()).toBe(99));
  });

  it('close unloads the video from anywhere (mini button + expanded player close)', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    fireEvent.press(getByTestId('mini-youtube-close'));
    expect(useYouTubePlayerStore.getState().currentVideo).toBeNull();
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);

    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    expect(useYouTubePlayerStore.getState().currentVideo).not.toBeNull();
    act(() => {
      useYouTubePlayerStore.getState().closePlayer();
    });
    expect(useYouTubePlayerStore.getState().currentVideo).toBeNull();
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
  });

  it('mini play/pause toggles presentation without unloading', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    fireEvent.press(getByTestId('mini-youtube-play-pause'));
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
    expect(useYouTubePlayerStore.getState().currentVideo).not.toBeNull();
    fireEvent.press(getByTestId('mini-youtube-play-pause'));
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('switching videos keeps a single visible player (last-wins)', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid('AAAAAAAAAAA', 'First'));
    });
    const { queryAllByTestId, getByText } = render(<MiniYouTubeOverlay />);
    expect(getByText('stub-player:First')).toBeTruthy();
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid('BBBBBBBBBBB', 'Second'));
    });
    await waitFor(() => expect(getByText('stub-player:Second')).toBeTruthy());
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('BBBBBBBBBBB');
    // One visible player in expanded (shared).
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
    expect(queryAllByTestId('mini-youtube-shared-hidden')).toHaveLength(0);
  });

  it('snap position persists via setSnapPosition/setPosition without unloading', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    render(<MiniYouTubeOverlay />);
    act(() => {
      useYouTubePlayerStore.getState().setSnapPosition({ x: 12, y: 80 });
    });
    expect(useYouTubePlayerStore.getState().snapPosition).toEqual({ x: 12, y: 80 });
    expect(useYouTubePlayerStore.getState().currentVideo).not.toBeNull();
    act(() => {
      useYouTubePlayerStore.getState().setPosition({ x: 4, y: 4 });
    });
    expect(useYouTubePlayerStore.getState().snapPosition).toEqual({ x: 4, y: 4 });
  });

  it('fresh playVideo always opens expanded (predictable entry point)', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    render(<MiniYouTubeOverlay />);
    // Enter mini via direct store (bypasses handoff for setup).
    act(() => {
      useYouTubePlayerStore.getState().setMode('mini');
    });
    expect(useYouTubePlayerStore.getState().mode).toBe('mini');
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid('BBBBBBBBBBB', 'Next'));
    });
    expect(useYouTubePlayerStore.getState().mode).toBe('expanded');
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('non-watch expanded stays clean (no Up next, no search call)', async () => {
    searchMock.mockResolvedValue({ data: { videos: [vid('BBBBBBBBBBB', 'Related')] } });
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.setState({ watchPageActive: false });
    });
    const { getByTestId, queryByText, queryByTestId } = render(<MiniYouTubeOverlay />);
    expect(getByTestId('mini-youtube-overlay')).toBeTruthy();
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    expect(queryByText('Up next')).toBeNull();
    expect(queryByTestId('mini-youtube-suggestion-BBBBBBBBBBB')).toBeNull();
    await act(async () => {});
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe('MiniYouTubeOverlay watch page (full-screen layout)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobals();
    searchMock.mockResolvedValue({ data: { videos: [] } });
    act(() => {
      useYouTubePlayerStore.setState({
        currentVideo: null,
        isPlaying: false,
        mode: 'expanded',
        snapPosition: null,
        watchPageActive: false,
      });
    });
  });

  it('watch expanded pins video at top with Up next suggestions below (single shared player)', async () => {
    const other1 = vid('BBBBBBBBBBB', 'Related One');
    const other2 = vid('CCCCCCCCCCC', 'Related Two');
    searchMock.mockResolvedValue({ data: { videos: [vid(), other1, other2] } });
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.setState({ watchPageActive: true });
    });
    const { getByTestId, getByText, queryAllByTestId } = render(<MiniYouTubeOverlay />);
    expect(getByTestId('mini-youtube-overlay')).toBeTruthy();
    expect(getByTestId('mini-youtube-watch-video')).toBeTruthy();
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    expect(getByTestId('mini-youtube-play-pause')).toBeTruthy();
    expect(getByTestId('mini-youtube-minimize')).toBeTruthy();
    expect(getByTestId('mini-youtube-fullscreen')).toBeTruthy();
    expect(getByTestId('mini-youtube-now-playing-title')).toBeTruthy();
    expect(getByTestId('mini-youtube-drag-handle')).toBeTruthy();
    await waitFor(() => expect(getByText('Up next')).toBeTruthy());
    await waitFor(() => expect(getByTestId('mini-youtube-suggestion-BBBBBBBBBBB')).toBeTruthy());
    expect(getByTestId('mini-youtube-suggestion-CCCCCCCCCCC')).toBeTruthy();
    // Single shared instance on watch (no dedicated mini).
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
    expect(searchMock).toHaveBeenCalled();
  });

  it('tapping a suggestion last-wins into the shared player', async () => {
    const other = vid('BBBBBBBBBBB', 'Related One');
    searchMock.mockResolvedValue({ data: { videos: [other] } });
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.setState({ watchPageActive: true });
    });
    const { getByTestId, queryAllByTestId } = render(<MiniYouTubeOverlay />);
    await waitFor(() => expect(getByTestId('mini-youtube-suggestion-BBBBBBBBBBB')).toBeTruthy());
    fireEvent.press(getByTestId('mini-youtube-suggestion-BBBBBBBBBBB'));
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('BBBBBBBBBBB');
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
  });

  it('mini + fullscreen modes are unchanged on the watch page flag', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
      useYouTubePlayerStore.setState({ watchPageActive: true });
    });
    const mini = render(<MiniYouTubeOverlay />);
    expect(mini.getByTestId('mini-youtube-tap-expand')).toBeTruthy();
    expect(mini.getByTestId('mini-youtube-thumb')).toBeTruthy();
    expect(mini.getByTestId('mini-youtube-fullscreen')).toBeTruthy();
    expect(mini.getByTestId('mini-youtube-close')).toBeTruthy();
    expect(mini.queryByTestId('mini-youtube-expand')).toBeNull();
    expect(mini.queryByText('Up next')).toBeNull();
    mini.unmount();

    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().enterFullscreen();
      useYouTubePlayerStore.setState({ watchPageActive: true });
    });
    const fs = render(<MiniYouTubeOverlay />);
    expect(fs.getByTestId('mini-youtube-fullscreen-exit')).toBeTruthy();
    expect(fs.getByTestId('mini-youtube-progress')).toBeTruthy();
    expect(fs.queryByText('Up next')).toBeNull();
    fs.unmount();
  });
});

describe('MiniYouTubeOverlay mini hardening (black-card regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobals();
    searchMock.mockResolvedValue({ data: { videos: [] } });
    act(() => {
      useYouTubePlayerStore.setState({
        currentVideo: null,
        isPlaying: false,
        mode: 'expanded',
        snapPosition: null,
        watchPageActive: false,
      });
    });
  });

  it('mini video slot has explicit height > 0 at 300px and 200px widths', () => {
    for (const w of [300, 200]) {
      const vw = miniVideoWidth(w);
      const vh = miniVideoHeight(w);
      expect(vw).toBeGreaterThan(0);
      expect(vh).toBeGreaterThan(0);
      expect(vh).toBeCloseTo((vw * 9) / 16, 5);
    }
    expect(miniVideoHeight(300)).toBeCloseTo((miniVideoWidth(300) * 9) / 16, 5);
    expect(miniVideoHeight(200)).toBeCloseTo((miniVideoWidth(200) * 9) / 16, 5);
  });

  it('rendered dedicated mini slot carries explicit pixel height (never aspectRatio-only)', async () => {
    const { StyleSheet } = require('react-native');
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    const slot = getByTestId('mini-youtube-video-slot');
    const flat = StyleSheet.flatten(slot.props.style);
    expect(flat.width).toBeGreaterThan(0);
    expect(flat.height).toBeGreaterThan(0);
    expect(flat.height).toBeCloseTo((flat.width * 9) / 16, 0);
    // Dedicated mini player receives the same explicit height.
    expect(propsById('mini-youtube-player').explicitHeight).toBeGreaterThan(0);
    expect(propsById('mini-youtube-player').explicitHeight).toBeCloseTo(flat.height, 5);
  });

  it('poster Image renders under the WebView with the thumbnail uri', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    const poster: any = getByTestId('mini-youtube-poster');
    expect(poster).toBeTruthy();
    expect(poster.props.source?.uri).toBe(`https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg`);
    expect(poster.props.pointerEvents).toBe('none');
    const { StyleSheet } = require('react-native');
    const flat = StyleSheet.flatten(poster.props.style);
    expect(flat.position).toBe('absolute');
  });

  it('mini rows have explicit heights so buttons can never measure 0', () => {
    const src: string = require('fs').readFileSync(
      require('path').join(__dirname, 'MiniYouTubeOverlay.tsx'),
      'utf8',
    );
    expect(src).toContain('MINI_TITLE_ROW_MIN_H');
    expect(src).toContain('MINI_BTN_ROW_H');
    expect(src).toMatch(/miniTitleRow[\s\S]*?minHeight:\s*40/);
    expect(src).toMatch(/miniBtnRow[\s\S]*?height:\s*34/);
  });

  it('3 transport buttons present with correct testIDs (dedicated mini visible)', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId, queryAllByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    const playPause: any = getByTestId('mini-youtube-play-pause');
    const fullscreen: any = getByTestId('mini-youtube-fullscreen');
    const close: any = getByTestId('mini-youtube-close');
    expect(playPause.props.accessibilityLabel).toMatch(/Pause|Play/);
    expect(fullscreen.props.accessibilityLabel).toBe('Enter fullscreen');
    expect(close.props.accessibilityLabel).toBe('Close video player');
    for (const btn of [playPause, fullscreen, close]) {
      expect(btn.props.hitSlop).toEqual({ top: 10, bottom: 10, left: 10, right: 10 });
    }
    // Dedicated visible + hidden shared (two homes, one visible).
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    expect(getByTestId('mini-youtube-shared-hidden')).toBeTruthy();
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
  });
});

describe('MiniYouTubeOverlay dedicated mini + handoff (two homes)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetGlobals();
    searchMock.mockResolvedValue({ data: { videos: [] } });
    act(() => {
      useYouTubePlayerStore.setState({
        currentVideo: null,
        isPlaying: false,
        mode: 'expanded',
        snapPosition: null,
        watchPageActive: false,
      });
    });
  });

  it('mini uses a dedicated player home (own GestureDetector + card, yt-mini-player key)', () => {
    const src: string = require('fs').readFileSync(
      require('path').join(__dirname, 'MiniYouTubeOverlay.tsx'),
      'utf8',
    );
    // Dedicated mini: own GestureDetector with miniPan + mini card.
    expect(src).toContain('yt-mini-player');
    expect(src).toContain('miniPan');
    expect(src).toContain('miniLandscapeRow');
    // Shared persistent home for expanded/watch/fullscreen.
    expect(src).toContain('yt-single-player');
    // Two homes: shared + dedicated (never a single unified player).
    const usages = src.match(/<YouTubePlayer/g) || [];
    expect(usages.length).toBeGreaterThanOrEqual(2);
  });

  it('minimize handoff captures time, pauses shared, mounts dedicated with startSeconds (no store flip)', async () => {
    (globalThis as any).__miniYtMockTime = 42;
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    const pauseBefore = pauseCalls();
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    // Dedicated starts from captured second + autoplay.
    expect(propsById('mini-youtube-player').startSeconds).toBe(42);
    // Shared paused (no-double-audio) without flipping isPlaying.
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    expect(getByTestId('mini-youtube-shared-hidden')).toBeTruthy();
    expect(propsById('mini-youtube-player-hidden').active).toBe(false);
    expect(pauseCalls()).toBeGreaterThan(pauseBefore);
  });

  it('expand handoff seeks shared without reload (shared stays, mini unmounts)', async () => {
    (globalThis as any).__miniYtMockTime = 30;
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    const mountsAfterMini = playerMounts();

    (globalThis as any).__miniYtMockTime = 88;
    (globalThis as any).__miniYtLastSeek = undefined;
    fireEvent.press(getByTestId('mini-youtube-tap-expand'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('expanded'));
    // Seek without shared reload: no new shared mount, seek to 88.
    await waitFor(() => expect(lastSeek()).toBe(88));
    expect(playerMounts()).toBe(mountsAfterMini);
    expect(getByTestId('mini-youtube-minimize')).toBeTruthy();
  });

  it('no-double-audio: shared hidden paused while dedicated mini plays', async () => {
    (globalThis as any).__miniYtMockTime = 15;
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    // Hidden shared exists but gated paused; visible dedicated is active.
    expect(getByTestId('mini-youtube-shared-hidden')).toBeTruthy();
    expect(propsById('mini-youtube-player-hidden').active).toBe(false);
    expect(propsById('mini-youtube-player').active).not.toBe(false);
    expect(pauseCalls()).toBeGreaterThan(0);
  });

  it('fullscreen from mini seeks shared (mini->fullscreen handoff)', async () => {
    (globalThis as any).__miniYtMockTime = 20;
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    (globalThis as any).__miniYtMockTime = 55;
    (globalThis as any).__miniYtLastSeek = undefined;
    fireEvent.press(getByTestId('mini-youtube-fullscreen'));
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('fullscreen'));
    await waitFor(() => expect(lastSeek()).toBe(55));
    expect(getByTestId('mini-youtube-fullscreen-exit')).toBeTruthy();
  });
});
