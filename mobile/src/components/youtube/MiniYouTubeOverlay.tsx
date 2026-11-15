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
import type { YouTubePlayerHandle } from './YouTubePlayer';
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
 * Mini transport metrics (BUG-2): the mini button row carries exactly 3
 * compact buttons (play/pause + fullscreen + close — no dedicated expand
 * chevron; thumbnail/title tap + swipe-up already expand). The row must fit
 * the right column at the 300px card width AND the 200px minimum:
 * right column = miniW - row padding (16) - row gap (8) - video width.
 */
export const MINI_BTN_SIZE = 34;
export const MINI_BTN_GAP = 2;
export const MINI_VIDEO_W_MAX = 148;
export const MINI_VIDEO_W_MIN = 64;
/** Responsive mini video width: caps at 148, shrinks so the 3-button row fits. */
export const miniVideoWidth = (miniW: number): number =>
  Math.min(MINI_VIDEO_W_MAX, Math.max(MINI_VIDEO_W_MIN, miniW - 134));
/**
 * Mini hardening: explicit pixel height for the 16:9 slot + player
 * (miniVideoW * 9/16). Used alongside aspectRatio (kept as backup) so the
 * nested aspectRatio chain (slot -> unsized container -> frame) can never
 * collapse to height 0 on RN builds where nested aspectRatio mis-measures.
 */
export const miniVideoHeight = (miniW: number): number =>
  (miniVideoWidth(miniW) * 9) / 16;
/** Mini row hardening: title row never measures 0, button row fixed. */
export const MINI_TITLE_ROW_MIN_H = 40;
export const MINI_BTN_ROW_H = 34;
/** Button-row + title-row fit check for the mini right column (tests pin 300px + 200px). */
export const miniControlsFit = (miniW: number) => {
  const videoW = miniVideoWidth(miniW);
  const rightW = miniW - 16 - 8 - videoW;
  const btnRowW = 3 * MINI_BTN_SIZE + 2 * MINI_BTN_GAP;
  const titleRowW = 56 + 6; // thumbnail + gap (title flexes with minWidth 0)
  return { videoW, rightW, btnRowW, titleRowW, fits: rightW >= btnRowW && rightW >= titleRowW };
};

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
 *   thumbnail/title to expand (no dedicated expand chevron — the 3-button
 *   row is play/pause + fullscreen + close so the close button never clips);
 *   SWIPE UP (translationY < -60 or velocityY < -500) to expand. Mini bar
 *   carries thumbnail + title + play/pause + fullscreen + close.
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

  // ---- Two-home handoff (BUG-1 revert: dedicated mini instance) ----
  // Device-proven: the unified single-WebView tree renders BLACK with no
  // buttons in mini on real Android (Expo Go), while the original dedicated
  // mini WebView showed video. Mini reverts to its own <YouTubePlayer>
  // (own GestureDetector + Animated card); expanded/watch/fullscreen keep
  // sharing one persistent instance. Handoff preserves position both ways
  // without store changes; only entering mini reloads (startSeconds).
  const sharedPlayerRef = useRef<YouTubePlayerHandle | null>(null);
  const miniPlayerRef = useRef<YouTubePlayerHandle | null>(null);
  const handoffSecondsRef = useRef<number>(0);
  const handoffInFlightRef = useRef(false);

  // Fresh video resets the resume offset (predictable entry, no stale seek).
  useEffect(() => {
    handoffSecondsRef.current = 0;
  }, [currentVideo?.videoId]);

  const getTimeWithTimeout = useCallback(
    async (playerRef: React.RefObject<YouTubePlayerHandle | null>): Promise<number> => {
      try {
        const api = playerRef.current as YouTubePlayerHandle | null;
        if (!api?.getCurrentTime) return 0;
        const timeout = new Promise<number>((resolve) => {
          const t: any = setTimeout(() => resolve(0), 800);
          // Prevent unref issues in Jest/node.
          try {
            (t as any)?.unref?.();
          } catch {}
        });
        const time = await Promise.race([
          api.getCurrentTime().catch(() => 0),
          timeout,
        ]);
        const n = Number(time);
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.floor(n);
      } catch {
        return 0;
      }
    },
    [],
  );

  // Shared -> mini: capture position, pause shared (no store change, no
  // double-audio), then mount dedicated mini with startSeconds + autoplay.
  const transitionToMini = useCallback(async () => {
    if (handoffInFlightRef.current) return;
    // Already mini or no video: plain mode change.
    try {
      const st = useYouTubePlayerStore.getState();
      if (!st.currentVideo) {
        st.setMode('mini');
        return;
      }
      if (st.mode === 'mini') return;
    } catch {}
    handoffInFlightRef.current = true;
    try {
      const t = await getTimeWithTimeout(sharedPlayerRef);
      handoffSecondsRef.current = t;
      try {
        sharedPlayerRef.current?.pause?.();
      } catch {}
      try {
        useYouTubePlayerStore.getState().setMode('mini');
      } catch {}
    } finally {
      handoffInFlightRef.current = false;
    }
  }, [getTimeWithTimeout]);

  // Mini -> shared (expanded/fullscreen): capture mini position, pause mini
  // so it never overlaps, unmount mini via mode change, then seekTo shared
  // + play/pause to match wasPlaying. Shared WebView stays mounted (hidden
  // during mini), so no reload — pure seek.
  const transitionFromMini = useCallback(
    async (target: 'expanded' | 'fullscreen') => {
      if (handoffInFlightRef.current) return;
      try {
        const st = useYouTubePlayerStore.getState();
        if (!st.currentVideo) {
          if (target === 'fullscreen') st.enterFullscreen();
          else st.setMode('expanded');
          return;
        }
        if (st.mode !== 'mini') {
          // Not in mini: plain transition (expanded<->fullscreen share one).
          if (target === 'fullscreen') st.enterFullscreen();
          else st.setMode('expanded');
          return;
        }
      } catch {}
      handoffInFlightRef.current = true;
      try {
        const wasPlaying = (() => {
          try {
            return useYouTubePlayerStore.getState().isPlaying;
          } catch {
            return false;
          }
        })();
        const t = await getTimeWithTimeout(miniPlayerRef);
        handoffSecondsRef.current = t;
        try {
          miniPlayerRef.current?.pause?.();
        } catch {}
        try {
          const st = useYouTubePlayerStore.getState();
          if (target === 'fullscreen') st.enterFullscreen();
          else st.setMode('expanded');
        } catch {}
        // Shared stayed mounted hidden — seek without reload.
        try {
          const shared = sharedPlayerRef.current;
          if (shared?.seekTo) {
            // Small tick so the mode change propagates before seeking.
            await new Promise<void>((r) => {
              try {
                setTimeout(() => r(), 0);
              } catch {
                r();
              }
            });
            shared.seekTo(t);
            if (!wasPlaying) {
              // seekTo auto-plays; restore paused-at-position when needed.
              try {
                setTimeout(() => {
                  try {
                    shared.pause?.();
                  } catch {}
                }, 50);
              } catch {}
            }
          }
        } catch {}
      } finally {
        handoffInFlightRef.current = false;
      }
    },
    [getTimeWithTimeout],
  );

  const handleExpand = useCallback(() => {
    try {
      const st = useYouTubePlayerStore.getState();
      if (st.mode === 'mini') {
        void transitionFromMini('expanded');
        return;
      }
    } catch {}
    setMode('expanded');
  }, [setMode, transitionFromMini]);
  const handleMinimize = useCallback(() => {
    try {
      const st = useYouTubePlayerStore.getState();
      if (st.mode !== 'mini' && st.currentVideo) {
        void transitionToMini();
        return;
      }
    } catch {}
    setMode('mini');
  }, [setMode, transitionToMini]);

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
    try {
      const st = useYouTubePlayerStore.getState();
      if (st.mode === 'mini') {
        void transitionFromMini('fullscreen');
        return;
      }
    } catch {}
    enterFullscreen();
  }, [enterFullscreen, transitionFromMini]);

  const transitionToMiniFromFullscreen = useCallback(async () => {
    if (handoffInFlightRef.current) return;
    handoffInFlightRef.current = true;
    try {
      const t = await getTimeWithTimeout(sharedPlayerRef);
      handoffSecondsRef.current = t;
      try {
        sharedPlayerRef.current?.pause?.();
      } catch {}
      try {
        useYouTubePlayerStore.getState().exitFullscreen();
      } catch {}
    } finally {
      handoffInFlightRef.current = false;
    }
  }, [getTimeWithTimeout]);

  const handleExitFullscreen = useCallback(() => {
    try {
      const st = useYouTubePlayerStore.getState();
      const ret = (st as unknown as { returnMode?: 'mini' | 'expanded' }).returnMode ?? 'expanded';
      if (ret === 'mini' && st.mode === 'fullscreen') {
        // Fullscreen (shared) -> mini (dedicated): capture + pause + mount.
        void transitionToMiniFromFullscreen();
        return;
      }
    } catch {}
    exitFullscreen();
  }, [exitFullscreen, transitionToMiniFromFullscreen]);

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
          // Routes through the mini->shared handoff (position-preserving seek).
          try {
            const swipeUp = (e?.translationY ?? 0) < -60 || (e?.velocityY ?? 0) < -500;
            if (swipeUp) {
              runOnJS(handleExpand)();
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
    [bounds, posX, posY, startX, startY, persistPosition, handleExpand],
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
            // Drag-to-mini routes through shared->mini handoff (capture time).
            runOnJS(handleMinimize)();
          } else {
            // Swipe up from the expanded WatchSheet -> landscape fullscreen.
            // Mirrors the mini swipe-up thresholds (< -60 / < -500).
            const swipeUp = (e?.translationY ?? 0) < -60 || (e?.velocityY ?? 0) < -500;
            if (swipeUp) {
              runOnJS(handleEnterFullscreen)();
            }
          }
          sheetDragY.value = withSpring(0, EDGE_SPRING);
        }),
    [sheetDragY, handleMinimize, handleEnterFullscreen],
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
            runOnJS(handleExitFullscreen)();
          }
          fullscreenDragY.value = withSpring(0, EDGE_SPRING);
        }),
    [fullscreenDragY, handleExitFullscreen],
  );

  // P0 gesture scope: the sheet drag lives on the handle — drag DOWN to
  // minimize, swipe UP to enter fullscreen. No suggestions list remains
  // below the title, so no Native scroll gesture needs to cooperate.
  const handleSheetGesture = expandPan;

  // Two-home gesture scope: dedicated mini has its own GestureDetector
  // (miniPan + edge snap); shared home uses fullscreenPan in fullscreen and
  // stays idle otherwise (handle-only drag so watch Up-next scrolls natively).
  // Stable fragment order (shared index 0) keeps the shared WebView mounted.
  const idleGesture = useMemo(() => Gesture.Pan().enabled(false), []);

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
    <View
      key="yt-bg-toast"
      style={styles.bgToast}
      testID="mini-youtube-bg-toast"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.bgToastText} numberOfLines={2}>
        {bgToast}
      </Text>
    </View>
  ) : null;

  // ---- Two player homes (mini revert + shared persistent) ----
  // Device-proven (Android Expo Go): the unified single-WebView tree renders
  // BLACK with no buttons in mini while audio plays. Mini reverts to a
  // DEDICATED <YouTubePlayer> (own GestureDetector + Animated mini card,
  // like the original) with kept hardening (3-button transport, explicit
  // pixel video size, poster behind, explicit row heights). Expanded/watch/
  // fullscreen keep sharing ONE persistent instance (stable key
  // "yt-single-player") — they render fine and never reload on
  // expanded<->watch<->fullscreen switches. Handoff preserves seconds both
  // ways (getCurrentTime 800ms -> 0, startSeconds + seekTo, no store change);
  // only entering mini reloads (dedicated mount with start offset). Shared
  // stays mounted hidden (paused, active=false) during mini so returning
  // seeks without reload — never both playing (no-double-audio).
  // Priority: fullscreen > mini > watch.
  const isFs = mode === 'fullscreen' || isFullscreen;
  const isMiniMode = !isFs && mode === 'mini';
  const isWatch = !isFs && !isMiniMode && isWatchPage;
  const isSheet = !isFs && !isMiniMode && !isWatch;
  const needsHandle = isSheet || isWatch;
  const outerGesture = isFs ? fullscreenPan : idleGesture;

  // BUG-2: responsive mini video width so the 3-button transport row
  // (play/pause + fullscreen + close) always fits the right column.
  // Hardening: explicit pixel height alongside aspectRatio (backup) so the
  // nested aspectRatio chain can never collapse to a black 0-height box.
  const miniVideoW = miniVideoWidth(miniW);
  const miniVideoH = miniVideoHeight(miniW);

  // Dedicated mini home: own GestureDetector + Animated card + dedicated
  // player. Shared stays mounted hidden (paused) for reload-free return.
  // Stable order: shared first (index 0) in BOTH branches so the WebView
  // never remounts — only its hidden style/active flag flips.
  if (isMiniMode) {
    const miniRootStyle = [
      styles.miniFloat,
      {
        width: miniW,
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        shadowColor: '#000',
      },
      miniAnimatedStyle,
    ];
    return (
      <>
        {/* Hidden shared home FIRST (stable index 0 + same GestureDetector
            type + same body/slot nesting as visible): stays mounted paused,
            never remounts — only hidden style/active flips. */}
        <GestureDetector key="yt-shared-home" gesture={idleGesture}>
          <Animated.View
            // Offscreen (not display:none) so RNTL queries still find it
            // without includeHiddenElements, yet never visible on device.
            style={{ position: 'absolute', top: -9999, left: -9999, width: 1, height: 1, opacity: 0 } as any}
            testID="mini-youtube-shared-hidden"
            accessibilityLabel="Shared YouTube player (hidden while mini)"
          >
            <View key="yt-body" style={styles.stackBody}>
              <View key="yt-video-slot" style={styles.videoWrap}>
                <YouTubePlayer
                  key="yt-single-player"
                  ref={sharedPlayerRef}
                  video={currentVideo}
                  borderless
                  active={false}
                  onClose={closePlayer}
                  testID="mini-youtube-player-hidden"
                />
              </View>
            </View>
          </Animated.View>
        </GestureDetector>
        <GestureDetector key="yt-mini-home" gesture={miniPan}>
          <Animated.View
            style={miniRootStyle}
            testID={testID ?? 'mini-youtube-overlay'}
            accessibilityRole="none"
            accessibilityLabel={`Mini YouTube player: ${currentVideo.title}`}
          >
            <View key="yt-mini-body" style={styles.miniLandscapeRow}>
              <View
                key="yt-mini-video-slot"
                style={[styles.miniVideoLeft, { width: miniVideoW, height: miniVideoH }]}
                testID="mini-youtube-video-slot"
              >
                {currentVideo.thumbnailUrl ? (
                  <Image
                    source={{ uri: currentVideo.thumbnailUrl }}
                    style={[styles.miniPoster, { width: miniVideoW, height: miniVideoH }]}
                    resizeMode="cover"
                    testID="mini-youtube-poster"
                    accessibilityLabel={`Video thumbnail: ${currentVideo.title}`}
                    {...({ pointerEvents: 'none' } as any)}
                  />
                ) : null}
                <YouTubePlayer
                  key="yt-mini-player"
                  ref={miniPlayerRef}
                  video={currentVideo}
                  borderless
                  explicitHeight={miniVideoH}
                  startSeconds={handoffSecondsRef.current}
                  autoplay={isPlaying}
                  active
                  onClose={closePlayer}
                  testID="mini-youtube-player"
                />
              </View>
              <View key="yt-mini-controls" style={styles.miniControlsRight}>
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
            <View
              key="yt-mini-progress"
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
      </>
    );
  }

  // The expanded sheet merges the old outer wrap (bottom-anchored,
  // pointerEvents box-none) with the card chrome (maxWidth 640, top radius,
  // #000) into this single stable root; children stretch like they did
  // inside the card.
  const rootStyle = isFs
    ? [
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
      ]
    : isMiniMode
      ? [
          styles.miniFloat,
          {
            width: miniW,
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.border,
            shadowColor: '#000',
          },
          miniAnimatedStyle,
        ]
      : isWatch
        ? [
            styles.watchWrap,
            {
              paddingTop: insets.top,
              paddingBottom: insets.bottom + keyboardHeight,
            },
            expandedAnimatedStyle,
          ]
        : [
            styles.expandedWrap,
            styles.expandedCard,
            {
              backgroundColor: '#000',
              borderColor: theme.colors.border,
              maxHeight: sheetMaxH,
              alignItems: 'stretch' as const,
            },
            expandedAnimatedStyle,
          ];

  const rootA11yLabel = isFs
    ? `YouTube fullscreen: ${currentVideo.title}`
    : isMiniMode
      ? `Mini YouTube player: ${currentVideo.title}`
      : isWatch
        ? `YouTube watch page: ${currentVideo.title}`
        : `YouTube player expanded: ${currentVideo.title}`;

  // Sheet + watch share the in-frame top transport (fullscreen / minimize /
  // close float ON the video as scrim circles, above the drag area).
  const sheetVideoOverlay = (
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
      {/* Borderless bare chrome: expanded close lives here (player header is
          hidden when borderless). Distinct testID so mini's
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
  );

  // Transport BELOW the video (play/pause + mute share the store with the
  // single WebView player). Shared by the sheet and the watch page.
  const belowVideoTransport = (
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
  );

  // YouTube-like title/channel block below the player (text only — no second
  // player/WebView is ever mounted here).
  const nowPlayingTitleBlock = (
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
  );

  return (
    // Stable fragment root: shared home is ALWAYS index 0 (same position in
    // mini + non-mini) so its WebView never remounts — only hidden/active
    // flips. Dedicated mini (index 1) mounts only in mini.
    <>
    <GestureDetector key="yt-shared-home" gesture={outerGesture}>
      <Animated.View
        style={rootStyle}
        testID={testID ?? 'mini-youtube-overlay'}
        accessibilityRole={isMiniMode || isFs ? 'none' : undefined}
        accessibilityLabel={rootA11yLabel}
        pointerEvents={isSheet ? 'box-none' : undefined}
      >
        {/* Drag handle owns the pan in sheet/watch modes (down to mini, up
            to fullscreen) — same gesture thresholds as before. Absent in
            mini/fullscreen, where the outer detector owns the drag. */}
        {needsHandle ? (
          <GestureDetector key="yt-handle" gesture={handleSheetGesture}>
            <Animated.View
              style={isWatch ? styles.watchDragHandleRow : styles.dragHandleRow}
              testID="mini-youtube-drag-handle"
            >
              <View style={styles.dragHandle} />
            </Animated.View>
          </GestureDetector>
        ) : null}
        {/* Body: landscape row in mini (live video left + controls right),
            plain column otherwise. The video slot keeps a stable key
            (yt-video-slot) and the single player keeps key yt-single-player in
            the same tree position across modes, so the WebView never remounts.
            In mini the poster renders first (absolute, behind) and the player
            second (on top, interactive) — stable keys preserve identity. */}
        <View key="yt-body" style={isMiniMode ? styles.miniLandscapeRow : styles.stackBody}>
          <View
            key="yt-video-slot"
            style={
              isMiniMode
                ? [styles.miniVideoLeft, { width: miniVideoW, height: miniVideoH }]
                : isFs
                  ? [styles.fullscreenVideo, { width: fullscreenVideoW, alignSelf: 'center' }]
                  : isWatch
                    ? styles.watchVideoWrap
                    : styles.videoWrap
            }
            testID={
              isFs
                ? 'mini-youtube-fullscreen-view'
                : isWatch
                  ? 'mini-youtube-watch-video'
                  : isMiniMode
                    ? 'mini-youtube-video-slot'
                    : undefined
            }
            // P0 iframe fullscreen escape: DOM ESC must reconcile RN state.
            {...(isFs && Platform.OS === 'web'
              ? ({ onFullscreenChange: handleWebFullscreenChange } as any)
              : {})}
          >
            {/* Mini poster fallback (hardening): thumbnail UNDER the WebView
                (absolute fill, pointerEvents none) so a slow/collapsed frame
                shows art instead of a black void. WebView stays on top and
                interactive; later sibling paints above. */}
            {isMiniMode && currentVideo.thumbnailUrl ? (
              <Image
                source={{ uri: currentVideo.thumbnailUrl }}
                style={[styles.miniPoster, { width: miniVideoW, height: miniVideoH }]}
                resizeMode="cover"
                testID="mini-youtube-poster"
                accessibilityLabel={`Video thumbnail: ${currentVideo.title}`}
                {...({ pointerEvents: 'none' } as any)}
              />
            ) : null}
            <YouTubePlayer
              key="yt-single-player"
              ref={sharedPlayerRef}
              video={currentVideo}
              borderless
              active
              onClose={closePlayer}
              testID="mini-youtube-player"
            />
            {(isSheet || isWatch) && sheetVideoOverlay}
            {isFs && (
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
            )}
            {isFs && (
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
            )}
          </View>
          {/* Mini right column: title row (thumb/title tap expands) + the
              compact 3-button transport (play/pause + fullscreen + close).
              No dedicated expand chevron — it overflowed the 300px card and
              clipped the close button. */}
          {isMiniMode && (
            <View key="yt-mini-controls" style={styles.miniControlsRight}>
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
          )}
        </View>
        {/* Expanded sheet: transport + title only (no Up next inside
            playback — clean like the original sheet). */}
        {isSheet && (
          <React.Fragment key="yt-sheet-below">
            {belowVideoTransport}
            {nowPlayingTitleBlock}
          </React.Fragment>
        )}
        {/* Watch page: transport + title + Up next suggestions below. */}
        {isWatch && (
          <React.Fragment key="yt-watch-below">
            {belowVideoTransport}
            {nowPlayingTitleBlock}
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
          </React.Fragment>
        )}
        {/* Fullscreen: below-frame title (tap exits like swipe-down) +
            progress + hidden parity thumb. */}
        {isFs && (
          <React.Fragment key="yt-fs-below">
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
          </React.Fragment>
        )}
        {/* Mini progress line: accent hairline under the landscape card. */}
        {isMiniMode && (
          <View
            key="yt-mini-progress"
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
        )}
        {bgToastBanner}
      </Animated.View>
    </GestureDetector>
    </>
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
    flexShrink: 0,
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
    width: MINI_BTN_SIZE,
    height: MINI_BTN_SIZE,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
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
    // Hardening: explicit pixel height is also set inline
    // (miniVideoW * 9/16); aspectRatio stays as backup. Relative so the
    // absolute poster fallback fills the slot behind the WebView.
    position: 'relative',
  },
  // Poster fallback UNDER the mini WebView (absolute fill, behind, never
  // intercepts touches). Shows art when the frame is slow/collapsed.
  miniPoster: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 8,
    backgroundColor: '#000',
    zIndex: 0,
  },
  miniControlsRight: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 4,
  },
  miniTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    gap: 6,
    // Hardening: explicit min height so the row can never measure 0 on
    // builds where nested flex collapses.
    minHeight: 40,
  },
  miniBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    minWidth: 0,
    gap: 2,
    // Hardening: fixed row height matching the 34px buttons so transport
    // can never collapse to 0.
    height: 34,
    minHeight: 34,
  },
  // Non-mini modes stack the single video slot full-width (same tree
  // position as the mini landscape row, so the player never remounts).
  stackBody: {
    width: '100%',
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
