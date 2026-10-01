/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories must use require (hoisted, no top-level imports allowed) */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import HomeScreen from './HomeScreen';
import { homeApi } from '../../api/client';
import {
  readHomeFeed,
  isHomeFeedFresh,
  readHomeTier,
  isHomeTierFresh,
} from '../../cache/homeFeedCache';
import { useAuthStore } from '../../store';
import { makeSong } from '../../test/fixtures';

/**
 * Integration tests for the HomeScreen "YouTube beside Recently Played" spec
 * with Trending Now as header-only (Expo SDK 57 / jest-expo, no network).
 *
 * Spec under verification:
 *  1. The `recently-played` SONG section renders a `YouTube` *button* pill
 *     (SectionHeader actionVariant="button", testID
 *     `recently-played-youtube-button`) that navigates to `YouTubeSongs`.
 *  2. The `trending` SONG section is header-only — it renders its title (and
 *     subtitle/cards) with NO `YouTube` action of any variant (no pill, no
 *     text link) and never navigates to `YouTubeSongs`.
 *  3. With both sections present there is exactly ONE `YouTube` node — the
 *     Recently Played pill.
 *  4. Empty paths render no section and therefore no `YouTube` action:
 *     empty `recently-played` (items: []), empty `trending` (items: []),
 *     and a feed with no sections. renderSection returns null for these.
 *
 * The real SectionHeader is kept (integration boundary); heavy cards, the
 * greeting header and skeletons are stubbed. Network + cache are mocked so
 * the feed paints synchronously from readHomeFeed (legacy critical seed for
 * useHomeTiers). Each test settles the staged tier fetch + deferred heavy
 * mount inside act so no state update escapes the test scope.
 */

jest.mock('../../api/client', () => ({
  homeApi: {
    getHome: jest.fn(),
    getHomeTier: jest.fn(() =>
      Promise.resolve({ data: { greeting: '', sections: [] } })
    ),
  },
}));

jest.mock('../../cache/homeFeedCache', () => {
  const actual = jest.requireActual('../../cache/homeFeedCache');
  return {
    ...actual,
    isHomeFeedFresh: jest.fn(() => true),
    readHomeFeed: jest.fn(() => null),
    writeHomeFeed: jest.fn(),
    readHomeTier: jest.fn(() => null),
    writeHomeTier: jest.fn(),
    isHomeTierFresh: jest.fn(() => true),
  };
});

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(callback, []);
  },
}));

jest.mock('../../components/SongCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ song }: any) =>
      React.createElement(Text, null, `song:${song?.title ?? song?.id}`),
  };
});

jest.mock('../../components/AlbumCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ album }: any) =>
      React.createElement(Text, null, `album:${album?.name ?? album?.id}`),
  };
});

jest.mock('../../components/ArtistCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ artist }: any) =>
      React.createElement(Text, null, `artist:${artist?.name ?? artist?.id}`),
  };
});

jest.mock('../../components/PlaylistCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    __esModule: true,
    default: ({ playlist }: any) =>
      React.createElement(Text, null, `playlist:${playlist?.name ?? playlist?.id}`),
  };
});

jest.mock('../../components/GreetingHeader', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement(React.Fragment, null),
  };
});

jest.mock('../../components/SkeletonLoader', () => {
  const React = require('react');
  return {
    __esModule: true,
    CardSkeleton: () => React.createElement(React.Fragment, null),
    SongSkeleton: () => React.createElement(React.Fragment, null),
  };
});

const mockedReadHomeFeed = readHomeFeed as jest.Mock;
const mockedIsFresh = isHomeFeedFresh as jest.Mock;
const mockedGetHomeTier = homeApi.getHomeTier as jest.Mock;
const mockedReadHomeTier = readHomeTier as jest.Mock;
const mockedIsTierFresh = isHomeTierFresh as jest.Mock;

/**
 * Settle the concurrent tier fetch (critical + secondary + heavy) and the
 * deferred heavy mount so assertions run on the final paint with no state
 * updates escaping act.
 */
const settleTiers = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/**
 * Settle through the single automatic retry (~500ms delay + refetch) so
 * error+empty tiers reach their final `error` paint with inline retry rows.
 */
const settleThroughRetry = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 800));
  });

const recentlyPlayedSection = () => ({
  id: 'recently-played',
  title: 'Recently Played',
  type: 'SONG',
  subtitle: 'Your listening history',
  items: [
    makeSong({ id: 's1', title: 'Song One' }),
    makeSong({ id: 's2', title: 'Song Two' }),
  ],
});

const trendingSection = () => ({
  id: 'trending',
  title: 'Trending Now',
  type: 'SONG',
  subtitle: 'Most played songs',
  items: [makeSong({ id: 't1', title: 'Trend One' })],
});

const feedWith = (sections: any[]) => ({
  greeting: 'Good Morning',
  sections,
});

describe('HomeScreen YouTube beside Recently Played (Trending header-only)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsFresh.mockReturnValue(true);
    mockedReadHomeFeed.mockReturnValue(null);
    useAuthStore.setState({ isAuthenticated: true, isLoading: false } as any);
  });

  it('renders a YouTube button pill beside Recently Played that navigates to YouTubeSongs', async () => {
    mockedReadHomeFeed.mockReturnValue(feedWith([recentlyPlayedSection()]));
    const navigation = { navigate: jest.fn() };

    const { getByText, getByTestId } = render(<HomeScreen navigation={navigation} />);
    await settleTiers();

    expect(getByText('Recently Played')).toBeTruthy();
    // Button variant: pill testID + visible label.
    const pill = getByTestId('recently-played-youtube-button');
    expect(pill).toBeTruthy();
    expect(pill.props.accessibilityLabel).toBe('Open YouTube songs');
    expect(getByText('YouTube')).toBeTruthy();

    fireEvent.press(pill);
    expect(navigation.navigate).toHaveBeenCalledWith('YouTubeSongs');
  });

  it('renders Trending Now as header-only (title, no YouTube action)', async () => {
    mockedReadHomeFeed.mockReturnValue(feedWith([trendingSection()]));
    const navigation = { navigate: jest.fn() };

    const { getByText, queryByText, queryByTestId, getByTestId } = render(
      <HomeScreen navigation={navigation} />
    );
    await settleTiers();

    // Header-only: title (+ cards) render, but no YouTube in any variant.
    expect(getByText('Trending Now')).toBeTruthy();
    expect(queryByText('YouTube')).toBeNull();
    expect(queryByTestId('recently-played-youtube-button')).toBeNull();
    // No pressable YouTube exists, so nothing can navigate.
    expect(() => getByTestId('trending-youtube-link')).toThrow();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('renders exactly one YouTube (Recently Played pill) when both sections are present', async () => {
    mockedReadHomeFeed.mockReturnValue(
      feedWith([recentlyPlayedSection(), trendingSection()])
    );
    const navigation = { navigate: jest.fn() };

    const { getByText, getAllByText, getByTestId, queryByText } = render(
      <HomeScreen navigation={navigation} />
    );
    await settleTiers();

    expect(getByText('Recently Played')).toBeTruthy();
    expect(getByText('Trending Now')).toBeTruthy();
    // Exactly one YouTube node — the Recently Played pill. Trending is
    // header-only and contributes no YouTube action.
    expect(getByTestId('recently-played-youtube-button')).toBeTruthy();
    expect(getAllByText('YouTube')).toHaveLength(1);
    expect(queryByText('Show all')).toBeNull();

    fireEvent.press(getByTestId('recently-played-youtube-button'));
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith('YouTubeSongs');
  });

  it('renders no YouTube button when Recently Played is empty (items: [])', async () => {
    mockedReadHomeFeed.mockReturnValue(
      feedWith([{ ...recentlyPlayedSection(), items: [] }])
    );
    const navigation = { navigate: jest.fn() };

    const { queryByText, queryByTestId } = render(<HomeScreen navigation={navigation} />);
    await settleTiers();

    expect(queryByText('Recently Played')).toBeNull();
    expect(queryByText('YouTube')).toBeNull();
    expect(queryByTestId('recently-played-youtube-button')).toBeNull();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('renders no YouTube action when Trending is empty (items: [])', async () => {
    mockedReadHomeFeed.mockReturnValue(
      feedWith([{ ...trendingSection(), items: [] }])
    );
    const navigation = { navigate: jest.fn() };

    const { queryByText, queryByTestId } = render(<HomeScreen navigation={navigation} />);
    await settleTiers();

    // renderSection returns null for empty items: no title, no YouTube.
    expect(queryByText('Trending Now')).toBeNull();
    expect(queryByText('YouTube')).toBeNull();
    expect(queryByTestId('recently-played-youtube-button')).toBeNull();
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('keeps only the Recently Played pill when Trending is empty', async () => {
    mockedReadHomeFeed.mockReturnValue(
      feedWith([recentlyPlayedSection(), { ...trendingSection(), items: [] }])
    );
    const navigation = { navigate: jest.fn() };

    const { getByText, getAllByText, getByTestId, queryByText } = render(
      <HomeScreen navigation={navigation} />
    );
    await settleTiers();

    expect(getByText('Recently Played')).toBeTruthy();
    expect(queryByText('Trending Now')).toBeNull();
    expect(getByTestId('recently-played-youtube-button')).toBeTruthy();
    expect(getAllByText('YouTube')).toHaveLength(1);

    fireEvent.press(getByTestId('recently-played-youtube-button'));
    expect(navigation.navigate).toHaveBeenCalledWith('YouTubeSongs');
  });

  it('renders no YouTube button when the feed has no sections', async () => {
    mockedReadHomeFeed.mockReturnValue(feedWith([]));
    const navigation = { navigate: jest.fn() };

    const { queryByText, queryByTestId } = render(<HomeScreen navigation={navigation} />);
    await settleTiers();

    expect(queryByText('YouTube')).toBeNull();
    expect(queryByTestId('recently-played-youtube-button')).toBeNull();
  });

  it('never attaches a YouTube action to non-SONG sections (regression)', async () => {
    mockedReadHomeFeed.mockReturnValue(
      feedWith([
        {
          id: 'featured-albums',
          title: 'Featured Albums',
          type: 'ALBUM',
          subtitle: "Editor's picks",
          items: [
            {
              id: 'a1',
              name: 'Album One',
              artistId: 'ar1',
              artistName: 'Artist',
              releaseDate: '2024-01-01',
              songCount: 1,
              totalDurationMs: 1,
              type: 'ALBUM',
              featured: true,
              liked: false,
              createdAt: '2024-01-01T00:00:00.000Z',
            },
          ],
        },
      ])
    );
    const navigation = { navigate: jest.fn() };

    const { getByText, queryByText, queryByTestId } = render(<HomeScreen navigation={navigation} />);
    await settleTiers();

    expect(getByText('Featured Albums')).toBeTruthy();
    expect(queryByText('YouTube')).toBeNull();
    expect(queryByTestId('recently-played-youtube-button')).toBeNull();
  });
});

describe('HomeScreen inline tier retry (error+empty)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedIsFresh.mockReturnValue(true);
    mockedReadHomeFeed.mockReturnValue(null);
    mockedReadHomeTier.mockReturnValue(null);
    mockedIsTierFresh.mockReturnValue(false);
    mockedGetHomeTier.mockImplementation(() =>
      Promise.resolve({ data: { greeting: '', sections: [] } })
    );
    useAuthStore.setState({ isAuthenticated: true, isLoading: false } as any);
  });

  it('renders an inline retry row when a tier errors with empty sections', async () => {
    const serverError = () => {
      const err: any = new Error('server error');
      err.response = { status: 500 };
      return Promise.reject(err);
    };
    mockedGetHomeTier.mockImplementation(serverError);
    const navigation = { navigate: jest.fn() };

    const { getByTestId, getByText } = render(
      <HomeScreen navigation={navigation} />
    );
    // Initial failure + ~500ms automatic retry + final error paint.
    await settleThroughRetry();

    const retry = getByTestId('home-retry-critical');
    expect(retry).toBeTruthy();
    expect(retry.props.accessibilityLabel).toBe(
      'Retry loading critical sections'
    );
    expect(getByText("Couldn't load Critical - Tap to retry")).toBeTruthy();
  });

  it('tapping the retry row refetches the tier and paints on success', async () => {
    let criticalCalls = 0;
    mockedGetHomeTier.mockImplementation((tier: string) => {
      if (tier === 'critical') {
        criticalCalls += 1;
        // First two attempts (initial + automatic retry) fail; the manual
        // retry (third call) succeeds.
        if (criticalCalls <= 2) {
          const err: any = new Error('flaky timeout');
          err.code = 'ECONNABORTED';
          return Promise.reject(err);
        }
        return Promise.resolve({
          data: {
            greeting: 'Good Morning',
            sections: [
              {
                id: 'recently-played',
                title: 'Recently Played',
                type: 'SONG',
                subtitle: 'Your listening history',
                items: [makeSong({ id: 's1', title: 'Song One' })],
              },
            ],
          },
        });
      }
      return Promise.resolve({ data: { greeting: '', sections: [] } });
    });
    const navigation = { navigate: jest.fn() };

    const { getByTestId, getByText, queryByTestId } = render(
      <HomeScreen navigation={navigation} />
    );
    await settleThroughRetry();

    // Error+empty shows the inline retry (not a blank list).
    expect(getByTestId('home-retry-critical')).toBeTruthy();
    expect(criticalCalls).toBe(2);

    fireEvent.press(getByTestId('home-retry-critical'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await waitFor(() =>
      expect(queryByTestId('home-retry-critical')).toBeNull()
    );

    expect(criticalCalls).toBe(3);
    expect(getByText('Recently Played')).toBeTruthy();
  });
});
