import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { YouTubeVideo } from '../../types/youtube';
import type { YouTubeOverlayMode } from '../../store/youtubePlayerStore';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import { youtubeApi, YOUTUBE_DEFAULT_LOCALE } from '../../api/youtubeApi';
import YouTubeVideoCard from '../../components/youtube/YouTubeVideoCard';

/**
 * Minimal YouTube watch host — NO header, NO suggestions, black backdrop.
 *
 * Playback lives in the single global MiniYouTubeOverlay instance (mounted
 * in RootNavigator): this screen never mounts a second player so the
 * same view keeps playing while the user browses. The screen is a clean
 * black backdrop behind the overlay — the overlay's full-page watch mode
 * (watchPageActive + expanded) owns the video pinned at the very top, the
 * transport + now-playing title, and the Up next suggestions below.
 *
 * YouTube-authentic minimize: when the overlay transitions INTO mini while
 * this screen is focused/active and a video exists, we pop back to the
 * previous screen (the song list) so the miniplayer floats above it instead
 * of leaving a blank black page behind. When the watch screen is the root
 * (cannot go back) the mini fallback below renders title + Up next so the
 * screen is never blank.
 *
 * Expo SDK v57 versioned docs were read before writing
 * (https://docs.expo.dev/versions/v57.0.0/ — no new native modules here;
 * focus tracking via @react-navigation/native useFocusEffect, list via
 * React Native FlatList).
 */
const YouTubeWatchScreen = ({ route, navigation }: any) => {
  const playVideo = useYouTubePlayerStore((s) => s.playVideo);
  const currentVideo = useYouTubePlayerStore((s) => s.currentVideo);
  const mode = useYouTubePlayerStore((s) => s.mode);
  const setWatchPageActive = useYouTubePlayerStore((s) => s.setWatchPageActive);

  const routeVideoId: string | undefined = route?.params?.videoId;
  const autoplayedRef = useRef<string | null>(null);
  // Transition guard: only fire the minimize pop on entry INTO mini, never
  // on the initial mount (null = not yet observed).
  const prevModeRef = useRef<YouTubeOverlayMode | null>(null);

  // Watch-page flag: while this screen is focused the global overlay renders
  // the full-page YouTube layout (video at top + Up next). Cleared on blur /
  // unmount so other screens keep the bottom-anchored sheet / mini bar.
  useFocusEffect(
    useCallback(() => {
      setWatchPageActive(true);
      return () => {
        try {
          useYouTubePlayerStore.getState().setWatchPageActive(false);
        } catch {}
      };
    }, [setWatchPageActive]),
  );

  // P0: Watch deep-link autoplay — a cold link (notification/shared URL) lands
  // here with params but no currentVideo. Mount must call playVideo() so the
  // single global MiniYouTubeOverlay starts playback (last-wins).
  useEffect(() => {
    if (!routeVideoId) return;
    if (autoplayedRef.current === routeVideoId) return;
    const st = useYouTubePlayerStore.getState();
    if (st.currentVideo?.videoId === routeVideoId) {
      autoplayedRef.current = routeVideoId;
      return;
    }
    const routeVideo: YouTubeVideo = {
      videoId: routeVideoId,
      title: route?.params?.title ?? 'YouTube video',
      channelTitle: route?.params?.channelTitle,
      thumbnailUrl:
        route?.params?.thumbnailUrl ?? `https://i.ytimg.com/vi/${routeVideoId}/hqdefault.jpg`,
    };
    autoplayedRef.current = routeVideoId;
    playVideo(routeVideo);
  }, [routeVideoId, route?.params?.title, route?.params?.channelTitle, route?.params?.thumbnailUrl, playVideo]);

  const goToBrowse = useCallback(() => {
    try {
      navigation?.navigate?.('YouTubeSongs');
      return;
    } catch {}
    try {
      navigation?.getParent?.()?.navigate?.('YouTubeSongs');
    } catch {}
  }, [navigation]);

  // No video at all (cold screen with no params and nothing playing):
  // auto-goBack when possible so no blank screen remains; otherwise the
  // fallback below offers a Browse path.
  useEffect(() => {
    if (currentVideo || routeVideoId) return;
    try {
      if (navigation?.canGoBack?.() === true) navigation.goBack();
    } catch {}
  }, [currentVideo, routeVideoId, navigation]);

  // Closed while on the watch page (closePlayer nulled currentVideo after we
  // already autoplayed/presented this routeVideoId): pop back so the user
  // never stares at an empty black screen. Guarded by autoplayedRef so the
  // initial deep-link mount (currentVideo not yet set, autoplay pending)
  // never pops before playVideo runs.
  useEffect(() => {
    if (currentVideo) return;
    if (!routeVideoId) return;
    if (autoplayedRef.current !== routeVideoId) return;
    try {
      if (navigation?.canGoBack?.() === true) navigation.goBack();
      else (navigation?.navigate as any)?.('YouTubeSongs');
    } catch {}
  }, [currentVideo, routeVideoId, navigation]);

  // YouTube-authentic minimize: overlay transitioned INTO mini while this
  // watch screen is active and a video exists -> return to the previous
  // screen (list) with the miniplayer floating. Guards: transition-only via
  // prevModeRef (never on mount), mini only (never expanded/fullscreen),
  // video must exist, watch page must still be active, canGoBack required
  // (root case is covered by the mini fallback render below instead).
  useEffect(() => {
    if (prevModeRef.current === null) {
      prevModeRef.current = mode;
      return;
    }
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (mode !== 'mini' || prev === 'mini') return;
    const hasVideo = !!(currentVideo || routeVideoId);
    if (!hasVideo) return;
    let active = false;
    try {
      active = useYouTubePlayerStore.getState().watchPageActive === true;
    } catch {
      active = false;
    }
    if (!active) return;
    try {
      if (navigation?.canGoBack?.() === true) navigation.goBack();
    } catch {}
  }, [mode, currentVideo, routeVideoId, navigation]);

  const canGoBack = (() => {
    try {
      return navigation?.canGoBack?.() === true;
    } catch {
      return false;
    }
  })();

  // Mini fallback model: prefer the loaded video, else the route params so a
  // root watch route with params still shows content when minimized.
  const fallbackVideo: YouTubeVideo | null =
    currentVideo ??
    (routeVideoId
      ? {
          videoId: routeVideoId,
          title: route?.params?.title ?? 'YouTube video',
          channelTitle: route?.params?.channelTitle,
          thumbnailUrl:
            route?.params?.thumbnailUrl ??
            `https://i.ytimg.com/vi/${routeVideoId}/hqdefault.jpg`,
        }
      : null);
  const showMiniFallback = mode === 'mini' && !!fallbackVideo && !canGoBack;

  // Mini fallback Up next: same related-fetch pattern as the overlay
  // (search by title, AbortController, filter self, tolerate bare arrays).
  const [related, setRelated] = useState<YouTubeVideo[]>([]);
  useEffect(() => {
    if (!showMiniFallback || !fallbackVideo) {
      setRelated([]);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const query =
          (fallbackVideo.title || '').trim() ||
          (fallbackVideo.channelTitle || '').trim() ||
          'Tamil songs';
        const res = await youtubeApi.search(query, 20, undefined, controller.signal, {
          ...YOUTUBE_DEFAULT_LOCALE,
        });
        if (cancelled || controller.signal.aborted) return;
        const data: any = (res as any)?.data;
        const list: YouTubeVideo[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.videos)
            ? data.videos
            : [];
        setRelated(
          list.filter((v) => v && v.videoId && v.videoId !== fallbackVideo.videoId),
        );
      } catch (err: any) {
        if (controller.signal.aborted) return;
        if (
          err?.code === 'ERR_CANCELED' ||
          err?.name === 'CanceledError' ||
          err?.name === 'AbortError'
        )
          return;
        if (!cancelled) setRelated([]);
      }
    })();
    return () => {
      cancelled = true;
      try {
        controller.abort();
      } catch {}
    };
  }, [showMiniFallback, fallbackVideo?.videoId, fallbackVideo?.title]);

  const handleSelectRelated = useCallback(
    (video: YouTubeVideo) => {
      playVideo(video);
    },
    [playVideo],
  );

  const renderSuggestion = useCallback(
    ({ item }: { item: YouTubeVideo }) => (
      <YouTubeVideoCard
        video={item}
        variant="row"
        onPress={handleSelectRelated}
        testID={`youtube-watch-suggestion-${item.videoId}`}
      />
    ),
    [handleSelectRelated],
  );

  // Fallback UI: only when there is genuinely nothing to watch AND we cannot
  // pop (root of the stack). Black screen + message + Browse button.
  if (!currentVideo && !routeVideoId && !canGoBack) {
    return (
      <View style={styles.container} testID="youtube-watch-screen">
        <View style={styles.fallbackWrap}>
          <Text style={styles.fallbackTitle} testID="youtube-watch-empty-title">
            No video selected
          </Text>
          <TouchableOpacity
            onPress={goToBrowse}
            style={styles.browseBtn}
            accessibilityRole="button"
            accessibilityLabel="Browse YouTube songs"
            testID="youtube-watch-browse"
          >
            <Text style={styles.browseBtnText}>Browse</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Root mini fallback: watch is the stack root (cannot pop) and the overlay
  // minimized — render title + channel + Up next so the screen is never a
  // blank black page. Tapping a suggestion last-wins into the single player.
  if (showMiniFallback && fallbackVideo) {
    return (
      <View style={styles.container} testID="youtube-watch-screen">
        <View style={styles.miniHeader}>
          <Text
            style={styles.miniTitle}
            testID="youtube-watch-fallback-title"
            numberOfLines={2}
          >
            {fallbackVideo.title}
          </Text>
          {!!fallbackVideo.channelTitle && (
            <Text
              style={styles.miniChannel}
              testID="youtube-watch-fallback-channel"
              numberOfLines={1}
            >
              {fallbackVideo.channelTitle}
            </Text>
          )}
        </View>
        <Text style={styles.upNextTitle}>Up next</Text>
        <FlatList
          data={related}
          keyExtractor={(item) => item.videoId}
          renderItem={renderSuggestion}
          testID="youtube-watch-up-next-list"
          contentContainerStyle={styles.upNextContent}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={5}
          removeClippedSubviews={Platform.OS !== 'web'}
        />
      </View>
    );
  }

  return <View style={styles.container} testID="youtube-watch-screen" />;
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  fallbackWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  fallbackTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  browseBtn: {
    marginTop: 4,
    minWidth: 120,
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: '#1DB954',
  },
  browseBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
  miniHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  miniTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  miniChannel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 2,
  },
  upNextTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  upNextContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
});

export default YouTubeWatchScreen;
