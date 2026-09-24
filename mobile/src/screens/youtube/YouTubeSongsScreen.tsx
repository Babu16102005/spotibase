import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { youtubeApi } from '../../api/youtubeApi';
import type { YouTubeSearchResponse, YouTubeTrendingResponse, YouTubeVideo } from '../../types/youtube';
import { useThemeStore } from '../../store';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import YouTubeVideoCard from '../../components/youtube/YouTubeVideoCard';
import YouTubePlayer from '../../components/youtube/YouTubePlayer';
import { CardSkeleton, SongSkeleton } from '../../components/SkeletonLoader';
import GlassButton from '../../components/GlassButton';
import Icon from '../../components/Icon';

const SEARCH_DEBOUNCE_MS = 400;
const TRENDING_LIMIT = 20;
const SEARCH_LIMIT = 25;

const normalizeVideos = (
  data: YouTubeVideo[] | YouTubeSearchResponse | YouTubeTrendingResponse | undefined | null
): YouTubeVideo[] => {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter((v) => v && v.videoId);
  if (Array.isArray((data as YouTubeSearchResponse).videos))
    return (data as YouTubeSearchResponse).videos.filter((v) => v && v.videoId);
  return [];
};

const isCancel = (err: any): boolean =>
  !!err &&
  (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError');

const YouTubeSongsScreen = ({ navigation }: any) => {
  const { theme } = useThemeStore();
  const currentVideo = useYouTubePlayerStore((s) => s.currentVideo);
  const playVideo = useYouTubePlayerStore((s) => s.playVideo);
  const closePlayer = useYouTubePlayerStore((s) => s.closePlayer);

  const [query, setQuery] = useState('');
  const [trending, setTrending] = useState<YouTubeVideo[]>([]);
  const [results, setResults] = useState<YouTubeVideo[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);

  const searchAbortRef = useRef<AbortController | null>(null);
  const trendingAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<any>(null);
  const queryRef = useRef('');
  queryRef.current = query;

  const fetchTrending = useCallback(async (isRefresh = false) => {
    trendingAbortRef.current?.abort();
    const controller = new AbortController();
    trendingAbortRef.current = controller;
    if (!isRefresh) setLoadingTrending(true);
    setFallback(null);
    try {
      const res = await youtubeApi.trending(TRENDING_LIMIT, controller.signal);
      if (trendingAbortRef.current !== controller) return;
      const videos = normalizeVideos(res.data);
      setTrending(videos);
      if (videos.length === 0) {
        setFallback('No trending videos right now. Try searching instead.');
      }
    } catch (err: any) {
      if (controller.signal.aborted || isCancel(err)) return;
      const status = err?.response?.status;
      if (status === 404 || status === 501) {
        setFallback('YouTube service is not enabled on this server yet. Your library still works — check back soon.');
      } else if (!err?.response) {
        setFallback('You are offline. Trending videos will load when you reconnect.');
      } else {
        setFallback(err?.response?.data?.message || 'Could not load trending videos.');
      }
    } finally {
      if (trendingAbortRef.current === controller) {
        setLoadingTrending(false);
        setRefreshing(false);
      }
    }
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    searchAbortRef.current?.abort();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      const res = await youtubeApi.search(trimmed, SEARCH_LIMIT, undefined, controller.signal);
      if (searchAbortRef.current !== controller) return;
      setResults(normalizeVideos(res.data));
      setFallback(null);
    } catch (err: any) {
      if (controller.signal.aborted || isCancel(err)) return;
      const status = err?.response?.status;
      if (status === 404 || status === 501) {
        setFallback('YouTube search is not enabled on this server yet. Try your library instead.');
        setResults([]);
      } else if (!err?.response) {
        setFallback('You are offline. Search results will appear when you reconnect.');
      } else {
        setFallback(err?.response?.data?.message || 'Search failed. Please try again.');
      }
    } finally {
      if (searchAbortRef.current === controller) setSearching(false);
    }
  }, []);

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchAbortRef.current?.abort();
      if (!text.trim()) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      debounceRef.current = setTimeout(() => {
        void runSearch(text);
      }, SEARCH_DEBOUNCE_MS);
    },
    [runSearch]
  );

  const clearSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    searchAbortRef.current?.abort();
    setQuery('');
    setResults([]);
    setSearching(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchTrending(false);
    }, [fetchTrending])
  );

  // Abort everything on unmount (debounce + in-flight requests).
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchAbortRef.current?.abort();
      trendingAbortRef.current?.abort();
    },
    []
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchTrending(true);
    if (queryRef.current.trim()) void runSearch(queryRef.current);
    else setRefreshing(false);
  }, [fetchTrending, runSearch]);

  const handleSelect = useCallback(
    (video: YouTubeVideo) => {
      playVideo(video);
    },
    [playVideo]
  );

  const showingResults = query.trim().length > 0;
  const listData = showingResults ? results : [];
  const isEmptyResults = showingResults && !searching && results.length === 0;

  const renderResultItem = useCallback(
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

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          {navigation?.canGoBack?.() !== false && (
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
              Trending videos & music search
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
            placeholder="Search YouTube songs…"
            placeholderTextColor={theme.colors.textTertiary}
            value={query}
            onChangeText={handleQueryChange}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              void runSearch(query);
            }}
            accessibilityLabel="Search YouTube songs"
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
              void fetchTrending(true);
              if (query.trim()) void runSearch(query);
            }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading YouTube"
          >
            <Text style={[styles.retryText, { color: theme.colors.primary }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {currentVideo ? (
        <YouTubePlayer video={currentVideo} onClose={closePlayer} testID="youtube-songs-player" />
      ) : null}

      {showingResults ? (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.videoId}
          renderItem={renderResultItem}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
          }
          ListHeaderComponent={
            searching ? (
              <View style={{ paddingTop: 8 }}>
                <SongSkeleton />
                <SongSkeleton />
                <SongSkeleton />
              </View>
            ) : null
          }
          ListEmptyComponent={
            !searching ? (
              <View style={styles.emptyWrap}>
                <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                  {isEmptyResults ? `No videos found for "${query.trim()}"` : 'Start typing to search'}
                </Text>
                <Text style={[styles.emptySub, { color: theme.colors.textSecondary }]}>
                  {isEmptyResults
                    ? 'Try a different song, artist, or spelling.'
                    : 'Results appear here as you type.'}
                </Text>
              </View>
            ) : null
          }
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={5}
          removeClippedSubviews={Platform.OS !== 'web'}
        />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
          }
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Trending now</Text>
          {loadingTrending ? (
            <CardSkeleton count={4} />
          ) : trending.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rail}
            >
              {trending.map((video) => (
                <YouTubeVideoCard
                  key={video.videoId}
                  video={video}
                  variant="rail"
                  onPress={handleSelect}
                  isActive={currentVideo?.videoId === video.videoId}
                  testID={`youtube-trending-${video.videoId}`}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>Nothing trending yet</Text>
              <Text style={[styles.emptySub, { color: theme.colors.textSecondary }]}>
                Pull to refresh or search above to find music videos.
              </Text>
              <GlassButton
                variant="primary"
                size="md"
                title="Retry"
                onPress={() => fetchTrending(true)}
                style={{ marginTop: 12 }}
                accessibilityLabel="Retry loading trending videos"
              />
            </View>
          )}
          <View style={{ height: 120 }} />
        </ScrollView>
      )}
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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  sectionTitle: { fontSize: 18, fontWeight: '700', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  rail: { paddingHorizontal: 16, paddingBottom: 8 },
  listContent: { paddingBottom: 120, paddingTop: 4 },
  emptyWrap: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 40, gap: 6 },
  emptyTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
});

export default YouTubeSongsScreen;
