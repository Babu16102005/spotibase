import { create } from 'zustand';
import type { YouTubeVideo } from '../types/youtube';
import { usePlayerStore } from './playerStore';
import { emitVideoStarted, onAudioStarted, setYoutubeActive } from './playbackExclusion';

/** Overlay presentation: full bottom sheet vs draggable mini bar vs landscape fullscreen. */
export type YouTubeOverlayMode = 'mini' | 'expanded' | 'fullscreen';

/** Draggable mini position in window coordinates (top-left origin). */
export interface YouTubeSnapPosition {
  x: number;
  y: number;
}

interface YouTubePlayerState {
  /** Currently loaded video — single-player: only one plays at a time. */
  currentVideo: YouTubeVideo | null;
  isPlaying: boolean;
  /** Overlay mode: expanded bottom sheet, draggable mini bar, or landscape fullscreen. */
  mode: YouTubeOverlayMode;
  /**
   * Where exitFullscreen() returns to. Tracks the last non-fullscreen mode
   * so a fullscreen swipe-down restores mini vs expanded correctly.
   */
  returnMode: 'mini' | 'expanded';
  /** Mirror of mode === 'fullscreen' for cheap selectors + orientation effects. */
  isFullscreen: boolean;
  /** Last snapped mini position (null = default bottom-right). */
  snapPosition: YouTubeSnapPosition | null;
  /**
   * Shared mute flag: the expanded sheet controlRow + the standalone
   * footer toggle write it, YouTubePlayer (single WebView) sends the
   * IFrame mute/unMute bridge when it changes. Fresh loads start unmuted.
   */
  isMuted: boolean;
  setMuted: (muted: boolean) => void;
  /**
   * P0-2 replay nonce: bumps on same-video replay so the WebView reloads
   * (or seeks to 0 + plays) even when videoId is unchanged. YouTubePlayer
   * subscribes and forces a reload/seek on change.
   */
  replayNonce: number;
  setMode: (mode: YouTubeOverlayMode) => void;
  setSnapPosition: (position: YouTubeSnapPosition | null) => void;
  /** Alias for setSnapPosition (spec name). */
  setPosition: (position: YouTubeSnapPosition | null) => void;
  /**
   * Enter landscape fullscreen. Remembers the current non-fullscreen mode
   * as returnMode (or uses the explicit override) so exit restores it.
   */
  enterFullscreen: (returnTo?: 'mini' | 'expanded') => void;
  /** Leave fullscreen and restore returnMode (defaults to expanded). */
  exitFullscreen: () => void;
  /** Toggle between fullscreen and returnMode. */
  toggleFullscreen: () => void;
  /**
   * Load a video and start playback. Pauses any running audio track first
   * (mutual exclusion vs playerStore) so audio + video never overlap.
   * Same-videoId replay bumps replayNonce so the player restarts.
   */
  playVideo: (video: YouTubeVideo) => void;
  pauseVideo: () => void;
  resumeVideo: () => void;
  /** Replay the current video even when the videoId is unchanged. */
  replayCurrent: () => void;
  /** Unload the player (used when leaving the screen / closing inline player). */
  closePlayer: () => void;
  /** Alias for closePlayer: fully stop + unmount so no audio lingers. */
  stopVideo: () => void;
  /**
   * Called when audio playback takes over (e.g. user taps a song while a
   * video is playing) so the video UI can pause its presentation.
   */
  notifyAudioStarted: () => void;
  /**
   * True while the YouTubeWatchScreen is focused. The global overlay reads
   * this to render the full-page YouTube watch layout (video pinned at the
   * very top + Up next below) instead of the bottom-anchored sheet.
   */
  watchPageActive: boolean;
  setWatchPageActive: (active: boolean) => void;
}

export const useYouTubePlayerStore = create<YouTubePlayerState>((set) => ({
  currentVideo: null,
  isPlaying: false,
  mode: 'expanded',
  returnMode: 'expanded',
  isFullscreen: false,
  snapPosition: null,
  replayNonce: 0,
  isMuted: false,
  watchPageActive: false,

  setMuted: (muted) => set({ isMuted: muted }),

  setWatchPageActive: (active) => set({ watchPageActive: active }),

  setMode: (mode) =>
    set((s) =>
      mode === 'fullscreen'
        ? {
            mode,
            isFullscreen: true,
            // Entering fullscreen via setMode keeps the last non-fullscreen
            // mode so exitFullscreen() restores mini vs expanded correctly.
            returnMode:
              s.mode === 'fullscreen' ? s.returnMode : (s.mode as 'mini' | 'expanded'),
          }
        : { mode, isFullscreen: false, returnMode: mode },
    ),

  enterFullscreen: (returnTo) =>
    set((s) => ({
      mode: 'fullscreen',
      isFullscreen: true,
      returnMode:
        returnTo ?? (s.mode === 'fullscreen' ? s.returnMode : (s.mode as 'mini' | 'expanded')),
    })),

  exitFullscreen: () =>
    set((s) => ({ mode: s.returnMode ?? 'expanded', isFullscreen: false })),

  toggleFullscreen: () =>
    set((s) =>
      s.mode === 'fullscreen'
        ? { mode: s.returnMode ?? 'expanded', isFullscreen: false }
        : {
            mode: 'fullscreen',
            isFullscreen: true,
            returnMode: s.mode as 'mini' | 'expanded',
          },
    ),

  setSnapPosition: (position) => set({ snapPosition: position }),

  setPosition: (position) => set({ snapPosition: position }),

  playVideo: (video) => {
    // Mutual exclusion (sync): YouTube video wins — pause audio immediately
    // in the same tick and synchronously invalidate any in-flight audio
    // play via the shared exclusion bus, so a pending audio continuation
    // cannot flip back to playing after the video started.
    try {
      const audio = usePlayerStore.getState();
      const state = audio.playbackState;
      if (state === 'playing' || state === 'loading') {
        void audio.pause().catch(() => {});
      }
    } catch {}
    try {
      emitVideoStarted();
    } catch {}
    try {
      setYoutubeActive(true);
    } catch {}
    // P0-2: same-videoId replay must restart playback — bump replayNonce so
    // YouTubePlayer reloads / seeks even though videoId is unchanged.
    // A fresh tap always opens the expanded sheet; the user can minimize after.
    set((s) =>
      s.currentVideo?.videoId === video.videoId
        ? { currentVideo: video, isPlaying: true, mode: 'expanded', returnMode: 'expanded', isFullscreen: false, isMuted: false, replayNonce: s.replayNonce + 1 }
        : { currentVideo: video, isPlaying: true, mode: 'expanded', returnMode: 'expanded', isFullscreen: false, isMuted: false },
    );
  },

  pauseVideo: () => {
    try {
      setYoutubeActive(false);
    } catch {}
    set({ isPlaying: false });
  },

  resumeVideo: () => {
    try {
      const audio = usePlayerStore.getState();
      const state = audio.playbackState;
      if (state === 'playing' || state === 'loading') {
        void audio.pause().catch(() => {});
      }
    } catch {}
    try {
      emitVideoStarted();
    } catch {}
    try {
      setYoutubeActive(true);
    } catch {}
    set((s) => (s.currentVideo ? { isPlaying: true } : s));
  },

  replayCurrent: () => {
    try {
      const audio = usePlayerStore.getState();
      const state = audio.playbackState;
      if (state === 'playing' || state === 'loading') {
        void audio.pause().catch(() => {});
      }
    } catch {}
    try {
      emitVideoStarted();
    } catch {}
    try {
      setYoutubeActive(true);
    } catch {}
    set((s) =>
      s.currentVideo ? { isPlaying: true, mode: 'expanded', returnMode: 'expanded', isFullscreen: false, isMuted: false, replayNonce: s.replayNonce + 1 } : s,
    );
  },

  closePlayer: () => {
    try {
      setYoutubeActive(false);
    } catch {}
    set({ currentVideo: null, isPlaying: false, mode: 'expanded', returnMode: 'expanded', isFullscreen: false, snapPosition: null, isMuted: false });
  },

  stopVideo: () => {
    try {
      setYoutubeActive(false);
    } catch {}
    set({ currentVideo: null, isPlaying: false, mode: 'expanded', returnMode: 'expanded', isFullscreen: false, snapPosition: null, isMuted: false });
  },

  notifyAudioStarted: () => {
    try {
      setYoutubeActive(false);
    } catch {}
    set((s) => (s.isPlaying ? { isPlaying: false } : s));
  },
}));

// P0-3 sync reverse exclusion: audio winning pauses video presentation in the
// same tick via the shared bus (no dynamic import() async gap).
try {
  onAudioStarted(() => {
    try {
      const s = useYouTubePlayerStore.getState();
      if (s.isPlaying) s.notifyAudioStarted();
    } catch {}
  });
} catch {}

export default useYouTubePlayerStore;
