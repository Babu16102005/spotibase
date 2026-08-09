import { create } from 'zustand';
import TrackPlayer, { State, RepeatMode as TpRepeatMode, Event } from 'react-native-track-player';
import { SongResponse, RepeatMode, PlaybackState } from '../types';
import { queueApi } from '../api/client';
import { BASE_URL } from '../api/client';

interface PlayerState {
  currentTrack: SongResponse | null;
  queue: SongResponse[];
  playbackState: PlaybackState;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  isMiniPlayerVisible: boolean;

  play: (track: SongResponse) => Promise<void>;
  playMultiple: (tracks: SongResponse[], startIndex?: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  setShuffle: (enabled: boolean) => void;
  setRepeat: (mode: RepeatMode) => void;
  setVolume: (volume: number) => void;
  addToQueue: (track: SongResponse) => Promise<void>;
  removeFromQueue: (index: number) => void;
  clearQueue: () => Promise<void>;
  setMiniPlayerVisible: (visible: boolean) => void;
  updatePlaybackState: (state: PlaybackState) => void;
  updatePosition: (position: number, duration: number) => void;
  togglePlayPause: () => Promise<void>;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  playbackState: 'idle',
  position: 0,
  duration: 0,
  shuffle: false,
  repeat: 'off',
  volume: 1,
  isMiniPlayerVisible: false,

  play: async (track) => {
    try {
      await TrackPlayer.reset();
      const streamUrl = `${BASE_URL}/songs/${track.id}/stream`;
      await TrackPlayer.add({
        id: track.id,
        url: streamUrl,
        title: track.title,
        artist: track.artistName,
        artwork: track.coverUrl,
        duration: track.durationMs / 1000,
      });
      await TrackPlayer.play();
      set({ currentTrack: track, playbackState: 'playing', isMiniPlayerVisible: true });
      await queueApi.addToQueue(track.id, track.albumId ? 'ALBUM' : 'SONG');
    } catch (err) {
      console.error('Play error:', err);
    }
  },

  playMultiple: async (tracks, startIndex = 0) => {
    try {
      await TrackPlayer.reset();
      const playerTracks = tracks.map(t => ({
        id: t.id,
        url: `${BASE_URL}/songs/${t.id}/stream`,
        title: t.title,
        artist: t.artistName,
        artwork: t.coverUrl,
        duration: t.durationMs / 1000,
      }));
      await TrackPlayer.add(playerTracks);
      await TrackPlayer.skip(startIndex);
      await TrackPlayer.play();
      set({ currentTrack: tracks[startIndex], queue: tracks, playbackState: 'playing', isMiniPlayerVisible: true });
    } catch (err) {
      console.error('Play multiple error:', err);
    }
  },

  pause: async () => {
    await TrackPlayer.pause();
    set({ playbackState: 'paused' });
  },

  resume: async () => {
    await TrackPlayer.play();
    set({ playbackState: 'playing' });
  },

  next: async () => {
    await TrackPlayer.skipToNext();
    const state = await TrackPlayer.getPlaybackState();
    set({ playbackState: state.state === State.Playing ? 'playing' : 'paused' });
  },

  previous: async () => {
    await TrackPlayer.skipToPrevious();
    const state = await TrackPlayer.getPlaybackState();
    set({ playbackState: state.state === State.Playing ? 'playing' : 'paused' });
  },

  seekTo: async (position) => {
    await TrackPlayer.seekTo(position);
    set({ position });
  },

  setShuffle: (enabled) => {
    set({ shuffle: enabled });
  },

  setRepeat: (mode) => {
    set({ repeat: mode });
    const tpMode = mode === 'off' ? TpRepeatMode.Off : mode === 'all' ? TpRepeatMode.Queue : TpRepeatMode.Track;
    TrackPlayer.setRepeatMode(tpMode);
  },

  setVolume: async (volume) => {
    await TrackPlayer.setVolume(volume);
    set({ volume });
  },

  addToQueue: async (track) => {
    await TrackPlayer.add({
      id: track.id,
      url: `${BASE_URL}/songs/${track.id}/stream`,
      title: track.title,
      artist: track.artistName,
      artwork: track.coverUrl,
      duration: track.durationMs / 1000,
    });
    set((state) => ({ queue: [...state.queue, track] }));
  },

  removeFromQueue: async (index) => {
    try {
      await TrackPlayer.remove(index);
    } catch (e) {
      console.warn('Failed to remove track from queue:', e);
    }
    set((state) => ({ queue: state.queue.filter((_, i) => i !== index) }));
  },

  clearQueue: async () => {
    await TrackPlayer.reset();
    set({ queue: [], currentTrack: null, playbackState: 'idle', isMiniPlayerVisible: false });
  },

  setMiniPlayerVisible: (visible) => set({ isMiniPlayerVisible: visible }),
  updatePlaybackState: (playbackState) => set({ playbackState }),
  updatePosition: (position, duration) => set({ position, duration }),

  togglePlayPause: async () => {
    const state = await TrackPlayer.getPlaybackState();
    if (state.state === State.Playing) {
      await TrackPlayer.pause();
      set({ playbackState: 'paused' });
    } else {
      await TrackPlayer.play();
      set({ playbackState: 'playing' });
    }
  },
}));

export async function setupTrackPlayer() {
  try {
    await TrackPlayer.setupPlayer();

    TrackPlayer.addEventListener(Event.PlaybackState, (event) => {
      const stateMap: Record<string, PlaybackState> = {
        [State.Playing]: 'playing',
        [State.Paused]: 'paused',
        [State.Buffering]: 'loading',
        [State.Stopped]: 'idle',
        [State.Error]: 'error',
        [State.None]: 'idle',
      };
      usePlayerStore.getState().updatePlaybackState(stateMap[event.state] || 'idle');
    });

    TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (event) => {
      usePlayerStore.getState().updatePosition(event.position, event.duration);
    });

    TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play());
    TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause());
    TrackPlayer.addEventListener(Event.RemoteNext, () => usePlayerStore.getState().next());
    TrackPlayer.addEventListener(Event.RemotePrevious, () => usePlayerStore.getState().previous());
    TrackPlayer.addEventListener(Event.RemoteSeek, (event) => TrackPlayer.seekTo(event.position));

    console.log('TrackPlayer setup complete');
  } catch (err) {
    console.error('TrackPlayer setup error:', err);
  }
}
