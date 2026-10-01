import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  youtubeApi,
  YOUTUBE_DEFAULT_LOCALE,
  YOUTUBE_DEFAULT_TAMIL_QUERY,
} from '../../api/youtubeApi';
import type { YouTubeSearchResponse, YouTubeVideo } from '../../types/youtube';
import { useThemeStore } from '../../store';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import YouTubeVideoCard from '../../components/youtube/YouTubeVideoCard';
import { SongSkeleton } from '../../components/SkeletonLoader';
import GlassButton from '../../components/GlassButton';
import Icon from '../../components/Icon';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 20;
// Centralized India-first locale (IN/ta/ta) + Tamil-first default feed query —
// canonical values live in youtubeApi (YOUTUBE_DEFAULT_LOCALE,
// YOUTUBE_DEFAULT_TAMIL_QUERY); no literals here.

const normalizeVideos = (
  data: YouTubeVideo[] | YouTubeSearchResponse | undefined | null
): YouTubeVideo[] => {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter((v) => v && v.videoId);
  if (Array.isArray((data as YouTubeSearchResponse).videos))
    return (data as YouTubeSearchResponse).videos.filter((v) => v && v.videoId);
  return [];
};

const extractNextPageToken = (
  data: YouTubeVideo[] | YouTubeSearchResponse | undefined | null
): string | null => {
  if (!data || Array.isArray(data)) return null;
  const token = (data as YouTubeSearchResponse).nextPageToken;
  return typeof token === 'string' && token.length > 0 ? token : null;
};

const dedupeByVideoId = (prev: YouTubeVideo[], next: YouTubeVideo[]): YouTubeVideo[] => {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map((v) => v.videoId));
  const merged = [...prev];
  for (const v of next) {
    if (!v || !v.videoId || seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    merged.push(v);
  }
  return merged;
};

const isCancel = (err: any): boolean =>
  !!err &&
  (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError');

const localeParams = {
  regionCode: YOUTUBE_DEFAULT_LOCALE.regionCode,
  relevanceLanguage: YOUTUBE_DEFAULT_LOCALE.relevanceLanguage,
  hl: YOUTUBE_DEFAULT_LOCALE.hl,
};

/**
 * Tamil-first YouTube songs browser — single vertical FlatList.
 *
 * Empty query (initial entry + cleared search) auto-loads the Tamil feed
 * via youtubeApi.search(YOUTUBE_DEFAULT_TAMIL_QUERY) with IN/ta/ta locale.
 * There is no horizontal trending rail and no dual ScrollView/FlatList mode:
 * search results and the default feed share the same row-only list with
 * pageToken infinite scroll (dedupe by videoId).
 *
 * Playback lives in the global MiniYouTubeOverlay mounted in RootNavigator
 * (single player instance). Tapping a row just calls playVideo.
 */
const YouTubeSongsScreen = ({ navigation }: any) => {
  const { theme } = useThemeStore();
  const currentVideo = useYouTubePlayerStore((s) => s.currentVideo);
  const playVideo = useYouTubePlayerStore((s) => s.playVideo);

  const [query, setQuery] = useState('');
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  // Single banner for the unified feed (first-page + pagination errors share it).
  const [fallback, setFallback] = useState<string | null>(null);

  const feedAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<any>(null);
  const lastFeedAtRef = useRef<number>(0);
  const FEED_FRESH_MS = 30000;
  const queryRef = useRef('');
  queryRef.current = query;
  const activeQueryRef = useRef<string>(YOUTUBE_DEFAULT_TAMIL_QUERY);

  const hasMore = nextPageToken != null;

  const fetchFirstPage = useCallback(async (q: string, isRefresh = false) => {
    const effective = q.trim() || YOUTUBE_DEFAULT_TAMIL_QUERY;
    feedAbortRef.current?.abort();
    const controller = new AbortController();
    feedAbortRef.current = controller;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setFallback(null);
    try {
      const res = await youtubeApi.search(
        effective,
        SEARCH_LIMIT,
        undefined,
        controller.signal,
        { ...localeParams }
      );
      if (feedAbortRef.current !== controller) return;
      const items = normalizeVideos(res.data);
      // Dedupe defensively (backend may echo duplicates across refreshes).
      setVideos(dedupeByVideoId([], items));
      setNextPageToken(extractNextPageToken(res.data));
      activeQueryRef.current = effective;
      lastFeedAtRef.current = Date.now();
    } catch (err: any) {
      if (controller.signal.aborted || isCancel(err)) return;
      const status = err?.response?.status;
      if (status === 404 || status === 501) {
        setFallback(
          'YouTube service is not enabled on this server yet. Your library still works — check back soon.'
        );
      } else if (!err?.response) {
        setFallback('You are offline. Tamil songs will load when you reconnect.');
      } else {
        setFallback(err?.response?.data?.message || 'Could not load Tamil songs.');
      }
    } finally {
      if (feedAbortRef.current === controller) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const fetchMore = useCallback(async () => {
    if (loading || loadingMore || refreshing) return;
    const token = nextPageToken;
    if (!token) return;
    const effective = activeQueryRef.current || queryRef.current.trim() || YOUTUBE_DEFAULT_TAMIL_QUERY;
    const controller = new AbortController();
    feedAbortRef.current = controller;
    setLoadingMore(true);
    try {
      const res = await youtubeApi.search(
        effective,
        SEARCH_LIMIT,
        token,
        controller.signal,
        { ...localeParams }
      );
      if (feedAbortRef.current !== controller) return;
      const items = normalizeVideos(res.data);
      setVideos((prev) => dedupeByVideoId(prev, items));
      setNextPageToken(extractNextPageToken(res.data));
      lastFeedAtRef.current = Date.now();
    } catch (err: any) {
      if (controller.signal.aborted || isCancel(err)) return;
      // Keep the existing list; surface a retryable banner. hasMore stays
      // true (token unchanged) so the next onEndReached retries.
      if (!err?.response) {
        setFallback('You are offline. More songs will load when you reconnect.');
      } else {
        setFallback(err?.response?.data?.message || 'Could not load more songs.');
      }
    } finally {
      if (feedAbortRef.current === controller) setLoadingMore(false);
    }
  }, [loading, loadingMore, refreshing, nextPageToken]);

  const runSearch = useCallback(
    (q: string) => {
      void fetchFirstPage(q, false);
    },
    [fetchFirstPage]
  );

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      feedAbortRef.current?.abort();
      if (!text.trim()) {
        // Clearing search returns to the Tamil feed, never to an empty state.
        setFallback(null);
        void fetchFirstPage(YOUTUBE_DEFAULT_TAMIL_QUERY, false);
        return;
      }
      debounceRef.current = setTimeout(() => {
        void runSearch(text);
      }, SEARCH_DEBOUNCE_MS);
    },
    [fetchFirstPage, runSearch]
  );

  const clearSearch = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    feedAbortRef.current?.abort();
    setQuery('');
    setFallback(null);
    // Return to the Tamil feed, not an empty state.
    void fetchFirstPage(YOUTUBE_DEFAULT_TAMIL_QUERY, false);
  }, [fetchFirstPage]);

  // Freshness guard: cached feed paints instantly; refetch only when stale
  // (>30s), empty, or explicitly refreshing. Avoids a network storm on every tab focus.
  useFocusEffect(
    useCallback(() => {
      const fresh =
        lastFeedAtRef.current > 0 && Date.now() - lastFeedAtRef.current < FEED_FRESH_MS;
      if (videos.length === 0 || !fresh) {
        void fetchFirstPage(queryRef.current, false);
      }
    }, [fetchFirstPage, videos.length])
  );

  // Abort everything on unmount (debounce + in-flight requests).
  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      feedAbortRef.current?.abort();
    },
    []
  );

  const onRefresh = useCallback(() => {
    // Spinner is owned by fetchFirstPage's finally (setRefreshing false);
    // do not clear it synchronously here or pull-to-refresh flashes.
    void fetchFirstPage(activeQueryRef.current || queryRef.current, true);
  }, [fetchFirstPage]);

  const handleSelect = useCallback(
    (video: YouTubeVideo) => {
      // Single global WebView (MiniYouTubeOverlay): load + open Watch.
      // Watch is a thin host (title/meta + suggestions, no WebView) so the
      // same player keeps playing while the user browses Up Next.
      playVideo(video);
      try {
        navigation?.navigate?.('YouTubeWatch', {
          videoId: video.videoId,
          title: video.title,
          channelTitle: video.channelTitle,
          thumbnailUrl: video.thumbnailUrl,
        });
      } catch {}
    },
    [playVideo, navigation]
  );

  const showingResults = query.trim().length > 0;
  const isEmpty = !loading && videos.length === 0;
  const sectionTitle = showingResults ? `Results for "${query.trim()}"` : 'Tamil songs';

  const renderItem = useCallback(
    ({ item }: { item: YouTubeVideo }) => (
      <YouTubeVideoCard
        video={item}
        onPress={handleSelect}
        isActive={currentVideo?.videoId === item.videoId}
        variant="row"
        testID={`youtube-result-${item.videoId}`}
      />
    ),
    [handleSelect, currentVideo?.videoId]
  );

  const renderFooter = useCallback(() => {
    if (loadingMore) {
      return (
        <View
          style={styles.footerSpinner}
          testID="youtube-songs-loading-more"
          accessibilityRole="progressbar"
          accessibilityLabel="Loading more songs"
        >
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      );
    }
    return <View style={{ height: 8 }} />;
  }, [loadingMore, theme.colors.primary]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          {navigation?.canGoBack?.() === true && (
            <TouchableOpacity
              onPress={() => navigation?.goBack?.()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Icon name="chevronLeft" size={22} color={theme.colors.text} />
            </TouchableOpacity>
          )}
          <View style={styles.titleCol}>
            <Text style={[styles.title, { color: theme.colors.text }]}>YouTube Songs</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
              Tamil songs • Kollywood hits in India
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.searchBar,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
        >
          <Icon name="search" size={16} color={theme.colors.textSecondary} />
          <TextInput
            style={[styles.input, { color: theme.colors.text }]}
            placeholder="Search Tamil & Indian songs…"
            placeholderTextColor={theme.colors.textTertiary}
            value={query}
            onChangeText={handleQueryChange}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (debounceRef.current) {
                clearTimeout(debounceRef.current);
                debounceRef.current = null;
              }
              void runSearch(query);
            }}
            accessibilityLabel="Search Tamil & Indian songs"
          />
          {query ? (
            <TouchableOpacity
              onPress={clearSearch}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Icon name="close" size={14} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {fallback ? (
        <View
          style={[styles.banner, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          accessibilityRole="alert"
        >
          <Icon name="bell" size={16} color={theme.colors.warning || '#F39C12'} />
          <Text style={[styles.bannerText, { color: theme.colors.textSecondary }]}>{fallback}</Text>
          <TouchableOpacity
            onPress={() => {
              void fetchFirstPage(activeQueryRef.current || queryRef.current, true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading YouTube"
          >
            <Text style={[styles.retryText, { color: theme.colors.primary }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* List-only: playback lives in the global MiniYouTubeOverlay mounted
          in RootNavigator (single player instance). Tapping a row just calls
          playVideo. Single vertical FlatList — no horizontal rail. */}

      <FlatList
        data={videos}
        keyExtractor={(item) => item.videoId}
        renderItem={renderItem}
        testID="youtube-songs-list"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
        }
        ListHeaderComponent={
          <View>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{sectionTitle}</Text>
            {loading ? (
              <View style={{ paddingTop: 4 }}>
                <SongSkeleton />
                <SongSkeleton />
                <SongSkeleton />
                <SongSkeleton />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                {showingResults ? `No videos found for "${query.trim()}"` : 'Nothing here yet'}
              </Text>
              <Text style={[styles.emptySub, { color: theme.colors.textSecondary }]}>
                {showingResults
                  ? 'Try a different song, artist, or spelling.'
                  : 'Pull to refresh or search above to find music videos.'}
              </Text>
              <GlassButton
                variant="primary"
                size="md"
                title="Retry"
                onPress={() => fetchFirstPage(activeQueryRef.current || queryRef.current, true)}
                style={{ marginTop: 12 }}
                accessibilityLabel="Retry loading Tamil songs"
              />
            </View>
          ) : null
        }
        ListFooterComponent={renderFooter}
        onEndReached={() => {
          void fetchMore();
        }}
        onEndReachedThreshold={0.5}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        removeClippedSubviews={Platform.OS !== 'web'}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 48, paddingBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { padding: 4, marginLeft: -4 },
  titleCol: { flex: 1 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, marginTop: 2 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    gap: 8,
  },
  input: { flex: 1, fontSize: 15, height: 44 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  bannerText: { flex: 1, fontSize: 12, lineHeight: 16 },
  retryText: { fontSize: 13, fontWeight: '800' },
  sectionTitle: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  listContent: { paddingBottom: 120, paddingTop: 4 },
  footerSpinner: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 40, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});

export default YouTubeSongsScreen;
