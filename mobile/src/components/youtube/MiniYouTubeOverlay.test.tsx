import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import { youtubeApi } from '../../api/youtubeApi';
import type { YouTubeVideo } from '../../types/youtube';

// Runtime contract for the global MiniYouTubeOverlay (Expo SDK 57):
// single WebView, drag + edge snap, expand/minimize/close, and persistence
// across Home/Songs/Library (global mount in RootNavigator).
//
// Watch-page mode (watchPageActive + expanded) renders the REAL YouTube-like
// full page: video pinned at the very top + Up next suggestions below the
// title. Other screens keep the bottom-anchored sheet / mini / fullscreen.
jest.mock('../youtube/YouTubePlayer', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  const Stub = ({ video, testID }: any) =>
    video ? (
      <View testID={testID ?? 'youtube-player'}>
        <Text>{`stub-player:${video.title}`}</Text>
      </View>
    ) : null;
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

const searchMock = youtubeApi.search as unknown as jest.Mock;

const vid = (videoId = 'dQw4w9WgXcQ', title = 'Lo-Fi Beats'): YouTubeVideo => ({
  videoId,
  title,
  channelTitle: 'Chill Lab',
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
});

describe('MiniYouTubeOverlay global player', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('expanded mode shows the single player + minimize (close lives in player/mini)', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId, queryAllByTestId, queryByTestId } = render(<MiniYouTubeOverlay />);
    expect(getByTestId('mini-youtube-overlay')).toBeTruthy();
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    expect(getByTestId('mini-youtube-minimize')).toBeTruthy();
    // Expanded close is delegated to the embedded YouTubePlayer onClose
    // (real player renders its own Close button); mini mode owns the
    // explicit mini-youtube-close control. Either location must unload.
    expect(queryByTestId('mini-youtube-close')).toBeNull();
    // Single WebView: exactly one embedded player instance.
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
  });

  it('minimize collapses to mini bar with play/pause + expand + close', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    fireEvent.press(getByTestId('mini-youtube-minimize'));
    expect(useYouTubePlayerStore.getState().mode).toBe('mini');
    expect(getByTestId('mini-youtube-play-pause')).toBeTruthy();
    expect(getByTestId('mini-youtube-expand')).toBeTruthy();
    expect(getByTestId('mini-youtube-close')).toBeTruthy();
    // Player instance survives collapse (no remount kill).
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
  });

  it('expand returns from mini to expanded sheet', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    expect(getByTestId('mini-youtube-expand')).toBeTruthy();
    fireEvent.press(getByTestId('mini-youtube-expand'));
    expect(useYouTubePlayerStore.getState().mode).toBe('expanded');
    expect(getByTestId('mini-youtube-minimize')).toBeTruthy();
  });

  it('close unloads the video from anywhere (mini button + expanded player close)', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    // Mini mode owns the explicit close control.
    fireEvent.press(getByTestId('mini-youtube-close'));
    expect(useYouTubePlayerStore.getState().currentVideo).toBeNull();
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);

    // Expanded mode delegates close to the embedded YouTubePlayer onClose;
    // store-level close must also unload (covers both entry points).
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

  it('mini play/pause toggles presentation without unloading', () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
    });
    const { getByTestId } = render(<MiniYouTubeOverlay />);
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    fireEvent.press(getByTestId('mini-youtube-play-pause'));
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
    expect(useYouTubePlayerStore.getState().currentVideo).not.toBeNull();
    fireEvent.press(getByTestId('mini-youtube-play-pause'));
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
  });

  it('switching videos keeps a single player (last-wins, still one instance)', async () => {
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid('AAAAAAAAAAA', 'First'));
    });
    const { getByTestId, queryAllByTestId, getByText } = render(<MiniYouTubeOverlay />);
    expect(getByText('stub-player:First')).toBeTruthy();
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid('BBBBBBBBBBB', 'Second'));
    });
    await waitFor(() => expect(getByText('stub-player:Second')).toBeTruthy());
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('BBBBBBBBBBB');
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
    expect(getByTestId('mini-youtube-overlay')).toBeTruthy();
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

  it('fresh playVideo always opens expanded (predictable entry point)', () => {
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
    // Let any stray effect settle, then assert the sheet never hit search.
    await act(async () => {});
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe('MiniYouTubeOverlay watch page (full-screen layout)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('watch expanded pins video at top with Up next suggestions below (single player)', async () => {
    const other1 = vid('BBBBBBBBBBB', 'Related One');
    const other2 = vid('CCCCCCCCCCC', 'Related Two');
    searchMock.mockResolvedValue({ data: { videos: [vid(), other1, other2] } });
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.setState({ watchPageActive: true });
    });
    const { getByTestId, getByText, queryAllByTestId } = render(<MiniYouTubeOverlay />);
    // Full-page watch chrome: video pinned at top + transport + title.
    expect(getByTestId('mini-youtube-overlay')).toBeTruthy();
    expect(getByTestId('mini-youtube-watch-video')).toBeTruthy();
    expect(getByTestId('mini-youtube-player')).toBeTruthy();
    expect(getByTestId('mini-youtube-play-pause')).toBeTruthy();
    expect(getByTestId('mini-youtube-minimize')).toBeTruthy();
    expect(getByTestId('mini-youtube-fullscreen')).toBeTruthy();
    expect(getByTestId('mini-youtube-now-playing-title')).toBeTruthy();
    expect(getByTestId('mini-youtube-drag-handle')).toBeTruthy();
    // Up next below the title, current video excluded.
    await waitFor(() => expect(getByText('Up next')).toBeTruthy());
    await waitFor(() => expect(getByTestId('mini-youtube-suggestion-BBBBBBBBBBB')).toBeTruthy());
    expect(getByTestId('mini-youtube-suggestion-CCCCCCCCCCC')).toBeTruthy();
    // Single WebView invariant holds on the watch page.
    expect(queryAllByTestId('mini-youtube-player')).toHaveLength(1);
    expect(searchMock).toHaveBeenCalled();
  });

  it('tapping a suggestion last-wins into the single player', async () => {
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
    // Mini stays a mini card even with watchPageActive true.
    act(() => {
      useYouTubePlayerStore.getState().playVideo(vid());
      useYouTubePlayerStore.getState().setMode('mini');
      useYouTubePlayerStore.setState({ watchPageActive: true });
    });
    const mini = render(<MiniYouTubeOverlay />);
    expect(mini.getByTestId('mini-youtube-expand')).toBeTruthy();
    expect(mini.getByTestId('mini-youtube-close')).toBeTruthy();
    expect(mini.queryByText('Up next')).toBeNull();
    mini.unmount();

    // Fullscreen stays fullscreen (exit + progress) even with the flag.
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
