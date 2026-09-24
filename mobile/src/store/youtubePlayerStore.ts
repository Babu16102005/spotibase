import { create } from 'zustand';
import type { YouTubeVideo } from '../types/youtube';
import { usePlayerStore } from './playerStore';

interface YouTubePlayerState {
  /** Currently loaded video — single-player: only one plays at a time. */
  currentVideo: YouTubeVideo | null;
  isPlaying: boolean;
  /**
   * Load a video and start playback. Pauses any running audio track first
   * (mutual exclusion vs playerStore) so audio + video never overlap.
   */
  playVideo: (video: YouTubeVideo) => void;
  pauseVideo: () => void;
  resumeVideo: () => void;
  /** Unload the player (used when leaving the screen / closing inline player). */
  closePlayer: () => void;
  /** Alias for closePlayer: fully stop + unmount so no audio lingers. */
  stopVideo: () => void;
  /**
   * Called when audio playback takes over (e.g. user taps a song while a
   * video is playing) so the video UI can pause its presentation.
   */
  notifyAudioStarted: () => void;
}

export const useYouTubePlayerStore = create<YouTubePlayerState>((set) => ({
  currentVideo: null,
  isPlaying: false,

  playVideo: (video) => {
    // Mutual exclusion: YouTube video wins — pause audio immediately.
    // Fire-and-forget; never blocks video presentation on audio teardown.
    try {
      const audio = usePlayerStore.getState();
      const state = audio.playbackState;
      if (state === 'playing' || state === 'loading') {
        void audio.pause().catch(() => {});
      }
    } catch {}
    set({ currentVideo: video, isPlaying: true });
  },

  pauseVideo: () => set({ isPlaying: false }),

  resumeVideo: () => {
    try {
      const audio = usePlayerStore.getState();
      const state = audio.playbackState;
      if (state === 'playing' || state === 'loading') {
        void audio.pause().catch(() => {});
      }
    } catch {}
    set((s) => (s.currentVideo ? { isPlaying: true } : s));
  },

  closePlayer: () => set({ currentVideo: null, isPlaying: false }),

  stopVideo: () => set({ currentVideo: null, isPlaying: false }),

  notifyAudioStarted: () =>
    set((s) => (s.isPlaying ? { isPlaying: false } : s)),
}));

export default useYouTubePlayerStore;
