import React from 'react';
import { Linking, Platform } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import YouTubePlayer, {
  YOUTUBE_APP_ORIGIN,
  YOUTUBE_PLAYER_BASE_URL,
  YOUTUBE_EMBED_HOST,
  YOUTUBE_TARGET_ORIGIN,
  YT_TIME_TIMEOUT_MS,
  QUERY_TIME_IFRAMES_JS,
  seekToIframesJs,
  seekOnlyIframesJs,
  buildYouTubeEmbedUrl,
  sanitizeEmbedUrl,
  youtubeWatchUrl,
} from './YouTubePlayer';
import type { YouTubePlayerHandle } from './YouTubePlayer';
import { youtubeApi } from '../../api/youtubeApi';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import type { YouTubeVideo } from '../../types/youtube';

/**
 * Issue #153 regression tests for the inline YouTube player (Expo SDK 57).
 *
 * Backend pins the canonical embed host + enablejsapi; this suite pins the
 * client half (unmuted default):
 * - every embed URL carries origin/enablejsapi/playsinline/rel and NEVER a
 *   mute param on the www.youtube.com host — never youtube-nocookie.com
 *   (privacy-enhanced hosts drop the Origin/Referer YouTube needs for the
 *   `origin=` check and surface error 153); autoplay defaults to false so a
 *   user gesture starts playback with sound, and the unMute/setVolume bridge
 *   + "Tap to unmute" overlay recovers sound when the OS starts muted;
 * - the native WebView sends that same https origin as baseUrl, allowlists
 *   https/http navigation, and renders the iframe responsive (100% x 100%
 *   inside a 16:9 full-width frame — no fixed 480/270, no min-height);
 * - IFrame errors 101/150/153 swap the single player for a fallback card
 *   with an "Open in YouTube" action instead of a black frame;
 * - resolve failures (404/offline) fall back to the canonical direct embed;
 * - only one player instance is ever mounted (screens swap `video`).
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

const resolveMock = youtubeApi.resolve as jest.Mock;

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

const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);

describe('YouTubePlayer embed URL contract (#153)', () => {
  it('pins the app origin / base URL / host constants', () => {
    expect(YOUTUBE_APP_ORIGIN).toBe('https://app.spotibase');
    expect(YOUTUBE_PLAYER_BASE_URL.startsWith('https://')).toBe(true);
    expect(YOUTUBE_PLAYER_BASE_URL).toBe('https://app.spotibase/');
    expect(YOUTUBE_EMBED_HOST).toBe('www.youtube.com');
    expect(YOUTUBE_TARGET_ORIGIN).toBe('https://www.youtube.com');
  });

  it('builds the canonical www embed URL with enablejsapi + origin (unmuted default)', () => {
    const url = buildYouTubeEmbedUrl('dQw4w9WgXcQ');
    const parsed = new URL(url);

    expect(`${parsed.protocol}//${parsed.hostname}`).toBe('https://www.youtube.com');
    expect(parsed.pathname).toBe('/embed/dQw4w9WgXcQ');
    expect(parsed.searchParams.get('enablejsapi')).toBe('1');
    expect(parsed.searchParams.get('origin')).toBe(YOUTUBE_APP_ORIGIN);
    expect(parsed.searchParams.get('playsinline')).toBe('1');
    expect(parsed.searchParams.get('rel')).toBe('0');
    // Unmuted default: autoplay off, NO mute param (user gesture starts sound).
    expect(parsed.searchParams.get('autoplay')).toBe('0');
    expect(parsed.searchParams.get('mute')).toBeNull();
    expect(url).not.toContain('nocookie');
    expect(url).not.toContain('mute=');
  });

  it('never emits mute — even with autoplay on (unMute bridge recovers sound)', () => {
    for (const autoplay of [true, false]) {
      const parsed = new URL(buildYouTubeEmbedUrl('dQw4w9WgXcQ', autoplay));
      expect(parsed.searchParams.get('autoplay')).toBe(autoplay ? '1' : '0');
      expect(parsed.searchParams.get('mute')).toBeNull();
      expect(parsed.searchParams.get('enablejsapi')).toBe('1');
    }
  });

  it('sanitizeEmbedUrl canonicalizes backend URLs and enforces player params', () => {
    const sanitized = new URL(
      sanitizeEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=1', 'dQw4w9WgXcQ'),
    );

    expect(sanitized.hostname).toBe('www.youtube.com');
    expect(sanitized.searchParams.get('enablejsapi')).toBe('1');
    expect(sanitized.searchParams.get('origin')).toBe(YOUTUBE_APP_ORIGIN);
    expect(sanitized.searchParams.get('playsinline')).toBe('1');
    expect(sanitized.searchParams.get('rel')).toBe('0');
  });

  it.each([
    ['privacy-enhanced host', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1'],
    ['plain http', 'http://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['watch URL instead of embed', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['non-YouTube host', 'https://evil.example.com/embed/dQw4w9WgXcQ'],
    ['unparsable', 'not a url at all'],
    ['empty', ''],
  ])('sanitizeEmbedUrl falls back to canonical for %s', (_label, raw) => {
    expect(sanitizeEmbedUrl(raw, 'dQw4w9WgXcQ')).toBe(buildYouTubeEmbedUrl('dQw4w9WgXcQ'));
    expect(sanitizeEmbedUrl(raw, 'dQw4w9WgXcQ')).not.toContain('nocookie');
  });

  it('builds the public watch URL used by the fallback', () => {
    expect(youtubeWatchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});

describe('YouTubePlayer native WebView (#153)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    openURLSpy.mockResolvedValue(true as any);
    useYouTubePlayerStore.setState({ currentVideo: null, isPlaying: false });
    resolveMock.mockResolvedValue(backendResolve('dQw4w9WgXcQ'));
    jest.replaceProperty(Platform, 'OS', 'ios');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders null without a video (single player unmounted)', () => {
    const { toJSON } = render(<YouTubePlayer video={null} />);

    expect(toJSON()).toBeNull();
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('mounts exactly one WebView with origin/baseUrl/referrer and no nocookie host', async () => {
    const { getByTestId, queryAllByTestId } = render(
      <YouTubePlayer video={vid()} testID="youtube-player" />,
    );

    await waitFor(() => {
      expect(getByTestId('youtube-player-webview')).toBeTruthy();
    });

    // Single player: exactly one inline WebView, never one per row.
    expect(queryAllByTestId('youtube-player-webview')).toHaveLength(1);

    const webview: any = getByTestId('youtube-player-webview');
    expect(webview.props.source.baseUrl).toBe(YOUTUBE_PLAYER_BASE_URL);
    expect(webview.props.source.baseUrl.startsWith('https://')).toBe(true);
    expect(webview.props.originWhitelist).toEqual(expect.arrayContaining(['https://*']));

    const html: string = webview.props.source.html;
    expect(html).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(html).toContain('enablejsapi');
    // origin is URL-encoded inside the iframe src query string.
    expect(html).toContain('origin=');
    expect(html).toContain(encodeURIComponent(YOUTUBE_APP_ORIGIN));
    expect(html).toContain('strict-origin-when-cross-origin');
    // 16:9 full-width contract: responsive 100% x 100%, no fixed 480/270,
    // no min-height/min-width guards (frame is aspectRatio 16/9).
    expect(html).toContain('width="100%"');
    expect(html).toContain('height="100%"');
    expect(html).not.toContain('width="480"');
    expect(html).not.toContain('height="270"');
    expect(html).not.toMatch(/min-height/i);
    expect(html).not.toMatch(/min-width/i);
    expect(html).not.toContain('nocookie');
  });

  it('falls back to the canonical direct embed when resolve 404s', async () => {
    resolveMock.mockRejectedValueOnce({ response: { status: 404 } });

    const { getByTestId, queryByTestId } = render(<YouTubePlayer video={vid()} />);

    await waitFor(() => {
      expect(getByTestId('youtube-player-webview')).toBeTruthy();
    });

    const webview: any = getByTestId('youtube-player-webview');
    // Inline shell HTML-escapes & -> &amp; (spec-correct); the request still
    // decodes to & on load.
    expect(webview.props.source.html).toContain(
      buildYouTubeEmbedUrl('dQw4w9WgXcQ').replace(/&/g, '&amp;'),
    );
    expect(queryByTestId('youtube-player-fallback')).toBeNull();
  });

  it.each([101, 150, 153])(
    'swaps error %i for the fallback card with Open in YouTube',
    async (code) => {
      const { getByTestId } = render(<YouTubePlayer video={vid()} />);

      await waitFor(() => {
        expect(getByTestId('youtube-player-webview')).toBeTruthy();
      });

      act(() => {
        (getByTestId('youtube-player-webview') as any).props.onMessage({
          nativeEvent: { data: JSON.stringify({ type: 'yt-error', code }) },
        });
      });

      await waitFor(() => {
        expect(getByTestId('youtube-player-fallback')).toBeTruthy();
        expect(getByTestId('youtube-open-external')).toBeTruthy();
      });

      fireEvent.press(getByTestId('youtube-open-external'));
      expect(openURLSpy).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    },
  );

  it('retry clears the 153 fallback and re-resolves', async () => {
    const { getByTestId, queryByTestId } = render(<YouTubePlayer video={vid()} />);

    await waitFor(() => {
      expect(getByTestId('youtube-player-webview')).toBeTruthy();
    });

    act(() => {
      (getByTestId('youtube-player-webview') as any).props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'yt-error', code: 153 }) },
      });
    });

    await waitFor(() => {
      expect(getByTestId('youtube-player-fallback')).toBeTruthy();
    });

    resolveMock.mockResolvedValueOnce(backendResolve('dQw4w9WgXcQ'));
    fireEvent.press(getByTestId('youtube-player-retry'));

    await waitFor(() => {
      expect(queryByTestId('youtube-player-fallback')).toBeNull();
      expect(getByTestId('youtube-player-webview')).toBeTruthy();
    });
    expect(resolveMock).toHaveBeenCalledTimes(2);
  });
});

describe('YouTubePlayer position bridge (mini <-> shared handoff, no reload)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    openURLSpy.mockResolvedValue(true as any);
    useYouTubePlayerStore.setState({ currentVideo: null, isPlaying: false });
    resolveMock.mockResolvedValue(backendResolve('dQw4w9WgXcQ'));
    jest.replaceProperty(Platform, 'OS', 'ios');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('buildYouTubeEmbedUrl with startSeconds adds start param + forces autoplay', () => {
    const url = new URL(buildYouTubeEmbedUrl('dQw4w9WgXcQ', false, 42));
    expect(url.searchParams.get('start')).toBe('42');
    expect(url.searchParams.get('autoplay')).toBe('1');
    expect(url.searchParams.get('mute')).toBeNull();
    // Floors + clamps.
    expect(new URL(buildYouTubeEmbedUrl('dQw4w9WgXcQ', false, 42.9)).searchParams.get('start')).toBe('42');
    expect(new URL(buildYouTubeEmbedUrl('dQw4w9WgXcQ', false, 0)).searchParams.get('start')).toBeNull();
    expect(new URL(buildYouTubeEmbedUrl('dQw4w9WgXcQ', false, -5)).searchParams.get('start')).toBeNull();
  });

  it('sanitizeEmbedUrl preserves startSeconds + strips mute', () => {
    const parsed = new URL(
      sanitizeEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=1&mute=1', 'dQw4w9WgXcQ', false, 77),
    );
    expect(parsed.searchParams.get('start')).toBe('77');
    expect(parsed.searchParams.get('autoplay')).toBe('1');
    expect(parsed.searchParams.get('mute')).toBeNull();
  });

  it('exports seek + time bridges targeting the www origin', () => {
    expect(YT_TIME_TIMEOUT_MS).toBe(800);
    expect(QUERY_TIME_IFRAMES_JS).toContain('yt-time');
    expect(QUERY_TIME_IFRAMES_JS).toContain('getCurrentTime');
    const seekJs = seekToIframesJs(42);
    expect(seekJs).toContain('seekTo');
    expect(seekJs).toContain('[42,true]');
    expect(seekJs).toContain('playVideo');
    expect(seekJs).toContain('https://www.youtube.com');
    expect(seekOnlyIframesJs(10)).toContain('[10,true]');
    expect(seekOnlyIframesJs(10)).not.toContain('playVideo');
  });

  it('startSeconds prop flows into the embed URL start param', async () => {
    const { getByTestId } = render(<YouTubePlayer video={vid()} startSeconds={65} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    const html: string = (getByTestId('youtube-player-webview') as any).props.source.html;
    // Inline shell escapes & -> &amp;; decode for URL asserts.
    const decoded = html.replace(/&amp;/g, '&');
    expect(decoded).toContain('start=65');
    expect(decoded).toContain('autoplay=1');
  });

  it('getCurrentTime resolves via yt-time message (NaN -> 0 fallback)', async () => {
    const ref = React.createRef<YouTubePlayerHandle>();
    const { getByTestId } = render(<YouTubePlayer video={vid()} ref={ref as any} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    expect(ref.current?.getCurrentTime).toBeTruthy();
    expect(ref.current?.seekTo).toBeTruthy();

    const pending = ref.current!.getCurrentTime();
    act(() => {
      (getByTestId('youtube-player-webview') as any).props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'yt-time', seconds: 123.7 }) },
      });
    });
    await expect(pending).resolves.toBeCloseTo(123.7, 5);

    // NaN -> 0.
    const pendingNaN = ref.current!.getCurrentTime();
    act(() => {
      (getByTestId('youtube-player-webview') as any).props.onMessage({
        nativeEvent: { data: JSON.stringify({ type: 'yt-time', seconds: NaN }) },
      });
    });
    // JSON NaN becomes null -> fallback 0.
    await expect(pendingNaN).resolves.toBe(0);
  });

  it('suspended (active=false) stays paused despite isPlaying (no-double-audio gate)', async () => {
    useYouTubePlayerStore.setState({ currentVideo: vid(), isPlaying: true });
    const { getByTestId, queryByTestId } = render(<YouTubePlayer video={vid()} active={false} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    // Hidden home never shows unmute overlay as playing; it mounts paused.
    expect(queryByTestId('youtube-player-fallback')).toBeNull();
    expect(getByTestId('youtube-player-webview')).toBeTruthy();
  });
});
