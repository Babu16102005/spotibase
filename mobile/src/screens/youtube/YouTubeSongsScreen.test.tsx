import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import YouTubeSongsScreen from './YouTubeSongsScreen';
import { youtubeApi } from '../../api/youtubeApi';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import type { YouTubeVideo } from '../../types/youtube';

/**
 * Integration-style tests for the Tamil-first YouTube songs browser
 * (Expo SDK 57, single vertical FlatList — no trending rail).
 *
 * The screen talks to youtubeApi.search (mocked at the module boundary) and
 * the real youtubePlayerStore/themeStore. Navigation focus is simulated with
 * a mount-once useFocusEffect so the Tamil feed loads exactly like a screen
 * focus. Playback lives in the global MiniYouTubeOverlay (mounted in
 * RootNavigator) — the screen is list-only and never mounts a WebView.
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
  YOUTUBE_DEFAULT_TAMIL_QUERY: 'Tamil songs',
}));

jest.mock('@react-navigation/native', () => ({
  // Faithful enough for this screen: run the focus callback once on mount.
  useFocusEffect: (callback: () => void) => {
    const React = require('react');
    React.useEffect(callback, []);
  },
}));

const searchMock = youtubeApi.search as jest.Mock;

const vid = (videoId: string, title: string): YouTubeVideo => ({
  videoId,
  title,
  channelTitle: 'Chill Lab',
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
});

const navigation = { canGoBack: () => false, goBack: jest.fn() };
const searchInputProps = 'Search Tamil & Indian songs…';
const tamilHeading = 'Tamil songs';
const tamilQuery = 'Tamil songs';
const searchLocale = { regionCode: 'IN', relevanceLanguage: 'ta', hl: 'ta' };

describe('YouTubeSongsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useYouTubePlayerStore.getState().closePlayer();
    searchMock.mockResolvedValue({ data: { videos: [vid('dQw4w9WgXcQ', 'Lo-Fi Beats')] } });
  });

  it('auto-loads the Tamil feed on focus and renders rows (no rail)', async () => {
    const { getByText, getByTestId, queryByTestId } = render(
      <YouTubeSongsScreen navigation={navigation} />
    );

    expect(searchMock).toHaveBeenCalledWith(
      tamilQuery,
      25,
      undefined,
      expect.any(AbortSignal),
      searchLocale
    );

    await waitFor(() => {
      expect(getByText(tamilHeading)).toBeTruthy();
      expect(getByText('Lo-Fi Beats')).toBeTruthy();
    });
    expect(getByTestId('youtube-songs-list')).toBeTruthy();
    expect(getByTestId('youtube-result-dQw4w9WgXcQ')).toBeTruthy();
    // No horizontal rail cards remain.
    expect(queryByTestId('youtube-trending-dQw4w9WgXcQ')).toBeNull();
  });

  it('normalizes a bare-array payload', async () => {
    searchMock.mockResolvedValueOnce({ data: [vid('9bZkp7q19f0', 'Top Pop Hits')] });

    const { getByText } = render(<YouTubeSongsScreen navigation={navigation} />);

    await waitFor(() => {
      expect(getByText('Top Pop Hits')).toBeTruthy();
    });
  });

  it('shows the not-enabled banner on 404 and refetches on retry', async () => {
    searchMock.mockRejectedValueOnce({ response: { status: 404, data: {} } });

    const { getByText, getByLabelText } = render(<YouTubeSongsScreen navigation={navigation} />);

    await waitFor(() => {
      expect(getByText(/not enabled on this server yet/)).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Retry loading YouTube'));

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the offline banner when the feed fails without a response', async () => {
    searchMock.mockRejectedValueOnce(new Error('Network Error'));

    const { getByText } = render(<YouTubeSongsScreen navigation={navigation} />);

    await waitFor(() => {
      expect(getByText(/You are offline/)).toBeTruthy();
    });
  });

  it('searches on submit, renders rows, and loads the global player on select', async () => {
    const row = vid('RgKAFK5djSk', 'Acoustic Morning');
    searchMock.mockResolvedValueOnce({ data: { videos: [vid('dQw4w9WgXcQ', 'Lo-Fi Beats')] } });
    searchMock.mockResolvedValueOnce({ data: { videos: [row] } });

    const { getByPlaceholderText, getByTestId, getByText, queryByTestId } = render(
      <YouTubeSongsScreen navigation={navigation} />
    );
    await waitFor(() => {
      expect(getByText(tamilHeading)).toBeTruthy();
    });

    const input = getByPlaceholderText(searchInputProps);
    fireEvent.changeText(input, 'acoustic');
    fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledWith(
        'acoustic',
        25,
        undefined,
        expect.any(AbortSignal),
        searchLocale
      );
    });
    await waitFor(() => {
      expect(getByTestId('youtube-result-RgKAFK5djSk')).toBeTruthy();
    });

    fireEvent.press(getByTestId('youtube-result-RgKAFK5djSk'));

    // List-only screen: no inline WebView here — selection loads the video
    // into the global MiniYouTubeOverlay (single WebView in RootNavigator).
    await waitFor(() => {
      expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('RgKAFK5djSk');
    });
    expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    expect(queryByTestId('youtube-songs-player')).toBeNull();
    expect(getByTestId('youtube-result-RgKAFK5djSk')).toBeTruthy();
  });

  it('clearing the search returns to the Tamil feed, not an empty state', async () => {
    searchMock.mockResolvedValueOnce({ data: { videos: [vid('dQw4w9WgXcQ', 'Lo-Fi Beats')] } });
    searchMock.mockResolvedValueOnce({ data: { videos: [vid('RgKAFK5djSk', 'Acoustic Morning')] } });
    searchMock.mockResolvedValueOnce({ data: { videos: [vid('dQw4w9WgXcQ', 'Lo-Fi Beats')] } });

    const { getByPlaceholderText, getByLabelText, getByText, queryByText } = render(
      <YouTubeSongsScreen navigation={navigation} />
    );
    await waitFor(() => {
      expect(getByText(tamilHeading)).toBeTruthy();
    });

    const input = getByPlaceholderText(searchInputProps);
    fireEvent.changeText(input, 'acoustic');
    fireEvent(input, 'submitEditing');
    await waitFor(() => {
      expect(getByText('Acoustic Morning')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Clear search'));

    await waitFor(() => {
      // Tamil feed refetch on clear.
      expect(searchMock).toHaveBeenLastCalledWith(
        tamilQuery,
        25,
        undefined,
        expect.any(AbortSignal),
        searchLocale
      );
    });
    await waitFor(() => {
      expect(getByText(tamilHeading)).toBeTruthy();
      expect(getByText('Lo-Fi Beats')).toBeTruthy();
    });
    expect(queryByText('Acoustic Morning')).toBeNull();
  });

  it('shows the search fallback banner on 404 and keeps the Tamil feed', async () => {
    searchMock.mockResolvedValueOnce({ data: { videos: [vid('dQw4w9WgXcQ', 'Lo-Fi Beats')] } });
    searchMock.mockRejectedValueOnce({ response: { status: 404, data: {} } });

    const { getByPlaceholderText, getByText } = render(
      <YouTubeSongsScreen navigation={navigation} />
    );
    await waitFor(() => {
      expect(getByText(tamilHeading)).toBeTruthy();
    });

    const input = getByPlaceholderText(searchInputProps);
    fireEvent.changeText(input, 'queen');
    fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(getByText(/not enabled on this server yet/)).toBeTruthy();
    });
  });

  it('paginates with pageToken on end-reached and dedupes by videoId', async () => {
    const first = vid('dQw4w9WgXcQ', 'Lo-Fi Beats');
    const second = vid('9bZkp7q19f0', 'Top Pop Hits');
    searchMock.mockResolvedValueOnce({ data: { videos: [first], nextPageToken: 'TOKEN2' } });
    searchMock.mockResolvedValueOnce({
      data: { videos: [first, second], nextPageToken: null },
    });

    const { getByText, getByTestId } = render(<YouTubeSongsScreen navigation={navigation} />);
    await waitFor(() => {
      expect(getByText('Lo-Fi Beats')).toBeTruthy();
    });

    const list = getByTestId('youtube-songs-list');
    fireEvent(list, 'endReached');

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledWith(
        tamilQuery,
        25,
        'TOKEN2',
        expect.any(AbortSignal),
        searchLocale
      );
    });
    await waitFor(() => {
      expect(getByText('Top Pop Hits')).toBeTruthy();
    });
    // Dedupe: the repeated first video appears exactly once.
    expect(getByTestId('youtube-result-dQw4w9WgXcQ')).toBeTruthy();
  });
});
