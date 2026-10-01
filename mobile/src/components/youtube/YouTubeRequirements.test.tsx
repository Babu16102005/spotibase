import React from 'react';
import { Platform } from 'react-native';
import { render, waitFor, act } from '@testing-library/react-native';
import YouTubePlayer, {
  buildYouTubeEmbedUrl,
  sanitizeEmbedUrl,
  youtubeWatchUrl,
} from './YouTubePlayer';
import { youtubeApi } from '../../api/youtubeApi';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import type { YouTubeVideo } from '../../types/youtube';

// Expo SDK 57 versioned docs were read before writing these tests
// (https://docs.expo.dev/versions/v57.0.0/ — react-native-webview,
// gesture-handler + reanimated patterns for drag/snap overlays).
// These tests pin the target contract, not the current implementation:
//  - YouTubePlayer: 16:9 full width, NO fixed 480/270/min-height
//  - MiniYouTubeOverlay: global mount + drag + snap + expand/collapse/close
//  - Single WebView invariant
//  - Navigation Home/Songs/Library keeps playing (global, not screen-local)
jest.mock('../../api/youtubeApi', () => ({
  youtubeApi: {
    trending: jest.fn(),
    search: jest.fn(),
    resolve: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');

declare const __dirname: string;

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

const playerSourcePath = path.join(__dirname, 'YouTubePlayer.tsx');
const readPlayerSource = (): string => fs.readFileSync(playerSourcePath, 'utf8');
/** Strip /* *\/ + // comments so doc mentions don't trip layout guards. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const appSourcePath = path.join(__dirname, '..', '..', '..', 'App.tsx');
const rootNavSourcePath = path.join(__dirname, '..', '..', 'navigation', 'RootNavigator.tsx');
const readText = (p: string): string => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};

/** Locate the MiniYouTubeOverlay module anywhere under src/. */
const findOverlayPath = (): string | null => {
  const candidates = [
    path.join(__dirname, 'MiniYouTubeOverlay.tsx'),
    path.join(__dirname, 'MiniYoutubeOverlay.tsx'),
    path.join(__dirname, '..', 'MiniYouTubeOverlay.tsx'),
    path.join(__dirname, '..', '..', 'components', 'MiniYouTubeOverlay.tsx'),
    path.join(__dirname, '..', '..', 'youtube', 'MiniYouTubeOverlay.tsx'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  // Recursive fallback: walk src/ for *Mini*YouTube* or *YouTube*Overlay*.
  try {
    const srcRoot = path.join(__dirname, '..', '..');
    const walk = (dir: string): string | null => {
      const entries: string[] = fs.readdirSync(dir, { withFileTypes: true }).map((d: any) =>
        typeof d === 'string' ? d : d.name,
      );
      for (const e of entries) {
        const full = path.join(dir, e);
        const low = e.toLowerCase();
        if (
          (low.includes('mini') && low.includes('youtube')) ||
          (low.includes('youtube') && low.includes('overlay')) ||
          low === 'miniyoutubeoverlay.tsx'
        ) {
          try {
            if (fs.statSync(full).isFile()) return full;
          } catch {}
        }
      }
      for (const e of entries) {
        const full = path.join(dir, e);
        try {
          if (fs.statSync(full).isDirectory()) {
            if (e === 'node_modules' || e.startsWith('.')) continue;
            const hit = walk(full);
            if (hit) return hit;
          }
        } catch {}
      }
      return null;
    };
    return walk(srcRoot);
  } catch {
    return null;
  }
};

describe('REQ-1 YouTubePlayer layout: 16:9 full width, no 480/270/min-height', () => {
  it('source has no fixed width="480" attribute', () => {
    const src = readPlayerSource();
    expect(src).not.toContain('width="480"');
    expect(src).not.toContain("width='480'");
    expect(src).not.toContain('width: 480');
  });

  it('source has no fixed height="270" attribute', () => {
    const src = readPlayerSource();
    expect(src).not.toContain('height="270"');
    expect(src).not.toContain("height='270'");
    expect(src).not.toContain('height: 270');
  });

  it('player frame has no min-height / minHeight (buttons may keep 44px touch targets)', () => {
    const src = stripComments(readPlayerSource());
    // Scope to the player frame + html shell + web/native frames — closeBtn
    // (32px) and primary/secondary buttons (44px) legitimately keep touch
    // targets; the video frame itself must be pure 16:9 with no minimums.
    const frameBlock = src.slice(src.indexOf('frame:'), src.indexOf('nativeFrame'));
    expect(frameBlock).not.toMatch(/minHeight/i);
    expect(frameBlock).not.toMatch(/min-height/i);
    const htmlBlock = src.slice(src.indexOf('buildNativeHtml'), src.indexOf('INLINE_BLOCKED_CODES'));
    expect(htmlBlock).not.toMatch(/min-height/i);
    expect(htmlBlock).not.toMatch(/min-width/i);
    const webBlock = src.slice(src.indexOf('webIframe'), src.indexOf('if (!video)'));
    // webIframe style object must not carry a minHeight guard.
    expect(webBlock).not.toMatch(/minHeight\s*:/);
  });

  it('player frame has no min-width / minWidth guard', () => {
    const src = stripComments(readPlayerSource());
    const frameBlock = src.slice(src.indexOf('frame:'), src.indexOf('nativeFrame'));
    expect(frameBlock).not.toMatch(/minWidth/i);
    expect(frameBlock).not.toMatch(/min-width/i);
    const htmlBlock = src.slice(src.indexOf('buildNativeHtml'), src.indexOf('INLINE_BLOCKED_CODES'));
    expect(htmlBlock).not.toMatch(/min-width/i);
  });

  it('source keeps a 16:9 frame (aspectRatio 16/9)', () => {
    const src = readPlayerSource();
    expect(src).toMatch(/aspectRatio\s*:\s*16\s*\/\s*9/);
  });

  it("source frame is full width (width '100%')", () => {
    const src = readPlayerSource();
    expect(src).toMatch(/width\s*:\s*['"]100%['"]/);
  });

  it('runtime native HTML is responsive with no fixed pixels', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    resolveMock.mockResolvedValue(backendResolve('dQw4w9WgXcQ'));
    useYouTubePlayerStore.setState({ currentVideo: null, isPlaying: false });
    const { getByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    const webview: any = getByTestId('youtube-player-webview');
    const html: string = webview.props.source.html;
    expect(html).not.toContain('width="480"');
    expect(html).not.toContain('height="270"');
    expect(html).not.toMatch(/min-height/i);
    expect(html).not.toMatch(/min-width/i);
    expect(html).not.toContain('480');
    // Responsive: iframe fills the 16:9 frame.
    expect(html).toMatch(/width\s*:\s*100%/);
    expect(html).toMatch(/height\s*:\s*100%/);
  });

  it('runtime web iframe has no fixed width/height/minHeight', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    resolveMock.mockResolvedValue(backendResolve('dQw4w9WgXcQ'));
    act(() => {
      useYouTubePlayerStore.setState({ currentVideo: null, isPlaying: false });
    });
    const { getByTestId } = render(<YouTubePlayer video={vid()} />);
    // Web path renders a DOM iframe inside the frame; the RN tree still
    // exposes the player container. Assert the container mounts and the
    // source-level web branch carries no fixed pixels.
    await waitFor(() => expect(getByTestId('youtube-player')).toBeTruthy());
    const src = stripComments(readPlayerSource());
    const webBlock = src.slice(src.indexOf('webIframe'), src.indexOf('if (!video)'));
    expect(webBlock).not.toContain('width="480"');
    expect(webBlock).not.toContain('height="270"');
    expect(webBlock).not.toMatch(/minHeight\s*:/);
    expect(webBlock).toMatch(/width\s*:\s*['"]100%['"]/);
    jest.replaceProperty(Platform, 'OS', 'ios');
  });
});

describe('REQ-2 single WebView invariant', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'ios');
    useYouTubePlayerStore.setState({ currentVideo: null, isPlaying: false });
    resolveMock.mockResolvedValue(backendResolve('dQw4w9WgXcQ'));
  });

  it('source mounts exactly one <WebView (single player)', () => {
    const src = readPlayerSource();
    const count = (src.match(/<WebView/g) || []).length;
    expect(count).toBe(1);
  });

  it('renders exactly one inline WebView, never one per row', async () => {
    const { getByTestId, queryAllByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    expect(queryAllByTestId('youtube-player-webview')).toHaveLength(1);
  });

  it('switching videos reuses the single WebView (no duplicate mount)', async () => {
    const { getByTestId, queryAllByTestId, rerender } = render(
      <YouTubePlayer video={vid('AAAAAAAAAAA', 'First')} />,
    );
    resolveMock.mockResolvedValueOnce(backendResolve('BBBBBBBBBBB'));
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    rerender(<YouTubePlayer video={vid('BBBBBBBBBBB', 'Second')} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    expect(queryAllByTestId('youtube-player-webview')).toHaveLength(1);
  });
});

describe('REQ-3 MiniYouTubeOverlay: global mount + drag + snap + expand/collapse/close', () => {
  it('MiniYouTubeOverlay module exists under src/', () => {
    const found = findOverlayPath();
    expect(found).not.toBeNull();
  });

  it('overlay is mounted globally (App.tsx or RootNavigator, outside screens)', () => {
    const app = readText(appSourcePath);
    const nav = readText(rootNavSourcePath);
    const globallyMounted =
      app.includes('MiniYouTubeOverlay') || nav.includes('MiniYouTubeOverlay');
    expect(globallyMounted).toBe(true);
  });

  it('overlay supports drag (gesture-handler / PanResponder / reanimated gesture)', () => {
    const overlay = findOverlayPath();
    expect(overlay).not.toBeNull();
    const src = overlay ? readText(overlay) : '';
    const hasDrag =
      src.includes('PanGestureHandler') ||
      src.includes('Gesture.Pan') ||
      src.includes('PanResponder') ||
      (src.includes('gesture-handler') && src.toLowerCase().includes('pan')) ||
      (src.includes('reanimated') && src.toLowerCase().includes('gesture'));
    expect(src).toMatch(/drag|pan|gesture/i);
    expect(hasDrag).toBe(true);
  });

  it('overlay supports snap points (snap / snapPoint / snapTo)', () => {
    const overlay = findOverlayPath();
    expect(overlay).not.toBeNull();
    const src = overlay ? readText(overlay) : '';
    expect(src).toMatch(/snap/i);
  });

  it('overlay supports expand / collapse / close actions + testIDs', () => {
    const overlay = findOverlayPath();
    expect(overlay).not.toBeNull();
    const src = overlay ? readText(overlay) : '';
    expect(src).toMatch(/expand/i);
    expect(src).toMatch(/collaps|minimiz/i);
    expect(src).toMatch(/close/i);
    const hasIds =
      src.includes('mini-youtube-expand') ||
      src.includes('miniyoutube-expand') ||
      src.includes('mini-youtube-minimize') ||
      src.includes('miniyoutube-minimize') ||
      src.includes('mini-youtube-collapse') ||
      src.includes('miniyoutube-collapse') ||
      src.includes('mini-youtube-close') ||
      src.includes('miniyoutube-close') ||
      (src.includes('expand') && src.includes('testID'));
    expect(hasIds).toBe(true);
  });
});

describe('REQ-4 navigation Home/Songs/Library keeps playing (global, not screen-local)', () => {
  it('Main tabs Home + Songs + Library all exist', () => {
    const nav = readText(rootNavSourcePath);
    expect(nav).toContain('name="Home"');
    expect(nav).toContain('name="Songs"');
    expect(nav).toContain('name="Library"');
  });

  it('youtube store survives screen unmount (navigation does not clear video)', async () => {
    const { unmount } = render(<YouTubePlayer video={vid()} />);
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('dQw4w9WgXcQ');
    unmount();
    // Store-level persistence: navigating Home<->Songs<->Library must not
    // wipe the queue. The WebView itself must live in the global overlay
    // (REQ-3) so unmounting one screen never tears down playback.
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('dQw4w9WgXcQ');
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('player is global: YouTubeSongsScreen is not the exclusive owner', () => {
    const app = readText(appSourcePath);
    const nav = readText(rootNavSourcePath);
    const globalOwnsPlayer =
      app.includes('MiniYouTubeOverlay') || nav.includes('MiniYouTubeOverlay');
    // Screen may still render lists, but the single WebView must live
    // globally. If only the screen imports YouTubePlayer, tab switches
    // (Home/Songs/Library) unmount the WebView and kill playback.
    expect(globalOwnsPlayer).toBe(true);
  });
});

describe('REQ-5 validation paths / edge cases / failure behavior (regression)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'ios');
    useYouTubePlayerStore.setState({ currentVideo: null, isPlaying: false });
  });

  it('sanitize trims whitespace + lowercases host before canonicalizing', () => {
    const url = sanitizeEmbedUrl('  HTTPS://WWW.YOUTUBE.COM/embed/dQw4w9WgXcQ?rel=1  ', 'dQw4w9WgXcQ');
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('www.youtube.com');
    expect(parsed.searchParams.get('rel')).toBe('0');
    expect(parsed.searchParams.get('enablejsapi')).toBe('1');
  });

  it.each([
    ['m.youtube.com mobile host', 'https://m.youtube.com/embed/dQw4w9WgXcQ'],
    ['bare youtube.com host', 'https://youtube.com/embed/dQw4w9WgXcQ'],
  ])('sanitize accepts %s and canonicalizes to www', (_label, raw) => {
    const parsed = new URL(sanitizeEmbedUrl(raw, 'dQw4w9WgXcQ'));
    expect(parsed.hostname).toBe('www.youtube.com');
    expect(parsed.pathname).toBe('/embed/dQw4w9WgXcQ');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['non-string number', 123 as any],
    ['non-string object', {} as any],
  ])('sanitize falls back to canonical for %s', (_label, raw: any) => {
    expect(sanitizeEmbedUrl(raw, 'dQw4w9WgXcQ')).toBe(buildYouTubeEmbedUrl('dQw4w9WgXcQ'));
  });

  it('autoplay=false drops mute but keeps enablejsapi/origin/playsinline', () => {
    const parsed = new URL(sanitizeEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?mute=1', 'dQw4w9WgXcQ', false));
    expect(parsed.searchParams.get('autoplay')).toBe('0');
    expect(parsed.searchParams.get('mute')).toBeNull();
    expect(parsed.searchParams.get('enablejsapi')).toBe('1');
    expect(parsed.searchParams.get('origin')).toBe('https://app.spotibase');
  });

  it('buildYouTubeEmbedUrl strict-validates hostile videoIds', () => {
    // P0 strict videoId: hostile ids throw (fail fast, no param leakage).
    expect(() => buildYouTubeEmbedUrl('a/b?c=d&e=f', true)).toThrow(/Invalid YouTube videoId/);
  });

  it('youtubeWatchUrl strict-validates hostile ids', () => {
    expect(() => youtubeWatchUrl('a&b=c')).toThrow(/Invalid YouTube videoId/);
  });

  it('closePlayer is idempotent (double close stays unloaded)', () => {
    useYouTubePlayerStore.getState().playVideo(vid());
    useYouTubePlayerStore.getState().closePlayer();
    useYouTubePlayerStore.getState().closePlayer();
    expect(useYouTubePlayerStore.getState().currentVideo).toBeNull();
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
  });

  it('resume without a loaded video is a no-op', () => {
    useYouTubePlayerStore.getState().resumeVideo();
    expect(useYouTubePlayerStore.getState().currentVideo).toBeNull();
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
  });

  it('rapid video switches are last-wins (single-player)', () => {
    const s = useYouTubePlayerStore.getState();
    s.playVideo(vid('AAAAAAAAAAA', 'First'));
    useYouTubePlayerStore.getState().playVideo(vid('BBBBBBBBBBB', 'Second'));
    useYouTubePlayerStore.getState().playVideo(vid('CCCCCCCCCCC', 'Third'));
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('CCCCCCCCCCC');
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('malformed / unknown WebView messages are ignored (no fallback, no crash)', async () => {
    resolveMock.mockResolvedValue(backendResolve('dQw4w9WgXcQ'));
    const { getByTestId, queryByTestId } = render(<YouTubePlayer video={vid()} />);
    await waitFor(() => expect(getByTestId('youtube-player-webview')).toBeTruthy());
    const wv: any = getByTestId('youtube-player-webview');
    act(() => {
      wv.props.onMessage({ nativeEvent: { data: 'not-json{{{' } });
      wv.props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'unknown', code: 999 }) } });
      wv.props.onMessage({ nativeEvent: { data: '' } });
      wv.props.onMessage({ nativeEvent: {} });
    });
    expect(queryByTestId('youtube-player-fallback')).toBeNull();
    expect(getByTestId('youtube-player-webview')).toBeTruthy();
  });

  it('renders null without a video and never resolves', () => {
    resolveMock.mockClear();
    const { toJSON } = render(<YouTubePlayer video={null} />);
    expect(toJSON()).toBeNull();
    expect(resolveMock).not.toHaveBeenCalled();
  });
});
