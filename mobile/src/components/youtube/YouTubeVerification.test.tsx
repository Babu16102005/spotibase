import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import YouTubePlayer from './YouTubePlayer';
import MiniYouTubeOverlay from './MiniYouTubeOverlay';
import { youtubeApi } from '../../api/youtubeApi';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import type { YouTubeVideo } from '../../types/youtube';

/**
 * TestAgent verification suite for the task checklist:
 * - borderless video (no margins/borders/radius in overlay modes)
 * - fullscreen landscape: swipe up to enter, swipe down to exit, orientation lock
 * - mini landscape card: live video + controls + drag + progress line
 * - realtime instant playback: playVideo presents synchronously, same-id replay restarts
 *
 * Expo SDK v57 docs reviewed per mobile/AGENTS.md (ScreenOrientation
 * lockAsync(LANDSCAPE)/unlockAsync, gesture-handler native-thread pans,
 * WebView inline HTML). Pure jest + @testing-library/react-native.
 */

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

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(async () => {}),
  unlockAsync: jest.fn(async () => {}),
  OrientationLock: { LANDSCAPE: 'LANDSCAPE', DEFAULT: 'DEFAULT' },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

declare const __dirname: string;

const resolveMock = youtubeApi.resolve as unknown as jest.Mock;
const searchMock = youtubeApi.search as unknown as jest.Mock;
const ScreenOrientation = require('expo-screen-orientation');

const vid = (videoId = 'dQw4w9WgXcQ', title = 'Lo-Fi Beats'): YouTubeVideo => ({
  videoId,
  title,
  channelTitle: 'Chill Lab',
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
});

const backendResolve = (videoId: string) => ({
  data: {
    source: 'MOCK',
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0`,
    video: vid(videoId),
  },
});

const PLAYER_SRC = (): string =>
  fs.readFileSync(path.join(__dirname, 'YouTubePlayer.tsx'), 'utf8');
const OVERLAY_SRC = (): string =>
  fs.readFileSync(path.join(__dirname, 'MiniYouTubeOverlay.tsx'), 'utf8');

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  act(() => {
    useYouTubePlayerStore.setState({
      currentVideo: null,
      isPlaying: false,
      mode: 'expanded',
      returnMode: 'expanded',
      isFullscreen: false,
      snapPosition: null,
      replayNonce: 0,
    });
  });
  resolveMock.mockResolvedValue(backendResolve('dQw4w9WgXcQ'));
  searchMock.mockResolvedValue({ data: { videos: [] } });
});

describe('borderless video (overlay embeds bleed edge-to-edge)', () => {
  it('static: borderless strips outer margins/border/radius and frame radius', () => {
    const src = PLAYER_SRC();
    expect(src).toContain('borderless');
    expect(src).toMatch(/marginHorizontal: 0/);
    expect(src).toMatch(/borderWidth: 0/);
    expect(src).toMatch(/borderRadius: 0/);
    expect(src).toContain('containerBorderless');
  });

  it('runtime: borderless inline HTML uses radius 0, standalone keeps radius 12', async () => {
    const borderless = render(<YouTubePlayer video={vid()} borderless />);
    await waitFor(() =>
      expect(borderless.getByTestId('youtube-player-webview')).toBeTruthy(),
    );
    const borderlessHtml: string = (borderless.getByTestId(
      'youtube-player-webview',
    ) as any).props.source.html;
    expect(borderlessHtml).toContain('border-radius:0px');
    expect(borderlessHtml).not.toContain('border-radius:12px');
    borderless.unmount();

    resolveMock.mockResolvedValueOnce(backendResolve('dQw4w9WgXcQ'));
    const standalone = render(<YouTubePlayer video={vid()} />);
    await waitFor(() =>
      expect(standalone.getByTestId('youtube-player-webview')).toBeTruthy(),
    );
    const standaloneHtml: string = (standalone.getByTestId(
      'youtube-player-webview',
    ) as any).props.source.html;
    expect(standaloneHtml).toContain('border-radius:12px');
    standalone.unmount();
  });

  it('overlay embeds two homes: shared persistent (expanded/watch/fullscreen) + dedicated mini', () => {
    const src = OVERLAY_SRC();
    // Two-home invariant: shared <YouTubePlayer> (stable key yt-single-player)
    // for expanded/watch/fullscreen + dedicated mini (key yt-mini-player) with
    // own GestureDetector + card. Both borderless.
    const usages = src.match(/<YouTubePlayer/g) || [];
    expect(usages.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/<YouTubePlayer[\s\S]*?borderless/);
    expect(src).toContain('key="yt-single-player"');
    expect(src).toContain('key="yt-mini-player"');
  });
});

describe('fullscreen landscape: swipe up/down + orientation lock', () => {
  it('static: expanded swipe-up enters fullscreen; fullscreen swipe-down exits (vertical-only)', () => {
    const src = OVERLAY_SRC();
    // Handoff wrappers route through handleEnter/Exit (which fall through to
    // enter/exit when not crossing mini). Accept either form.
    expect(src).toMatch(/runOnJS\((handleEnterFullscreen|enterFullscreen)\)\(\)/);
    expect(src).toMatch(/runOnJS\((handleExitFullscreen|exitFullscreen)\)\(\)/);
    expect(src).toMatch(/translationY.*< -60/);
    expect(src).toMatch(/translationY > 90/);
    expect(src).toMatch(/failOffsetX/);
    expect(src).toMatch(/activeOffsetY/);
  });

  it('static: fullscreen locks to landscape and unlocks on exit', () => {
    const src = OVERLAY_SRC();
    expect(src).toMatch(/lockAsync\(.*LANDSCAPE/);
    expect(src).toMatch(/unlockAsync\(\)/);
  });

  it('store: enterFullscreen remembers returnMode; exit restores mini vs expanded', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
    });
    act(() => {
      useYouTubePlayerStore.getState().enterFullscreen();
    });
    expect(useYouTubePlayerStore.getState().mode).toBe('fullscreen');
    expect(useYouTubePlayerStore.getState().isFullscreen).toBe(true);
    expect(useYouTubePlayerStore.getState().returnMode).toBe('mini');
    act(() => {
      useYouTubePlayerStore.getState().exitFullscreen();
    });
    expect(useYouTubePlayerStore.getState().mode).toBe('mini');
    expect(useYouTubePlayerStore.getState().isFullscreen).toBe(false);

    act(() => {
      useYouTubePlayerStore.getState().setMode('expanded');
      useYouTubePlayerStore.getState().enterFullscreen();
    });
    expect(useYouTubePlayerStore.getState().returnMode).toBe('expanded');
    act(() => {
      useYouTubePlayerStore.getState().toggleFullscreen();
    });
    expect(useYouTubePlayerStore.getState().mode).toBe('expanded');
  });

  it('runtime: fullscreen shows exit + play/pause + progress + player', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().enterFullscreen();
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    expect(getByTestId('mini-youtube-fullscreen-exit')).toBeTruthy();
    expect(getByTestId('mini-youtube-play-pause')).toBeTruthy();
    expect(getByTestId('mini-youtube-progress')).toBeTruthy();
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    await waitFor(() =>
      expect(getByTestId('youtube-player-webview')).toBeTruthy(),
    );
    expect(ScreenOrientation.lockAsync).toHaveBeenCalled();
  });

  it('runtime: exit button leaves fullscreen back to the entry mode', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
      useYouTubePlayerStore.getState().enterFullscreen();
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-fullscreen-exit'));
    // Fullscreen->mini handoff is async (capture time before exit).
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('mini'));
    expect(useYouTubePlayerStore.getState().isFullscreen).toBe(false);
  });
});

describe('mini landscape card: live video + drag + progress', () => {
  it('static: mini is a landscape row (video left 16:9 + controls right)', () => {
    const src = OVERLAY_SRC();
    expect(src).toContain('miniLandscapeRow');
    expect(src).toContain('miniVideoLeft');
    expect(src).toContain('miniControlsRight');
    expect(src).toMatch(/flexDirection: 'row'/);
    expect(src).toMatch(/aspectRatio: 16 \/ 9/);
  });

  it('static: mini drag uses 8pt activation + edge snap with spring', () => {
    const src = OVERLAY_SRC();
    expect(src).toMatch(/minDistance\(8\)/);
    expect(src).toMatch(/snappedX/);
    expect(src).toMatch(/withSpring/);
    // Mini swipe-up routes through handoff (handleExpand) which seeks shared.
    expect(src).toMatch(/runOnJS\((handleExpand|setMode)\)/);
  });

  it('static: mini button row keeps close visible (3 compact buttons, no wrap/clip)', () => {
    const src = OVERLAY_SRC();
    // No dedicated expand chevron: it overflowed the ~112px right column and
    // clipped close under the card's overflow:hidden. Tap parity remains.
    expect(src).not.toContain('mini-youtube-expand');
    expect(src).toContain('mini-youtube-tap-expand');
    expect(src).toMatch(/flexWrap: 'nowrap'/);
    expect(src).toContain('miniControlsFit');
  });

  it('runtime: mini shows dedicated live player + thumb/title tap + transport + progress', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
    });
    const { getByTestId, queryByTestId, queryAllByTestId } = render(<MiniYouTubeOverlay />);
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    expect(getByTestId('mini-youtube-thumb')).toBeTruthy();
    expect(getByTestId('mini-youtube-tap-expand')).toBeTruthy();
    expect(getByTestId('mini-youtube-play-pause')).toBeTruthy();
    expect(queryByTestId('mini-youtube-expand')).toBeNull();
    expect(getByTestId('mini-youtube-fullscreen')).toBeTruthy();
    expect(getByTestId('mini-youtube-close')).toBeTruthy();
    expect(getByTestId('mini-youtube-progress')).toBeTruthy();
    // Dedicated mini + hidden shared (two homes, two WebViews in mini).
    await waitFor(() => expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1));
    expect(getByTestId('mini-youtube-shared-hidden')).toBeTruthy();
  });

  it('runtime: mini play/pause + expand + fullscreen entry all work without unloading', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-play-pause'));
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
    expect(useYouTubePlayerStore.getState().currentVideo).not.toBeNull();
    fireEvent.press(getByTestId('mini-youtube-play-pause'));
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    fireEvent.press(getByTestId('mini-youtube-fullscreen'));
    // Mini->fullscreen handoff is async (getCurrentTime + seek).
    await waitFor(() => expect(useYouTubePlayerStore.getState().mode).toBe('fullscreen'));
  });
});

describe('realtime instant playback (single player, no remount gap)', () => {
  it('playVideo presents synchronously (no await needed for instant UI)', () => {
    useYouTubePlayerStore.getState().playVideo(vid('BBBBBBBBBBB', 'Instant'));
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe(
      'BBBBBBBBBBB',
    );
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    expect(useYouTubePlayerStore.getState().mode).toBe('expanded');
  });

  it('same-video replay bumps replayNonce so the WebView restarts instantly', () => {
    useYouTubePlayerStore.getState().playVideo(vid());
    const before = useYouTubePlayerStore.getState().replayNonce;
    useYouTubePlayerStore.getState().playVideo(vid());
    expect(useYouTubePlayerStore.getState().replayNonce).toBeGreaterThan(
      before,
    );
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('last-wins: rapid taps keep one loaded video, still playing', () => {
    const s = useYouTubePlayerStore.getState();
    s.playVideo(vid('AAAAAAAAAAA', 'First'));
    useYouTubePlayerStore.getState().playVideo(vid('BBBBBBBBBBB', 'Second'));
    useYouTubePlayerStore.getState().playVideo(vid('CCCCCCCCCCC', 'Third'));
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe(
      'CCCCCCCCCCC',
    );
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });
});
