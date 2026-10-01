import React from 'react';
import { AppState, Platform } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import TrackPlayer from 'react-native-track-player';
import YouTubePlayer, {
  MUTE_IFRAMES_JS,
  UNMUTE_IFRAMES_JS,
  buildYouTubeEmbedUrl,
  sanitizeEmbedUrl,
  setVolumeIframesJs,
} from './YouTubePlayer';
import MiniYouTubeOverlay from './MiniYouTubeOverlay';
import { youtubeApi } from '../../api/youtubeApi';
import { usePlayerStore } from '../../store/playerStore';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import type { YouTubeVideo } from '../../types/youtube';

/**
 * YouTube watch contract (Expo SDK 57, versioned docs
 * https://docs.expo.dev/versions/v57.0.0/ read before writing).
 *
 * Pins the six watch behaviors for the single-WebView watch experience:
 *  WATCH-1 unmuted default (no `mute` param is ever emitted)
 *  WATCH-2 tap-to-unmute fallback (unMute/setVolume bridge + overlay)
 *  WATCH-3 watch layout: sticky video-top / Up-next-below, single WebView
 *  WATCH-4 swipe down to mini / swipe-up + tap parity to expand
 *  WATCH-5 background pause via AppState (pause + compliance toast)
 *  WATCH-6 no double-play (mutual exclusion + single player)
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

jest.mock('@react-navigation/native', () => ({
  // Watch-screen focus flag: run the focus callback once on mount (with
  // cleanup on unmount) so watchPageActive mirrors focus in tests.
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(callback, []);
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

declare const __dirname: string;

const resolveMock = youtubeApi.resolve as unknown as jest.Mock;
const searchMock = youtubeApi.search as unknown as jest.Mock;

const vid = (videoId = 'dQw4w9WgXcQ', title = 'Lo-Fi Beats'): YouTubeVideo => ({
  videoId,
  title,
  channelTitle: 'Chill Lab',
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
});

const backendResolve = (videoId: string, embedExtra = 'enablejsapi=1&rel=0') => ({
  data: {
    source: 'MOCK',
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube.com/embed/${videoId}?${embedExtra}`,
    video: vid(videoId),
  },
});

const PLAYER_SRC = (): string =>
  fs.readFileSync(path.join(__dirname, 'YouTubePlayer.tsx'), 'utf8');
const OVERLAY_SRC = (): string =>
  fs.readFileSync(path.join(__dirname, 'MiniYouTubeOverlay.tsx'), 'utf8');

type WebviewNode = {
  props: { source: { html: string }; onMessage: (e: unknown) => void; onError: () => void };
};

const webviewOf = (getByTestId: (id: string) => unknown): WebviewNode =>
  getByTestId('youtube-player-webview') as unknown as WebviewNode;

/** Extract the iframe src from the native inline-HTML shell. */
const iframeSrcOf = (html: string): string => {
  const m = html.match(/src="([^"]+)"/);
  if (!m) throw new Error('inline HTML has no iframe src');
  // Inline shell HTML-escapes &<>"'` (spec-correct) — decode back for URL asserts.
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#96;/g, '`');
};

const resetStores = () => {
  act(() => {
    useYouTubePlayerStore.setState({
      currentVideo: null,
      isPlaying: false,
      mode: 'expanded',
      snapPosition: null,
      watchPageActive: false,
    });
  });
  usePlayerStore.setState({ playbackState: 'idle' });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  resetStores();
  resolveMock.mockResolvedValue(backendResolve('dQw4w9WgXcQ'));
  searchMock.mockResolvedValue({ data: { videos: [] } });
});

describe('WATCH-1 unmuted default (no mute param is ever emitted)', () => {
  it('default build carries autoplay=0 with NO mute param', () => {
    const parsed = new URL(buildYouTubeEmbedUrl('dQw4w9WgXcQ'));
    expect(parsed.hostname).toBe('www.youtube.com');
    expect(parsed.pathname).toBe('/embed/dQw4w9WgXcQ');
    expect(parsed.searchParams.get('autoplay')).toBe('0');
    expect(parsed.searchParams.get('mute')).toBeNull();
    expect(parsed.searchParams.get('enablejsapi')).toBe('1');
    expect(parsed.searchParams.get('origin')).toBe('https://app.spotibase');
    expect(parsed.searchParams.get('playsinline')).toBe('1');
    expect(parsed.searchParams.get('rel')).toBe('0');
    expect(buildYouTubeEmbedUrl('dQw4w9WgXcQ')).not.toContain('nocookie');
  });

  it('explicit autoplay=true still emits NO mute param', () => {
    const parsed = new URL(buildYouTubeEmbedUrl('dQw4w9WgXcQ', true));
    expect(parsed.searchParams.get('autoplay')).toBe('1');
    expect(parsed.searchParams.get('mute')).toBeNull();
  });

  it('sanitize strips a backend mute=1 in every autoplay mode', () => {
    for (const autoplay of [true, false]) {
      const parsed = new URL(
        sanitizeEmbedUrl(
          'https://www.youtube.com/embed/dQw4w9WgXcQ?mute=1&autoplay=1&rel=1',
          'dQw4w9WgXcQ',
          autoplay,
        ),
      );
      expect(parsed.hostname).toBe('www.youtube.com');
      expect(parsed.searchParams.get('autoplay')).toBe(autoplay ? '1' : '0');
      expect(parsed.searchParams.get('mute')).toBeNull();
      expect(parsed.searchParams.get('enablejsapi')).toBe('1');
      expect(parsed.searchParams.get('origin')).toBe('https://app.spotibase');
      expect(parsed.searchParams.get('rel')).toBe('0');
    }
  });

  it('sanitize fallback (bad host / unparsable / empty) never carries mute', () => {
    for (const raw of [
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1&mute=1',
      'https://evil.example.com/embed/dQw4w9WgXcQ',
      'not a url at all',
      '',
      null,
      undefined,
    ]) {
      for (const autoplay of [true, false]) {
        const parsed = new URL(sanitizeEmbedUrl(raw as string, 'dQw4w9WgXcQ', autoplay));
        expect(parsed.searchParams.get('mute')).toBeNull();
      }
    }
  });

  it('runtime native shell drops a backend mute=1 (unmuted default end-to-end)', async () => {
    resolveMock.mockResolvedValueOnce(
      backendResolve('dQw4w9WgXcQ', 'enablejsapi=1&rel=0&mute=1&autoplay=1'),
    );
    const { getByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    const src = new URL(iframeSrcOf(webviewOf(getByTestId).props.source.html));
    expect(src.searchParams.get('mute')).toBeNull();
    expect(src.searchParams.get('enablejsapi')).toBe('1');
  });

  it('resolve fallback is also unmuted', async () => {
    resolveMock.mockRejectedValueOnce({ response: { status: 404 } });
    const { getByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    const html = webviewOf(getByTestId).props.source.html;
    // Shell escapes & -> &amp; (spec-correct); request still decodes to &.
    expect(html).toContain(buildYouTubeEmbedUrl('dQw4w9WgXcQ').replace(/&/g, '&amp;'));
    expect(new URL(iframeSrcOf(html)).searchParams.get('mute')).toBeNull();
  });

  it('strict videoId: hostile ids throw instead of leaking params', () => {
    expect(() => buildYouTubeEmbedUrl('a/b?c=d&e=f', false)).toThrow(/Invalid YouTube videoId/);
    expect(() => buildYouTubeEmbedUrl('a&b=c', false)).toThrow(/Invalid YouTube videoId/);
  });
});

describe('WATCH-2 tap-to-unmute fallback (unMute/setVolume bridge + overlay)', () => {
  it('exports the unMute + setVolume(100) bridge targeting the www origin', () => {
    expect(UNMUTE_IFRAMES_JS).toContain('unMute');
    expect(UNMUTE_IFRAMES_JS).toContain('setVolume');
    expect(UNMUTE_IFRAMES_JS).toContain('[100]');
    expect(UNMUTE_IFRAMES_JS).toContain('https://www.youtube.com');
    expect(MUTE_IFRAMES_JS).toContain("'mute'");
    expect(MUTE_IFRAMES_JS).toContain('https://www.youtube.com');
  });

  it('setVolumeIframesJs clamps to 0..100 and rounds', () => {
    expect(setVolumeIframesJs(-5)).toContain('[0]');
    expect(setVolumeIframesJs(150)).toContain('[100]');
    expect(setVolumeIframesJs(73.6)).toContain('[74]');
    expect(setVolumeIframesJs(0)).toContain('[0]');
  });

  it('native shell wires unMute/mute/setVolume message handlers', async () => {
    const { getByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    const html = webviewOf(getByTestId).props.source.html;
    expect(html).toContain('__spotibaseUnmute');
    expect(html).toContain('unMute');
    expect(html).toContain('spotibase-unmute');
    expect(html).toContain('spotibase-mute');
    expect(html).toContain('spotibase-volume:');
  });

  it('no unmute overlay by default; mute toggle reveals Tap-to-unmute; tap clears it', async () => {
    const { getByTestId, queryByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());

    expect(queryByTestId('youtube-unmute')).toBeNull();
    const toggle = getByTestId('youtube-mute-toggle');
    expect(toggle.props.accessibilityLabel).toBe('Mute video');

    fireEvent.press(toggle);
    expect(getByTestId('youtube-unmute')).toBeTruthy();
    expect(getByTestId('youtube-mute-toggle').props.accessibilityLabel).toBe('Unmute video');

    fireEvent.press(getByTestId('youtube-unmute'));
    expect(queryByTestId('youtube-unmute')).toBeNull();
    expect(getByTestId('youtube-mute-toggle').props.accessibilityLabel).toBe('Mute video');
  });

  it('switching videos resets the muted flag (fresh gesture starts unmuted)', async () => {
    const { getByTestId, queryByTestId, rerender } = render(
      <YouTubePlayer video={vid('AAAAAAAAAAA', 'First')} />,
    );
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    fireEvent.press(getByTestId('youtube-mute-toggle'));
    expect(getByTestId('youtube-unmute')).toBeTruthy();

    resolveMock.mockResolvedValueOnce(backendResolve('BBBBBBBBBBB'));
    rerender(<YouTubePlayer video={vid('BBBBBBBBBBB', 'Second')} />);
    await waitFor(() => expect(resolveMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queryByTestId('youtube-unmute')).toBeNull());
  });

  it('retry after a 153 fallback clears the muted flag and restores the player', async () => {
    const { getByTestId, queryByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    fireEvent.press(getByTestId('youtube-mute-toggle'));
    expect(getByTestId('youtube-unmute')).toBeTruthy();

    act(() => {
      webviewOf(getByTestId).props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'yt-error', code: 153 }) },
      });
    });
    await waitFor(() => expect(getByTestId('youtube-player-fallback')).toBeTruthy());

    resolveMock.mockResolvedValueOnce(backendResolve('dQw4w9WgXcQ'));
    fireEvent.press(getByTestId('youtube-player-retry'));
    await waitFor(() => {
      expect(queryByTestId('youtube-player-fallback')).toBeNull();
      expect(getByTestId('youtube-player-webview')).toBeTruthy();
    });
    expect(queryByTestId('youtube-unmute')).toBeNull();
  });
});

describe('WATCH-3 watch layout: video-top, Up-next-below, single WebView', () => {
  it('player mounts exactly one WebView (single-player invariant)', async () => {
    const { getByTestId, queryAllByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    expect(queryAllByTestId('youtube-player-webview')).toHaveLength(1);
  });

  it('player source contains exactly one <WebView (never one per row)', () => {
    expect((PLAYER_SRC().match(/<WebView/g) || []).length).toBe(1);
  });

  it('overlay expanded sheet mounts exactly one embedded player WebView', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId, queryAllByTestId } = render(<MiniYouTubeOverlay />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    expect(queryAllByTestId('youtube-player-webview')).toHaveLength(1);
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
  });

  it('switching the video reuses the single WebView (suggestion tap = last-wins)', async () => {
    const { getByTestId, queryAllByTestId, rerender } = render(
      <YouTubePlayer video={vid('AAAAAAAAAAA', 'First')} />,
    );
    resolveMock.mockResolvedValueOnce(backendResolve('BBBBBBBBBBB'));
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    rerender(<YouTubePlayer video={vid('BBBBBBBBBBB', 'Second')} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    expect(queryAllByTestId('youtube-player-webview')).toHaveLength(1);
  });

  it('fresh suggestion tap opens expanded (predictable watch entry point)', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
    });
    expect(useYouTubePlayerStore.getState().mode).toBe('mini');
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid('BBBBBBBBBBB', 'Next'));
    });
    expect(useYouTubePlayerStore.getState().mode).toBe('expanded');
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('expanded sheet shows video on top with transport and NO suggestions when off the watch page (clean layout)', async () => {
    const other1 = vid('BBBBBBBBBBB', 'Related One');
    const other2 = vid('CCCCCCCCCCC', 'Related Two');
    searchMock.mockResolvedValueOnce({
      data: { videos: [vid(), other1, other2] },
    });
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.setState({ watchPageActive: false });
    });
    const { getByTestId, queryByText, queryByTestId } = render(<MiniYouTubeOverlay />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    // Sticky 16:9 video on top + transport row — one embedded player.
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    expect(getByTestId('mini-youtube-play-pause')).toBeTruthy();
    expect(getByTestId('mini-youtube-minimize')).toBeTruthy();
    expect(getByTestId('mini-youtube-fullscreen')).toBeTruthy();
    expect(getByTestId('mini-youtube-now-playing-title')).toBeTruthy();
    // No "Up next" suggestions inside the played video off the watch page.
    expect(queryByText('Up next')).toBeNull();
    expect(queryByTestId('mini-youtube-suggestion-BBBBBBBBBBB')).toBeNull();
    expect(queryByTestId('mini-youtube-suggestion-CCCCCCCCCCC')).toBeNull();
  });

  it('suggestions are never fetched or rendered inside the sheet off the watch page (no Up next)', async () => {
    const other = vid('BBBBBBBBBBB', 'Related One');
    searchMock.mockResolvedValue({ data: { videos: [other] } });
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.setState({ watchPageActive: false });
    });
    const { getByTestId, queryByText, queryByTestId, queryAllByTestId } = render(
      <MiniYouTubeOverlay />,
    );
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    expect(queryByText('Up next')).toBeNull();
    expect(queryByTestId('mini-youtube-suggestion-BBBBBBBBBBB')).toBeNull();
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
    // Suggestions fetch is watch-page-only: the bottom sheet must not hit
    // the search API at all.
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('watch page (watchPageActive) pins video at top with Up next below (single player)', async () => {
    const other1 = vid('BBBBBBBBBBB', 'Related One');
    const other2 = vid('CCCCCCCCCCC', 'Related Two');
    searchMock.mockResolvedValue({ data: { videos: [vid(), other1, other2] } });
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.setState({ watchPageActive: true });
    });
    const { getByTestId, getByText, queryAllByTestId } = render(<MiniYouTubeOverlay />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    expect(getByTestId('mini-youtube-watch-video')).toBeTruthy();
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    expect(getByTestId('mini-youtube-now-playing-title')).toBeTruthy();
    expect(getByText('Up next')).toBeTruthy();
    expect(getByTestId('mini-youtube-suggestion-BBBBBBBBBBB')).toBeTruthy();
    expect(getByTestId('mini-youtube-suggestion-CCCCCCCCCCC')).toBeTruthy();
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
    expect(searchMock).toHaveBeenCalled();
  });

  it('watch page suggestion tap is last-wins with a single player', async () => {
    const other = vid('BBBBBBBBBBB', 'Related One');
    searchMock.mockResolvedValue({ data: { videos: [other] } });
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.setState({ watchPageActive: true });
    });
    const { getByTestId, queryAllByTestId } = render(<MiniYouTubeOverlay />);
    await waitFor(() =>
      expect(getByTestId('mini-youtube-suggestion-BBBBBBBBBBB')).toBeTruthy(),
    );
    fireEvent.press(getByTestId('mini-youtube-suggestion-BBBBBBBBBBB'));
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('BBBBBBBBBBB');
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
  });
});

describe('WATCH-4 swipe down to mini / swipe-up + tap to expand', () => {
  it('expanded sheet declares a swipe-down-to-mini gesture (90pt / 600 velocity)', () => {
    const src = OVERLAY_SRC();
    expect(src).toMatch(/translationY > 90/);
    expect(src).toMatch(/velocityY > 600/);
    expect(src).toContain("setMode)('mini')");
  });

  it('swipe is vertical-only (horizontal drag does not minimize)', () => {
    const src = OVERLAY_SRC();
    expect(src).toMatch(/failOffsetX/);
    expect(src).toMatch(/activeOffsetY/);
  });

  it('minimize button collapses to mini; expand button restores the sheet', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    expect(useYouTubePlayerStore.getState().mode).toBe('mini');
    expect(getByTestId('mini-youtube-expand')).toBeTruthy();
    fireEvent.press(getByTestId('mini-youtube-expand'));
    expect(useYouTubePlayerStore.getState().mode).toBe('expanded');
  });

  it('mini card drag uses edge snap (nearest horizontal edge, clamped Y)', () => {
    const src = OVERLAY_SRC();
    expect(src).toMatch(/minDistance\(8\)/);
    expect(src).toMatch(/snappedX/);
    expect(src).toMatch(/withSpring/);
  });

  it('mini swipe-up expands (translationY < -60 or velocityY < -500)', () => {
    const src = OVERLAY_SRC();
    expect(src).toMatch(/translationY.*< -60/);
    expect(src).toMatch(/velocityY.*< -500/);
    expect(src).toContain("runOnJS(setMode)('expanded')");
  });

  it('tap parity: thumbnail / title tap expands like swipe-up', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    expect(getByTestId('mini-youtube-thumb')).toBeTruthy();
    expect(getByTestId('mini-youtube-tap-expand')).toBeTruthy();
    fireEvent.press(getByTestId('mini-youtube-tap-expand'));
    expect(useYouTubePlayerStore.getState().mode).toBe('expanded');
  });
});

describe('WATCH-5 background pause (AppState -> pause + toast)', () => {
  it('store can pause presentation while keeping the video loaded', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    act(() => {
      useYouTubePlayerStore.getState().pauseVideo();
    });
    expect(useYouTubePlayerStore.getState().currentVideo).not.toBeNull();
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
  });

  it('isPlaying=false drives a real iframe pause command (not just a boolean)', () => {
    const src = PLAYER_SRC();
    expect(src).toContain('PAUSE_IFRAMES_JS');
    expect(src).toMatch(/\[isPlaying, embedUrl\]/);
    expect(src).toMatch(/pauseVideo/);
  });

  it('overlay subscribes to AppState and pauses on background', () => {
    const src = OVERLAY_SRC();
    expect(src).toMatch(/AppState\.addEventListener\('change'/);
    expect(src).toMatch(/next === 'background'/);
    expect(src).toMatch(/pauseVideo\(\)/);
  });

  it('backgrounding pauses playback and shows the compliance toast (no auto-resume)', async () => {
    const handlers: Array<(next: string) => void> = [];
    const addSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((type: string, handler: (next: string) => void) => {
        if (type === 'change') handlers.push(handler);
        return { remove: jest.fn() };
      }) as never);
    try {
      searchMock.mockResolvedValue({ data: { videos: [] } });
      act(() => {
        useYouTubePlayerStore.getState().playVideo(vid());
      });
      const { getByTestId, queryByTestId, unmount } = render(<MiniYouTubeOverlay />);
      expect(handlers.length).toBeGreaterThan(0);
      expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);

      act(() => {
        handlers.forEach((h) => h('background'));
      });
      expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
      expect(useYouTubePlayerStore.getState().currentVideo).not.toBeNull();
      await waitFor(() => expect(getByTestId('mini-youtube-bg-toast')).toBeTruthy());

      // Foreground must NOT auto-resume: user taps play when ready.
      act(() => {
        handlers.forEach((h) => h('active'));
      });
      expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
      expect(queryByTestId('mini-youtube-bg-toast')).toBeTruthy();
      unmount();
    } finally {
      addSpy.mockRestore();
    }
  });

  it('backgrounding an already-paused video stays silent (no toast spam)', async () => {
    const handlers: Array<(next: string) => void> = [];
    const addSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((type: string, handler: (next: string) => void) => {
        if (type === 'change') handlers.push(handler);
        return { remove: jest.fn() };
      }) as never);
    try {
      searchMock.mockResolvedValue({ data: { videos: [] } });
      act(() => {
        useYouTubePlayerStore.getState().playVideo(vid());
        useYouTubePlayerStore.getState().pauseVideo();
      });
      const { queryByTestId, unmount } = render(<MiniYouTubeOverlay />);
      act(() => {
        handlers.forEach((h) => h('background'));
      });
      expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
      expect(queryByTestId('mini-youtube-bg-toast')).toBeNull();
      unmount();
    } finally {
      addSpy.mockRestore();
    }
  });
});

describe('WATCH-6 no double-play (mutual exclusion + single player)', () => {
  it('playVideo pauses running audio so video wins', async () => {
    usePlayerStore.setState({ playbackState: 'playing' });
    useYouTubePlayerStore.getState().playVideo(vid());
    await Promise.resolve();
    expect(TrackPlayer.pause).toHaveBeenCalled();
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('playVideo also pauses loading audio, but leaves idle/paused audio alone', async () => {
    usePlayerStore.setState({ playbackState: 'loading' });
    useYouTubePlayerStore.getState().playVideo(vid());
    await Promise.resolve();
    expect(TrackPlayer.pause).toHaveBeenCalled();

    jest.clearAllMocks();
    usePlayerStore.setState({ playbackState: 'paused' });
    useYouTubePlayerStore.getState().playVideo(vid('BBBBBBBBBBB', 'Next'));
    await Promise.resolve();
    expect(TrackPlayer.pause).not.toHaveBeenCalled();
  });

  it('audio taking over pauses video presentation but keeps it loaded', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    act(() => {
      useYouTubePlayerStore.getState().notifyAudioStarted();
    });
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
    expect(useYouTubePlayerStore.getState().currentVideo).not.toBeNull();
  });

  it('mounting a playing video pauses audio regardless of autoplay (intent to watch wins)', async () => {
    for (const autoplay of [undefined, true, false]) {
      // P0-3 gated mount-pause: only pauses when the video is presenting
      // (isPlaying true); a paused mount must not kill audio.
      act(() => {
        useYouTubePlayerStore.setState({ currentVideo: vid(), isPlaying: true });
      });
      usePlayerStore.setState({ playbackState: 'playing' });
      jest.clearAllMocks();
      const { unmount } = render(
        autoplay === undefined ? <YouTubePlayer video={vid()} /> : <YouTubePlayer video={vid()} autoplay={autoplay} />,
      );
      await waitFor(() => expect(resolveMock).toHaveBeenCalled());
      await Promise.resolve();
      expect(TrackPlayer.pause).toHaveBeenCalled();
      unmount();
      jest.clearAllMocks();
      resolveMock.mockResolvedValue(backendResolve('dQw4w9WgXcQ'));
    }
  });

  it('mounting a paused video does not pause audio (gated on isPlaying)', async () => {
    act(() => {
      useYouTubePlayerStore.setState({ currentVideo: vid(), isPlaying: false });
    });
    usePlayerStore.setState({ playbackState: 'playing' });
    jest.clearAllMocks();
    const { unmount } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(resolveMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(TrackPlayer.pause).not.toHaveBeenCalled();
    unmount();
  });

  it('rapid suggestion taps are last-wins with a single loaded video', () => {
    const s = useYouTubePlayerStore.getState();
    s.playVideo(vid('AAAAAAAAAAA', 'First'));
    useYouTubePlayerStore.getState().playVideo(vid('BBBBBBBBBBB', 'Second'));
    useYouTubePlayerStore.getState().playVideo(vid('CCCCCCCCCCC', 'Third'));
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('CCCCCCCCCCC');
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('close/stop unload idempotently so no audio lingers', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    act(() => {
      useYouTubePlayerStore.getState().closePlayer();
      useYouTubePlayerStore.getState().closePlayer();
    });
    expect(useYouTubePlayerStore.getState().currentVideo).toBeNull();
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().stopVideo();
    });
    expect(useYouTubePlayerStore.getState().currentVideo).toBeNull();
  });

  it('resume without a loaded video is a no-op (no phantom playback)', () => {
    useYouTubePlayerStore.getState().resumeVideo();
    expect(useYouTubePlayerStore.getState().currentVideo).toBeNull();
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
  });

  it('native WebView errors surface the fallback card instead of a black frame', async () => {
    const { getByTestId, queryByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    expect(queryByTestId('youtube-player-fallback')).toBeNull();
    act(() => {
      webviewOf(getByTestId).props.onError();
    });
    await waitFor(() => expect(getByTestId('youtube-player-fallback')).toBeTruthy());
  });

  it('malformed WebView messages never start or kill playback', async () => {
    const { getByTestId, queryByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    const wv = webviewOf(getByTestId);
    act(() => {
      wv.props.onMessage({ nativeEvent: { data: 'not-json{{{' } });
      wv.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'unknown' }) } });
      wv.props.onMessage({ nativeEvent: { data: '' } });
      wv.props.onMessage({ nativeEvent: {} });
    });
    expect(queryByTestId('youtube-player-fallback')).toBeNull();
    expect(getByTestId('youtube-player-webview')).toBeTruthy();
  });

  it('renders null without a video and never resolves (no hidden player)', () => {
    resolveMock.mockClear();
    const { toJSON } = render(<YouTubePlayer video={null} />);
    expect(toJSON()).toBeNull();
    expect(resolveMock).not.toHaveBeenCalled();
  });
});

describe('WATCH-7 watch screen host (focus flag + autoplay + no blank screen)', () => {
  const YouTubeWatchScreen =
    require('../../screens/youtube/YouTubeWatchScreen').default as React.ComponentType<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetStores();
  });

  it('focus sets watchPageActive true and unmount clears it', () => {
    const navigation = { canGoBack: () => false, goBack: jest.fn(), navigate: jest.fn() };
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { unmount } = render(
      <YouTubeWatchScreen route={{ params: { videoId: 'dQw4w9WgXcQ' } }} navigation={navigation} />,
    );
    expect(useYouTubePlayerStore.getState().watchPageActive).toBe(true);
    unmount();
    expect(useYouTubePlayerStore.getState().watchPageActive).toBe(false);
  });

  it('deep-link autoplay loads the route video into the single player', () => {
    const navigation = { canGoBack: () => false, goBack: jest.fn(), navigate: jest.fn() };
    expect(useYouTubePlayerStore.getState().currentVideo).toBeNull();
    render(
      <YouTubeWatchScreen
        route={{ params: { videoId: 'dQw4w9WgXcQ', title: 'Deep Link' } }}
        navigation={navigation}
      />,
    );
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('dQw4w9WgXcQ');
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('no video + canGoBack auto-pops instead of a blank screen', () => {
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId } = render(
      <YouTubeWatchScreen route={{ params: {} }} navigation={navigation} />,
    );
    expect(getByTestId('youtube-watch-screen')).toBeTruthy();
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('no video at root renders fallback with Browse -> YouTubeSongs', () => {
    const navigation = { canGoBack: () => false, goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, getByText } = render(
      <YouTubeWatchScreen route={{ params: {} }} navigation={navigation} />,
    );
    expect(getByTestId('youtube-watch-screen')).toBeTruthy();
    expect(getByText('No video selected')).toBeTruthy();
    fireEvent.press(getByTestId('youtube-watch-browse'));
    expect(navigation.navigate).toHaveBeenCalledWith('YouTubeSongs');
  });

  it('closePlayer on the watch page pops back (no blank screen remains)', () => {
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { rerender } = render(
      <YouTubeWatchScreen
        route={{ params: { videoId: 'dQw4w9WgXcQ', title: 'Lo-Fi Beats' } }}
        navigation={navigation}
      />,
    );
    expect(useYouTubePlayerStore.getState().currentVideo).not.toBeNull();
    act(() => {
      useYouTubePlayerStore.getState().closePlayer();
    });
    rerender(
      <YouTubeWatchScreen
        route={{ params: { videoId: 'dQw4w9WgXcQ', title: 'Lo-Fi Beats' } }}
        navigation={navigation}
      />,
    );
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('watch screen is a black backdrop with no second WebView', () => {
    const src: string = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'screens', 'youtube', 'YouTubeWatchScreen.tsx'),
      'utf8',
    );
    expect(src).toContain('#000');
    expect(src).not.toContain('<YouTubePlayer');
    expect(src).not.toContain('<WebView');
  });
});

describe('WATCH-8 minimize pops back to the list (no blank watch page)', () => {
  const YouTubeWatchScreen =
    require('../../screens/youtube/YouTubeWatchScreen').default as React.ComponentType<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetStores();
  });

  it('transition INTO mini with a video pops back once (YouTube-authentic)', () => {
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    render(
      <YouTubeWatchScreen
        route={{ params: { videoId: 'dQw4w9WgXcQ', title: 'Lo-Fi Beats' } }}
        navigation={navigation}
      />,
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    act(() => {
      useYouTubePlayerStore.getState().setMode('mini');
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('no goBack on initial mount even when already mini', () => {
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
    });
    render(
      <YouTubeWatchScreen
        route={{ params: { videoId: 'dQw4w9WgXcQ', title: 'Lo-Fi Beats' } }}
        navigation={navigation}
      />,
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('no goBack on expanded/fullscreen transitions with a video', () => {
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    render(
      <YouTubeWatchScreen
        route={{ params: { videoId: 'dQw4w9WgXcQ', title: 'Lo-Fi Beats' } }}
        navigation={navigation}
      />,
    );
    act(() => {
      useYouTubePlayerStore.getState().setMode('expanded');
    });
    expect(navigation.goBack).not.toHaveBeenCalled();
    act(() => {
      useYouTubePlayerStore.getState().setMode('fullscreen');
    });
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('no minimize pop when there is no video (transition guard)', () => {
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    // Cold watch route with no params and nothing playing auto-pops on
    // mount for the empty case — clear it so this asserts the minimize
    // effect itself never fires without a video.
    render(<YouTubeWatchScreen route={{ params: {} }} navigation={navigation} />);
    expect(navigation.goBack).toHaveBeenCalled();
    navigation.goBack.mockClear();
    act(() => {
      useYouTubePlayerStore.getState().setMode('mini');
    });
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('staying in mini never pops twice', () => {
    const navigation = { canGoBack: () => true, goBack: jest.fn(), navigate: jest.fn() };
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    render(
      <YouTubeWatchScreen
        route={{ params: { videoId: 'dQw4w9WgXcQ', title: 'Lo-Fi Beats' } }}
        navigation={navigation}
      />,
    );
    act(() => {
      useYouTubePlayerStore.getState().setMode('mini');
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    act(() => {
      useYouTubePlayerStore.getState().setMode('mini');
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('root mini fallback renders title + channel + Up next (never blank)', async () => {
    const other1 = vid('BBBBBBBBBBB', 'Related One');
    const other2 = vid('CCCCCCCCCCC', 'Related Two');
    searchMock.mockResolvedValue({ data: { videos: [vid(), other1, other2] } });
    // Root: cannot pop, so the watch screen must render content itself.
    const navigation = { canGoBack: () => false, goBack: jest.fn(), navigate: jest.fn() };
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
    });
    const { getByTestId, getByText } = render(
      <YouTubeWatchScreen
        route={{ params: { videoId: 'dQw4w9WgXcQ', title: 'Lo-Fi Beats' } }}
        navigation={navigation}
      />,
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(getByTestId('youtube-watch-screen')).toBeTruthy();
    expect(getByTestId('youtube-watch-fallback-title')).toBeTruthy();
    expect(getByTestId('youtube-watch-fallback-channel')).toBeTruthy();
    expect(getByText('Up next')).toBeTruthy();
    await waitFor(() => expect(searchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(getByTestId('youtube-watch-suggestion-BBBBBBBBBBB')).toBeTruthy(),
    );
    expect(getByTestId('youtube-watch-suggestion-CCCCCCCCCCC')).toBeTruthy();
  });

  it('root mini fallback keeps the black backdrop with no second WebView', () => {
    const src: string = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'screens', 'youtube', 'YouTubeWatchScreen.tsx'),
      'utf8',
    );
    expect(src).toContain('#000');
    expect(src).toContain('youtube-watch-up-next-list');
    expect(src).not.toContain('<YouTubePlayer');
    expect(src).not.toContain('<WebView');
  });
});
