import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Platform,
  Keyboard,
  AppState,
  ToastAndroid,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Expo SDK v57 versioned docs (orientation): ScreenOrientation.lockAsync()
// with OrientationLock.LANDSCAPE for fullscreen, unlockAsync() to restore
// DEFAULT on exit. Gestures run on the native thread via gesture-handler;
// WebView renders inline HTML per the v57 webview docs.
// NOTE: expo-screen-orientation native module is NOT present in Expo Go /
// web builds. Static import would crash Metro with
// "Cannot find native module 'ExpoScreenOrientation'". Load lazily with
// fallback so fullscreen layout still works (no rotation lock) when missing.
const ScreenOrientation: {
  lockAsync: (o: unknown) => Promise<void>;
  unlockAsync: () => Promise<void>;
  OrientationLock: { LANDSCAPE: unknown; DEFAULT: unknown };
} = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-screen-orientation');
    if (mod?.lockAsync && mod?.unlockAsync && mod?.OrientationLock) return mod;
  } catch {}
  return {
    lockAsync: async () => {},
    unlockAsync: async () => {},
    OrientationLock: { LANDSCAPE: 'LANDSCAPE', DEFAULT: 'DEFAULT' },
  };
})();
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import { useThemeStore } from '../../store/themeStore';
import { youtubeApi, YOUTUBE_DEFAULT_LOCALE } from '../../api/youtubeApi';
import type { YouTubeVideo } from '../../types/youtube';
import YouTubePlayer from './YouTubePlayer';
import Icon from '../Icon';

interface MiniYouTubeOverlayProps {
  testID?: string;
}

const MINI_MAX_W = 300;
const MINI_MARGIN = 8;
const TAB_CLEARANCE = 96;
const EDGE_SPRING = { damping: 22, stiffness: 260, mass: 0.8 };
const BG_PAUSE_TOAST = 'Video paused — background playback isn’t supported.';
const BG_TOAST_TIMEOUT_MS = 2800;

/**
 * Global floating YouTube overlay — the single YouTubePlayer instance.
 *
 * Swipe parity (matches the audio PlayerSheet):
 * - expanded WatchSheet: drag the handle/card DOWN to collapse to mini
 *   (translationY > 90 or velocityY > 600). Sticky 16:9 borderless
 *   YouTubePlayer on top + transport row + now-playing title below — NO
 *   suggestions list inside playback (clean like original YouTube: the video
 *   fits at the top edge). Swipe UP (translationY < -60 or velocityY < -500)
 *   or the fullscreen button enters landscape fullscreen
 *   (ScreenOrientation lock).
 * - fullscreen: edge-to-edge landscape video, locked via
 *   ScreenOrientation.lockAsync(LANDSCAPE); swipe DOWN (translationY > 90 or
 *   velocityY > 600) or the exit button reverses to returnMode (unlockAsync).
 * - mini: landscape card (live video left + title/controls right + progress
 *   line); drag anywhere to move (clamped + edge snap kept); TAP the
 *   thumbnail/title (or the expand chevron) to expand; SWIPE UP
 *   (translationY < -60 or velocityY < -500) to expand. Mini bar carries
 *   thumbnail + title + play/pause + fullscreen + expand + close.
 *
 * Mutual exclusion both ways (never overlapping audio):
 * - video wins: youtubePlayerStore.playVideo/resumeVideo + YouTubePlayer
 *   mount pause the audio track first.
 * - audio wins: playerStore play/resume/next/prev call
 *   youtubePlayerStore.notifyAudioStarted() so this overlay pauses
 *   presentation in the same tick.
 *
 * Background compliance (no ToS-violating extraction):
 * - AppState background => pauseVideo() + toast. The iframe is a visible
 *   embed only — we never extract audio/video streams for background play.
 * - Continuing audio in background would require a legal basis (rights
 *   holder permission / YouTube Premium-style entitlement + official APIs);
 *   it is deliberately NOT implemented here.
 */
export const MiniYouTubeOverlay: React.FC<MiniYouTubeOverlayProps> = ({
  testID,
}) => {
  const currentVideo = useYouTubePlayerStore((s) => s.currentVideo);
  const isPlaying = useYouTubePlayerStore((s) => s.isPlaying);
  const isMuted = useYouTubePlayerStore((s) => s.isMuted);
  const setMuted = useYouTubePlayerStore((s) => s.setMuted);
  const mode = useYouTubePlayerStore((s) => s.mode);
  const isFullscreen = useYouTubePlayerStore((s) => s.isFullscreen);
  const snapPosition = useYouTubePlayerStore((s) => s.snapPosition);
  const setMode = useYouTubePlayerStore((s) => s.setMode);
  const enterFullscreen = useYouTubePlayerStore((s) => s.enterFullscreen);
  const exitFullscreen = useYouTubePlayerStore((s) => s.exitFullscreen);
  const setSnapPosition = useYouTubePlayerStore((s) => s.setSnapPosition);
  const pauseVideo = useYouTubePlayerStore((s) => s.pauseVideo);
  const resumeVideo = useYouTubePlayerStore((s) => s.resumeVideo);
  const closePlayer = useYouTubePlayerStore((s) => s.closePlayer);
  const watchPageActive = useYouTubePlayerStore((s) => s.watchPageActive);
  const playVideo = useYouTubePlayerStore((s) => s.playVideo);
  const { theme } = useThemeStore();

  // Full-page watch mode: the Watch screen is focused and the sheet is
  // expanded — render the YouTube-like full page (video pinned at the very
  // top + Up next below) instead of the bottom-anchored sheet.
  const isWatchPage = watchPageActive === true && mode === 'expanded';

  // Up next for the full-page watch mode only (other screens keep the clean
  // sheet). Fetched from the current video's title so suggestions stay
  // relevant; aborted on video change / unmount.
  const [related, setRelated] = useState<YouTubeVideo[]>([]);
  useEffect(() => {
    if (!isWatchPage || !currentVideo) {
      setRelated([]);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const query =
          (currentVideo.title || '').trim() ||
          (currentVideo.channelTitle || '').trim() ||
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
          list.filter((v) => v && v.videoId && v.videoId !== currentVideo.videoId),
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
  }, [isWatchPage, currentVideo?.videoId, currentVideo?.title]);

  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [bgToast, setBgToast] = useState<string | null>(null);
  const bgToastTimerRef = useRef<any>(null);

  // Keyboard offset: lift the overlay above the software keyboard.
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      try {
        setKeyboardHeight(e?.endCoordinates?.height ?? 0);
      } catch {
        setKeyboardHeight(0);
      }
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      try {
        show.remove();
      } catch {}
      try {
        hide.remove();
      } catch {}
    };
  }, []);

  const showBgToast = useCallback((msg: string) => {
    try {
      if (Platform.OS === 'android') {
        ToastAndroid.show(msg, ToastAndroid.SHORT);
      }
    } catch {}
    setBgToast(msg);
    try {
      if (bgToastTimerRef.current) clearTimeout(bgToastTimerRef.current);
    } catch {}
    bgToastTimerRef.current = setTimeout(() => setBgToast(null), BG_TOAST_TIMEOUT_MS);
  }, []);

  useEffect(
    () => () => {
      try {
        if (bgToastTimerRef.current) clearTimeout(bgToastTimerRef.current);
      } catch {}
    },
    [],
  );

  // Compliant background default: pause the visible embed when the app
  // leaves the foreground (background + inactive for iOS control-center /
  // calls / app-switcher). No stream extraction, no background audio.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        try {
          const st = useYouTubePlayerStore.getState();
          if (st.currentVideo && st.isPlaying) {
            st.pauseVideo();
            showBgToast(BG_PAUSE_TOAST);
          }
        } catch {}
      }
    });
    return () => {
      try {
        sub.remove();
      } catch {}
    };
  }, [showBgToast]);

  // Up Next lives ONLY in the full-page watch mode (Watch screen focused +
  // expanded): the bottom-anchored sheet on other screens stays clean (video
  // + transport + title, no search API call). See the isWatchPage related
  // effect above.

  const miniW = useMemo(
    () => Math.max(200, Math.min(MINI_MAX_W, winW - MINI_MARGIN * 2 - insets.left - insets.right)),
    [winW, insets.left, insets.right],
  );
  // Mini is a landscape card: live video left (16:9) + controls right.
  // Fixed compact height (video 16:9 + padding + progress line).
  const miniH = useMemo(() => 116, []);

  const bounds = useMemo(() => {
    const minX = insets.left + MINI_MARGIN;
    const rawMaxX = winW - miniW - insets.right - MINI_MARGIN;
    const maxX = Math.max(minX, rawMaxX);
    const minY = insets.top + 12;
    const rawMaxY = winH - insets.bottom - keyboardHeight - miniH - TAB_CLEARANCE;
    const maxY = Math.max(minY, rawMaxY);
    return { minX, maxX, minY, maxY };
  }, [winW, winH, miniW, miniH, insets, keyboardHeight]);

  const clampToBounds = useCallback(
    (x: number, y: number) => ({
      x: Math.min(Math.max(x, bounds.minX), bounds.maxX),
      y: Math.min(Math.max(y, bounds.minY), bounds.maxY),
    }),
    [bounds],
  );

  const posX = useSharedValue(bounds.maxX);
  const posY = useSharedValue(bounds.maxY);
  const startX = useSharedValue(bounds.maxX);
  const startY = useSharedValue(bounds.maxY);
  const sheetDragY = useSharedValue(0);
  const fullscreenDragY = useSharedValue(0);

  // Initialize / re-clamp when the screen, safe-area, keyboard, saved
  // snap position, or rotation (winW/winH via bounds) changes.
  useEffect(() => {
    if (snapPosition) {
      const clamped = clampToBounds(snapPosition.x, snapPosition.y);
      posX.value = clamped.x;
      posY.value = clamped.y;
    } else {
      posX.value = bounds.maxX;
      posY.value = bounds.maxY;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, snapPosition?.x, snapPosition?.y, winW, winH]);

  const persistPosition = useCallback(
    (x: number, y: number) => {
      setSnapPosition({ x, y });
    },
    [setSnapPosition],
  );

  const togglePlay = useCallback(() => {
    if (isPlaying) pauseVideo();
    else resumeVideo();
  }, [isPlaying, pauseVideo, resumeVideo]);

  // Expanded-sheet mute: flips the shared store flag; the single
  // YouTubePlayer sends the IFrame mute/unMute bridge on change.
  const toggleMute = useCallback(() => {
    setMuted(!isMuted);
  }, [isMuted, setMuted]);

  const handleExpand = useCallback(() => setMode('expanded'), [setMode]);
  const handleMinimize = useCallback(() => setMode('mini'), [setMode]);

  // Up next tap: last-wins into the single WebView (stays on the watch page,
  // still expanded full-page).
  const handleSelectRelated = useCallback(
    (video: YouTubeVideo) => {
      playVideo(video);
    },
    [playVideo],
  );

  const renderSuggestion = useCallback(
    ({ item }: { item: YouTubeVideo }) => (
      <TouchableOpacity
        onPress={() => handleSelectRelated(item)}
        style={styles.suggestionRow}
        accessibilityRole="button"
        accessibilityLabel={`Play ${item.title}`}
        testID={`mini-youtube-suggestion-${item.videoId}`}
        activeOpacity={0.7}
      >
        {item.thumbnailUrl ? (
          <Image
            source={{ uri: item.thumbnailUrl }}
            style={styles.suggestionThumb}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.suggestionThumb, styles.suggestionThumbFallback]} />
        )}
        <View style={styles.suggestionInfo}>
          <Text style={styles.suggestionTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {!!item.channelTitle && (
            <Text style={styles.suggestionChannel} numberOfLines={1}>
              {item.channelTitle}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    ),
    [handleSelectRelated],
  );

  // Fullscreen orientation (Expo SDK v57 ScreenOrientation): lock to
  // landscape while fullscreen, restore DEFAULT on exit/reverse swipe.
  useEffect(() => {
    if (mode !== 'fullscreen') return;
    let active = true;
    (async () => {
      try {
        if (active) {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        }
      } catch {}
    })();
    return () => {
      active = false;
      (async () => {
        try {
          await ScreenOrientation.unlockAsync();
        } catch {}
      })();
    };
  }, [mode]);

  const handleEnterFullscreen = useCallback(() => {
    enterFullscreen();
  }, [enterFullscreen]);

  const handleExitFullscreen = useCallback(() => {
    exitFullscreen();
  }, [exitFullscreen]);

  const miniPan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(8)
        .onBegin(() => {
          startX.value = posX.value;
          startY.value = posY.value;
        })
        .onUpdate((e) => {
          const nextX = Math.min(Math.max(startX.value + e.translationX, bounds.minX), bounds.maxX);
          const nextY = Math.min(Math.max(startY.value + e.translationY, bounds.minY), bounds.maxY);
          posX.value = nextX;
          posY.value = nextY;
        })
        .onEnd((e) => {
          // Swipe-up parity: fast/sharp upward swipe expands to the sheet.
          try {
            const swipeUp = (e?.translationY ?? 0) < -60 || (e?.velocityY ?? 0) < -500;
            if (swipeUp) {
              runOnJS(setMode)('expanded');
              return;
            }
          } catch {}
          // Edge snap: stick to the nearest horizontal edge, keep Y clamped.
          // Persist the same clamped Y that the spring animates to (rotation
          // + keyboard changes re-clamp from this saved value).
          const midX = (bounds.minX + bounds.maxX) / 2;
          const snappedX = posX.value < midX ? bounds.minX : bounds.maxX;
          const clampedY = Math.min(Math.max(posY.value, bounds.minY), bounds.maxY);
          posX.value = withSpring(snappedX, EDGE_SPRING);
          posY.value = withSpring(clampedY, EDGE_SPRING);
          runOnJS(persistPosition)(snappedX, clampedY);
        }),
    [bounds, posX, posY, startX, startY, persistPosition, setMode],
  );

  const expandPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([12, 12])
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
          if (e.translationY > 0) {
            sheetDragY.value = e.translationY;
          }
        })
        .onEnd((e) => {
          const shouldMinimize = e.translationY > 90 || e.velocityY > 600;
          if (shouldMinimize) {
            runOnJS(setMode)('mini');
          } else {
            // Swipe up from the expanded WatchSheet -> landscape fullscreen.
            // Mirrors the mini swipe-up thresholds (< -60 / < -500).
            const swipeUp = (e?.translationY ?? 0) < -60 || (e?.velocityY ?? 0) < -500;
            if (swipeUp) {
              runOnJS(enterFullscreen)();
            }
          }
          sheetDragY.value = withSpring(0, EDGE_SPRING);
        }),
    [sheetDragY, setMode, enterFullscreen],
  );

  // Fullscreen reverse: swipe down exits fullscreen back to returnMode
  // (expanded by default, mini when entered from mini). Vertical-only so
  // horizontal scrub gestures inside the player never exit.
  const fullscreenPan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([12, 12])
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
          if (e.translationY > 0) {
            fullscreenDragY.value = e.translationY;
          }
        })
        .onEnd((e) => {
          const shouldExit = e.translationY > 90 || e.velocityY > 600;
          if (shouldExit) {
            runOnJS(exitFullscreen)();
          }
          fullscreenDragY.value = withSpring(0, EDGE_SPRING);
        }),
    [fullscreenDragY, exitFullscreen],
  );

  // P0 gesture scope: the sheet drag lives on the handle — drag DOWN to
  // minimize, swipe UP to enter fullscreen. No suggestions list remains
  // below the title, so no Native scroll gesture needs to cooperate.
  const handleSheetGesture = expandPan;

  const miniAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: posX.value }, { translateY: posY.value }],
  }));

  const expandedAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetDragY.value }],
  }));

  const fullscreenAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: fullscreenDragY.value }],
  }));

  // P0 fullscreen landscape sizing: 16:9 video must fit without overflow.
  // Width is min(winW, winH*16/9) minus chrome/padding so the below-frame
  // title block + state row + progress never push the frame past winH in
  // landscape (transport buttons float INSIDE the frame as overlays).
  // NOTE: hooks must stay before the early return below (rules-of-hooks).
  const fullscreenPadH = Math.max(insets.left, 8) + Math.max(insets.right, 8);
  const fullscreenPadV = insets.top + Math.max(insets.bottom, 12);
  // Below-frame title block (~70) + state row (~44) + progress + gaps.
  const FULLSCREEN_CHROME_H = 152;
  const fullscreenAvailW = Math.max(0, winW - fullscreenPadH);
  const fullscreenAvailH = Math.max(0, winH - fullscreenPadV - FULLSCREEN_CHROME_H);
  const fullscreenVideoW = Math.max(
    0,
    Math.min(
      winW,
      (winH * 16) / 9,
      fullscreenAvailW,
      (fullscreenAvailH * 16) / 9,
    ),
  );

  // P0 iframe fullscreen escape: DOM fullscreen (YouTube button) exiting via
  // ESC must reconcile the RN store out of fullscreen.
  const handleWebFullscreenChange = useCallback(() => {
    try {
      if (typeof document !== 'undefined') {
        const doc: any = document as any;
        const active = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
        if (!active) {
          const st = useYouTubePlayerStore.getState();
          if (st.isFullscreen) st.exitFullscreen();
        }
      }
    } catch {}
  }, []);

  // Web document listener (covers Safari webkit prefix + cases where the
  // iframe's React onFullscreenChange doesn't bubble to RN).
  useEffect(() => {
    if (mode !== 'fullscreen' && !isFullscreen) return;
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    try {
      document.addEventListener('fullscreenchange', handleWebFullscreenChange);
      document.addEventListener('webkitfullscreenchange', handleWebFullscreenChange);
    } catch {}
    return () => {
      try {
        document.removeEventListener('fullscreenchange', handleWebFullscreenChange);
      } catch {}
      try {
        document.removeEventListener('webkitfullscreenchange', handleWebFullscreenChange);
      } catch {}
    };
  }, [mode, isFullscreen, handleWebFullscreenChange]);

  if (!currentVideo) return null;

  const expandedBottomPad = insets.bottom + TAB_CLEARANCE + keyboardHeight;
  const sheetMaxH = Math.max(320, Math.min(winH * 0.86, winH - insets.top - 24));

  const bgToastBanner = bgToast ? (
    <View style={styles.bgToast} testID="mini-youtube-bg-toast" accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.bgToastText} numberOfLines={2}>
        {bgToast}
      </Text>
    </View>
  ) : null;

  // Landscape fullscreen: edge-to-edge borderless video, locked to
  // landscape via ScreenOrientation. Swipe down reverses to returnMode.
  if (mode === 'fullscreen' || isFullscreen) {
    return (
      <GestureDetector gesture={fullscreenPan}>
        <Animated.View
          style={[
            styles.fullscreenWrap,
            {
              width: winW,
              height: winH,
              paddingTop: insets.top,
              paddingBottom: Math.max(insets.bottom, 12),
              paddingLeft: Math.max(insets.left, 8),
              paddingRight: Math.max(insets.right, 8),
            },
            fullscreenAnimatedStyle,
          ]}
          testID={testID ?? 'mini-youtube-overlay'}
          accessibilityRole="none"
          accessibilityLabel={`YouTube fullscreen: ${currentVideo.title}`}
        >
          {/* 16:9 frame: transport floats INSIDE as scrim overlays (top:
              exit + close; bottom: play/pause). No title above the video —
              the title block lives BELOW the frame (a11y label on the
              wrapper still announces it). */}
          <View
            style={[styles.fullscreenVideo, { width: fullscreenVideoW, alignSelf: 'center' }]}
            testID="mini-youtube-fullscreen-view"
            // P0 iframe fullscreen escape: DOM ESC must reconcile RN state.
            {...(Platform.OS === 'web'
              ? ({ onFullscreenChange: handleWebFullscreenChange } as any)
              : {})}
          >
            <YouTubePlayer
              video={currentVideo}
              borderless
              onClose={closePlayer}
              testID="mini-youtube-player"
            />
            <View style={styles.videoTopOverlay} pointerEvents="box-none">
              <TouchableOpacity
                onPress={handleExitFullscreen}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={[styles.fullscreenBtn, styles.scrimBtn]}
                accessibilityRole="button"
                accessibilityLabel="Exit fullscreen"
                testID="mini-youtube-fullscreen-exit"
              >
                <Icon name="chevronDown" size={20} color="#FFFFFF" />
              </TouchableOpacity>
              <View style={styles.topOverlaySpacer} />
              <TouchableOpacity
                onPress={closePlayer}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={[styles.fullscreenBtn, styles.scrimBtn]}
                accessibilityRole="button"
                accessibilityLabel="Close video player"
                testID="mini-youtube-close"
              >
                <Icon name="close" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View style={styles.videoBottomOverlay} pointerEvents="box-none">
              <TouchableOpacity
                onPress={togglePlay}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={[styles.fullscreenBtn, styles.scrimBtn]}
                accessibilityRole="button"
                accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
                testID="mini-youtube-play-pause"
              >
                <Icon name={isPlaying ? 'pause' : 'play'} size={20} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.fullscreenState} accessibilityLiveRegion="polite">
                {isPlaying ? 'Now playing' : 'Paused'}
              </Text>
            </View>
          </View>
          {/* Tap parity in fullscreen: tapping the below-frame title exits
              like swipe-down (thumbnail/title tap parity). */}
          <TouchableOpacity
            onPress={handleExitFullscreen}
            style={styles.nowPlayingBlock}
            accessibilityRole="button"
            accessibilityLabel={`Exit fullscreen: ${currentVideo.title}`}
            testID="mini-youtube-tap-expand"
            activeOpacity={0.7}
          >
            <Text
              style={styles.nowPlayingTitle}
              testID="mini-youtube-now-playing-title"
              numberOfLines={2}
            >
              {currentVideo.title}
            </Text>
            {!!currentVideo.channelTitle && (
              <Text
                style={styles.nowPlayingChannel}
                testID="mini-youtube-now-playing-channel"
                numberOfLines={1}
              >
                {currentVideo.channelTitle}
              </Text>
            )}
          </TouchableOpacity>
          <View
            style={styles.fullscreenProgressTrack}
            testID="mini-youtube-progress"
            accessibilityRole="progressbar"
            accessibilityLabel={isPlaying ? 'Video playing' : 'Video paused'}
          >
            <View
              style={[
                styles.fullscreenProgressFill,
                { opacity: isPlaying ? 1 : 0.35 },
              ]}
            />
          </View>
          {currentVideo.thumbnailUrl ? (
            <TouchableOpacity
              onPress={handleExitFullscreen}
              style={styles.hiddenThumbBtn}
              accessibilityRole="button"
              accessibilityLabel="Expand video player"
              testID="mini-youtube-thumb"
            >
              <Image
                source={{ uri: currentVideo.thumbnailUrl }}
                style={styles.hiddenThumb}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ) : (
            <View
              testID="mini-youtube-thumb"
              style={styles.hiddenThumb}
              accessibilityLabel="Expand video player"
            />
          )}
          {bgToastBanner}
        </Animated.View>
      </GestureDetector>
    );
  }

  if (mode === 'mini') {
    return (
      <GestureDetector gesture={miniPan}>
        <Animated.View
          style={[
            styles.miniFloat,
            {
              width: miniW,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              shadowColor: '#000',
            },
            miniAnimatedStyle,
          ]}
          testID={testID ?? 'mini-youtube-overlay'}
          accessibilityRole="none"
          accessibilityLabel={`Mini YouTube player: ${currentVideo.title}`}
        >
          {/* Landscape card: live video left + controls right. Dragging starts
              anywhere on the card; buttons stay tappable because the pan only
              activates after 8pt of movement. */}
          <View style={styles.miniLandscapeRow}>
            <View style={styles.miniVideoLeft}>
              <YouTubePlayer
                video={currentVideo}
                borderless
                onClose={closePlayer}
                testID="mini-youtube-player"
              />
            </View>
            <View style={styles.miniControlsRight}>
              <View style={styles.miniTitleRow}>
                <TouchableOpacity
                  onPress={handleExpand}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.miniThumbWrap}
                  accessibilityRole="button"
                  accessibilityLabel="Expand video player"
                  testID="mini-youtube-thumb"
                >
                  {currentVideo.thumbnailUrl ? (
                    <Image
                      source={{ uri: currentVideo.thumbnailUrl }}
                      style={styles.miniThumb}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={[styles.miniThumb, styles.miniThumbFallback]} />
                  )}
                </TouchableOpacity>
                {/* Tap parity: tapping the title expands, mirroring swipe-up. */}
                <TouchableOpacity
                  onPress={handleExpand}
                  style={styles.miniTitleWrap}
                  accessibilityRole="button"
                  accessibilityLabel="Expand video player"
                  testID="mini-youtube-tap-expand"
                  activeOpacity={0.7}
                >
                  <Text style={[styles.miniTitle, { color: theme.colors.text }]} numberOfLines={2}>
                    {isPlaying ? 'Now playing' : 'Paused'} · {currentVideo.title}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.miniBtnRow}>
                <TouchableOpacity
                  onPress={togglePlay}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.miniBtn}
                  accessibilityRole="button"
                  accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
                  testID="mini-youtube-play-pause"
                >
                  <Icon name={isPlaying ? 'pause' : 'play'} size={16} color={theme.colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleExpand}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.miniBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Expand video player"
                  testID="mini-youtube-expand"
                >
                  <Icon name="chevronUp" size={18} color={theme.colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleEnterFullscreen}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.miniBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Enter fullscreen"
                  testID="mini-youtube-fullscreen"
                >
                  <Icon name="expand" size={16} color={theme.colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={closePlayer}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.miniBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Close video player"
                  testID="mini-youtube-close"
                >
                  <Icon name="close" size={14} color={theme.colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
          {/* Progress line: accent hairline under the landscape card. */}
          <View
            style={styles.miniProgressTrack}
            testID="mini-youtube-progress"
            accessibilityRole="progressbar"
            accessibilityLabel={isPlaying ? 'Video playing' : 'Video paused'}
          >
            <View
              style={[
                styles.miniProgressFill,
                { backgroundColor: theme.colors.primary, opacity: isPlaying ? 1 : 0.35 },
              ]}
            />
          </View>
          {bgToastBanner}
        </Animated.View>
      </GestureDetector>
    );
  }

  // REAL YouTube-like watch page: Watch screen focused + expanded. Full-page
  // takeover from the very top (no bottom-sheet cap, no tab clearance, black
  // bg): 16:9 video pinned edge-to-edge at the top, transport + title below,
  // then Up next suggestions below the title. Single WebView invariant holds
  // (one YouTubePlayer here, none on the Watch screen).
  if (isWatchPage) {
    return (
      <Animated.View
        style={[
          styles.watchWrap,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom + keyboardHeight,
          },
          expandedAnimatedStyle,
        ]}
        testID={testID ?? 'mini-youtube-overlay'}
        accessibilityLabel={`YouTube watch page: ${currentVideo.title}`}
      >
        {/* Drag handle owns the pan (down to mini, up to fullscreen) — same
            gesture thresholds as the sheet. */}
        <GestureDetector gesture={handleSheetGesture}>
          <Animated.View style={styles.watchDragHandleRow} testID="mini-youtube-drag-handle">
            <View style={styles.dragHandle} />
          </Animated.View>
        </GestureDetector>
        {/* 16:9 video pinned at the very top, edge-to-edge. */}
        <View style={styles.watchVideoWrap} testID="mini-youtube-watch-video">
          <YouTubePlayer
            video={currentVideo}
            borderless
            onClose={closePlayer}
            testID="mini-youtube-player"
          />
          <View style={styles.videoTopOverlay} pointerEvents="box-none">
            <View style={styles.topOverlaySpacer} />
            <TouchableOpacity
              onPress={handleEnterFullscreen}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.sheetIconBtn, styles.scrimBtn]}
              accessibilityRole="button"
              accessibilityLabel="Enter fullscreen"
              testID="mini-youtube-fullscreen"
            >
              <Icon name="expand" size={16} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleMinimize}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.sheetIconBtn, styles.scrimBtn]}
              accessibilityRole="button"
              accessibilityLabel="Minimize video player"
              testID="mini-youtube-minimize"
            >
              <Icon name="chevronDown" size={18} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={closePlayer}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.sheetIconBtn, styles.scrimBtn]}
              accessibilityRole="button"
              accessibilityLabel="Close video player"
              testID="mini-youtube-close-expanded"
            >
              <Icon name="close" size={14} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
        {/* Transport BELOW the video (play/pause + mute share the store). */}
        <View style={styles.expandedControlRow}>
          <TouchableOpacity
            onPress={togglePlay}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.expandedControlBtn}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
            testID="mini-youtube-play-pause"
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.expandedControlState} accessibilityLiveRegion="polite">
            {isPlaying ? 'Now playing' : 'Paused'}
          </Text>
          <View style={styles.expandedControlSpacer} />
          <TouchableOpacity
            onPress={toggleMute}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.expandedControlBtn}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? 'Unmute video' : 'Mute video'}
            testID="youtube-mute-toggle"
          >
            <Icon name={isMuted ? 'volumeMute' : 'volume'} size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.nowPlayingBlock}>
          <Text
            style={styles.nowPlayingTitle}
            testID="mini-youtube-now-playing-title"
            numberOfLines={2}
          >
            {currentVideo.title}
          </Text>
          {!!currentVideo.channelTitle && (
            <Text
              style={styles.nowPlayingChannel}
              testID="mini-youtube-now-playing-channel"
              numberOfLines={1}
            >
              {currentVideo.channelTitle}
            </Text>
          )}
        </View>
        {/* Up next suggestions BELOW the title (virtualized FlatList). */}
        <View style={styles.upNextSection}>
          <Text style={styles.upNextTitle}>Up next</Text>
          <FlatList
            data={related}
            keyExtractor={(item) => item.videoId}
            renderItem={renderSuggestion}
            testID="mini-youtube-up-next-list"
            contentContainerStyle={styles.upNextContent}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={5}
            removeClippedSubviews={Platform.OS !== 'web'}
          />
        </View>
        {bgToastBanner}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.expandedWrap,
        { paddingBottom: expandedBottomPad },
        expandedAnimatedStyle,
      ]}
      testID={testID ?? 'mini-youtube-overlay'}
      accessibilityLabel={`YouTube player expanded: ${currentVideo.title}`}
    >
      <Animated.View
        style={[
          styles.expandedCard,
          {
            backgroundColor: '#000',
            borderColor: theme.colors.border,
            maxHeight: sheetMaxH,
          },
        ]}
      >
        {/* P0: gesture scope — the drag handle owns the pan (drag down to
            minimize, swipe up to fullscreen). No "Up next" suggestions list
            below the title (removed by product request), so no Native scroll
            gesture is needed. Transport buttons live OUTSIDE this detector
            (on the video overlay + control row below) so taps are never
            swallowed by the drag gesture. */}
        <GestureDetector gesture={handleSheetGesture}>
          <Animated.View style={styles.dragHandleRow} testID="mini-youtube-drag-handle">
            <View style={styles.dragHandle} />
          </Animated.View>
        </GestureDetector>
        {/* Sticky 16:9 video top — the single global WebView (borderless
            edge-to-edge) with the sheet transport floating top-right ON the
            video (scrim circles, above the drag area). */}
        <View style={styles.videoWrap}>
          <YouTubePlayer
            video={currentVideo}
            borderless
            onClose={closePlayer}
            testID="mini-youtube-player"
          />
          <View style={styles.videoTopOverlay} pointerEvents="box-none">
            <View style={styles.topOverlaySpacer} />
            <TouchableOpacity
              onPress={handleEnterFullscreen}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.sheetIconBtn, styles.scrimBtn]}
              accessibilityRole="button"
              accessibilityLabel="Enter fullscreen"
              testID="mini-youtube-fullscreen"
            >
              <Icon name="expand" size={16} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleMinimize}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.sheetIconBtn, styles.scrimBtn]}
              accessibilityRole="button"
              accessibilityLabel="Minimize video player"
              testID="mini-youtube-minimize"
            >
              <Icon name="chevronDown" size={18} color="#FFFFFF" />
            </TouchableOpacity>
            {/* Borderless bare chrome: expanded close lives here (player
                header is hidden when borderless). Distinct testID so mini's
                mini-youtube-close stays mini/fullscreen-only. */}
            <TouchableOpacity
              onPress={closePlayer}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={[styles.sheetIconBtn, styles.scrimBtn]}
              accessibilityRole="button"
              accessibilityLabel="Close video player"
              testID="mini-youtube-close-expanded"
            >
              <Icon name="close" size={14} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
        {/* Transport BELOW the video (play/pause + mute share the store
            with the single WebView player). */}
        <View style={styles.expandedControlRow}>
          <TouchableOpacity
            onPress={togglePlay}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.expandedControlBtn}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause video' : 'Play video'}
            testID="mini-youtube-play-pause"
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.expandedControlState} accessibilityLiveRegion="polite">
            {isPlaying ? 'Now playing' : 'Paused'}
          </Text>
          <View style={styles.expandedControlSpacer} />
          <TouchableOpacity
            onPress={toggleMute}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.expandedControlBtn}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? 'Unmute video' : 'Mute video'}
            testID="youtube-mute-toggle"
          >
            <Icon name={isMuted ? 'volumeMute' : 'volume'} size={18} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        {/* YouTube-like title/channel block below the player (text only —
            no second player/WebView mounted here). */}
        <View style={styles.nowPlayingBlock}>
          <Text
            style={styles.nowPlayingTitle}
            testID="mini-youtube-now-playing-title"
            numberOfLines={2}
          >
            {currentVideo.title}
          </Text>
          {!!currentVideo.channelTitle && (
            <Text
              style={styles.nowPlayingChannel}
              testID="mini-youtube-now-playing-channel"
              numberOfLines={1}
            >
              {currentVideo.channelTitle}
            </Text>
          )}
        </View>
        {/* WatchSheet suggestions removed (no "Up next" inside playback).
            Clean sheet: video + transport row + now-playing title only. */}
        {bgToastBanner}
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  // Floating layer above screens/tab bar (z 50); AiOrb voice sheet is a
  // native Modal so it always renders above this overlay.
  miniFloat: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    zIndex: 50,
    elevation: 50,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
        }
      : {}),
  } as any,
  miniPlayerWrap: {
    // Let the single YouTubePlayer fill the mini card width; its frame is
    // 100% x 16:9 with overflow hidden + radius so nothing crops.
    width: '100%',
  },
  miniBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
  },
  miniThumbWrap: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  miniThumb: {
    width: 56,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  miniThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniTitleWrap: {
    flex: 1,
    minWidth: 0,
    minHeight: 36,
    justifyContent: 'center',
  },
  miniBtn: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  miniTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
  },
  // Landscape mini card: live video left + controls right.
  miniLandscapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 8,
  },
  miniVideoLeft: {
    width: 148,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
    flexShrink: 0,
  },
  miniControlsRight: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 4,
  },
  miniTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  // Progress line under the mini landscape card.
  miniProgressTrack: {
    height: 3,
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    width: '100%',
    borderRadius: 2,
  },
  // 16:9 video anchor for the in-frame transport overlays (expanded sheet
  // + fullscreen share these). The overlay containers are pointerEvents
  // box-none + live OUTSIDE the sheet drag detector, so button taps are
  // never swallowed by the pan gesture.
  videoWrap: {
    position: 'relative',
    width: '100%',
    backgroundColor: '#000',
  },
  // Top overlay ON the video (exit/close in fullscreen; fullscreen /
  // minimize / close in the expanded sheet).
  videoTopOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 5,
    elevation: 5,
  },
  // Bottom overlay ON the video (fullscreen play/pause + state).
  videoBottomOverlay: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 5,
    elevation: 5,
  },
  topOverlaySpacer: {
    flex: 1,
  },
  // Scrim circle: 44x44 tappable target, white icon on a dark scrim so
  // transport stays visible + tappable over bright video frames.
  scrimBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetIconBtn: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  // Transport row BELOW the video in the expanded sheet (play/pause +
  // mute share the store with the single WebView player).
  expandedControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  expandedControlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedControlState: {
    color: '#1DB954',
    fontSize: 13,
    fontWeight: '800',
  },
  expandedControlSpacer: {
    flex: 1,
  },
  // Landscape fullscreen takeover (above mini/expanded sheets).
  fullscreenWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: '#000',
    zIndex: 60,
    elevation: 60,
    justifyContent: 'center',
    gap: 8,
  },
  fullscreenVideo: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  fullscreenBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  fullscreenState: {
    color: '#1DB954',
    fontSize: 13,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  fullscreenProgressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  fullscreenProgressFill: {
    height: '100%',
    width: '100%',
    borderRadius: 2,
    backgroundColor: '#1DB954',
  },
  // Hidden parity thumb in fullscreen (keeps the mini-youtube-thumb testID
  // mounted in every mode without affecting the fullscreen layout).
  hiddenThumbBtn: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  hiddenThumb: {
    width: 1,
    height: 1,
  },
  expandedWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    elevation: 50,
    alignItems: 'center',
    paddingHorizontal: 0,
  } as any,
  expandedCard: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
    paddingBottom: 8,
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 -12px 32px rgba(0,0,0,0.4)',
        }
      : {
          shadowOffset: { width: 0, height: -8 },
          shadowOpacity: 0.3,
          shadowRadius: 16,
        }),
  } as any,
  dragHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 4,
    position: 'relative',
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  minimizeBtn: {
    position: 'absolute',
    right: 8,
    top: 2,
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  // Now-playing title/channel block directly below the player
  // (dark sheet: card background is #000 in all themes).
  nowPlayingBlock: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 2,
  },
  nowPlayingTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 20,
  },
  nowPlayingChannel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 2,
  },
  bgToast: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bgToastText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  thumbFallback: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Full-page watch mode (Watch screen focused + expanded): absolute fill
  // from the very top, black bg, no bottom-sheet cap / tab clearance.
  watchWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 50,
    elevation: 50,
  } as any,
  watchDragHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#000',
  },
  // 16:9 video pinned at the very top, edge-to-edge (no radius/margins).
  watchVideoWrap: {
    position: 'relative',
    width: '100%',
    backgroundColor: '#000',
  },
  // Up next section BELOW the title (virtualized FlatList; video stays
  // pinned above while this list scrolls).
  upNextSection: {
    flex: 1,
    minHeight: 0,
    paddingTop: 10,
    backgroundColor: '#000',
  },
  upNextTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  upNextContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 12,
  },
  suggestionThumb: {
    width: 128,
    height: 72,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
  suggestionThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionInfo: {
    flex: 1,
    minWidth: 0,
  },
  suggestionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  suggestionChannel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 4,
  },
});

// Re-exported for tests that import the thumbnail helper path.
export const MiniYouTubeThumb = ({ uri }: { uri?: string | null }) =>
  uri ? (
    <Image source={{ uri }} style={{ width: 40, height: 40, borderRadius: 8 }} />
  ) : (
    <View style={styles.thumbFallback} />
  );

export default MiniYouTubeOverlay;
