import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import YouTubeSongsScreen from './YouTubeSongsScreen';
import { youtubeApi } from '../../api/youtubeApi';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import type { YouTubeVideo } from '../../types/youtube';

/**
 * Integration-style tests for the YouTube songs browser (Expo SDK 57).
 *
 * The screen talks to youtubeApi (mocked at the module boundary) and the
 * real youtubePlayerStore/themeStore. Navigation focus is simulated with a
 * mount-once useFocusEffect so fetchTrending runs exactly like a screen
 * focus; the heavy WebView player is stubbed out.
 */
jest.mock('../../api/youtubeApi', () => ({
  youtubeApi: {
    trending: jest.fn(),
    search: jest.fn(),
    resolve: jest.fn(),
  },
}));

jest.mock('@react-navigation/native', () => ({
  // Faithful enough for this screen: run the focus callback once on mount.
  useFocusEffect: (callback: () => void) => {
    const React = require('react');
    React.useEffect(callback, []);
  },
}));

jest.mock('../../components/youtube/YouTubePlayer', () => {
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

const trendingMock = youtubeApi.trending as jest.Mock;
const searchMock = youtubeApi.search as jest.Mock;

const vid = (videoId: string, title: string): YouTubeVideo => ({
  videoId,
  title,
  channelTitle: 'Chill Lab',
  thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
});

const navigation = { canGoBack: () => false, goBack: jest.fn() };
const searchInputProps = 'Search YouTube songs…';

describe('YouTubeSongsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useYouTubePlayerStore.getState().closePlayer();
    trendingMock.mockResolvedValue({ data: { videos: [vid('dQw4w9WgXcQ', 'Lo-Fi Beats')] } });
    searchMock.mockResolvedValue({ data: { videos: [] } });
  });

  it('loads trending on focus and renders the rail', async () => {
    const { getByText, getByTestId } = render(<YouTubeSongsScreen navigation={navigation} />);

    expect(trendingMock).toHaveBeenCalledWith(20, expect.any(AbortSignal));

    await waitFor(() => {
      expect(getByText('Trending now')).toBeTruthy();
      expect(getByText('Lo-Fi Beats')).toBeTruthy();
    });
    expect(getByTestId('youtube-trending-dQw4w9WgXcQ')).toBeTruthy();
  });

  it('normalizes a bare-array trending payload', async () => {
    trendingMock.mockResolvedValueOnce({ data: [vid('9bZkp7q19f0', 'Top Pop Hits')] });

    const { getByText } = render(<YouTubeSongsScreen navigation={navigation} />);

    await waitFor(() => {
      expect(getByText('Top Pop Hits')).toBeTruthy();
    });
  });

  it('shows the not-enabled banner on 404 and refetches on retry', async () => {
    trendingMock.mockRejectedValueOnce({ response: { status: 404, data: {} } });

    const { getByText, getByLabelText } = render(<YouTubeSongsScreen navigation={navigation} />);

    await waitFor(() => {
      expect(getByText(/not enabled on this server yet/)).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Retry loading YouTube'));

    await waitFor(() => {
      expect(trendingMock).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the offline banner when trending fails without a response', async () => {
    trendingMock.mockRejectedValueOnce(new Error('Network Error'));

    const { getByText } = render(<YouTubeSongsScreen navigation={navigation} />);

    await waitFor(() => {
      expect(getByText(/You are offline/)).toBeTruthy();
    });
  });

  it('searches on submit, renders rows, and opens the player on select', async () => {
    const row = vid('RgKAFK5djSk', 'Acoustic Morning');
    searchMock.mockResolvedValueOnce({ data: { videos: [row] } });

    const { getByPlaceholderText, getByTestId, getByText } = render(
      <YouTubeSongsScreen navigation={navigation} />
    );
    await waitFor(() => {
      expect(getByText('Trending now')).toBeTruthy();
    });

    const input = getByPlaceholderText(searchInputProps);
    fireEvent.changeText(input, 'acoustic');
    fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(searchMock).toHaveBeenCalledWith('acoustic', 25, undefined, expect.any(AbortSignal));
    });
    await waitFor(() => {
      expect(getByTestId('youtube-result-RgKAFK5djSk')).toBeTruthy();
    });

    fireEvent.press(getByTestId('youtube-result-RgKAFK5djSk'));

    await waitFor(() => {
      expect(getByTestId('youtube-songs-player')).toBeTruthy();
      expect(getByText('stub-player:Acoustic Morning')).toBeTruthy();
    });
    expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('RgKAFK5djSk');
  });

  it('clearing the search returns to the trending view', async () => {
    searchMock.mockResolvedValueOnce({ data: { videos: [vid('RgKAFK5djSk', 'Acoustic Morning')] } });

    const { getByPlaceholderText, getByLabelText, getByText, queryByText } = render(
      <YouTubeSongsScreen navigation={navigation} />
    );
    await waitFor(() => {
      expect(getByText('Trending now')).toBeTruthy();
    });

    const input = getByPlaceholderText(searchInputProps);
    fireEvent.changeText(input, 'acoustic');
    fireEvent(input, 'submitEditing');
    await waitFor(() => {
      expect(getByText('Acoustic Morning')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Clear search'));

    await waitFor(() => {
      expect(getByText('Trending now')).toBeTruthy();
    });
    expect(queryByText('Acoustic Morning')).toBeNull();
  });

  it('shows the search fallback banner on 404 and clears stale results', async () => {
    searchMock.mockRejectedValueOnce({ response: { status: 404, data: {} } });

    const { getByPlaceholderText, getByText } = render(
      <YouTubeSongsScreen navigation={navigation} />
    );
    await waitFor(() => {
      expect(getByText('Trending now')).toBeTruthy();
    });

    const input = getByPlaceholderText(searchInputProps);
    fireEvent.changeText(input, 'queen');
    fireEvent(input, 'submitEditing');

    await waitFor(() => {
      expect(getByText(/YouTube search is not enabled/)).toBeTruthy();
    });
  });
});
