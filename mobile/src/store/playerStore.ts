import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import TrackPlayer, { State, RepeatMode as TpRepeatMode, Event, Capability } from 'react-native-track-player';
import { SongResponse, RepeatMode, PlaybackState } from '../types';
import { queueApi, songApi } from '../api/client';
import { BASE_URL } from '../api/client';

import { getStorage } from '../utils';

const MAX_QUEUE_CAPACITY = 100;
const queueStorage = getStorage('spotibase-cache');

const getInitialCachedQueue = (): SongResponse[] => {
  try {
    const raw = queueStorage.getString('spotibase_queue_cache');
    return raw ? JSON.parse(raw).slice(0, MAX_QUEUE_CAPACITY) : [];
  } catch {
    return [];
  }
};

const saveQueueCache = (q: SongResponse[]) => {
  try {
    queueStorage.set('spotibase_queue_cache', JSON.stringify(q.slice(0, MAX_QUEUE_CAPACITY)));
  } catch {}
};

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
  isExpanded: boolean;

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
  expandPlayer: () => void;
  collapsePlayer: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: getInitialCachedQueue(),
  playbackState: 'idle',
  position: 0,
  duration: 0,
  shuffle: false,
  repeat: 'off',
  volume: 1,
  isMiniPlayerVisible: false,
  isExpanded: false,

  play: async (track) => {
    try {
      const { currentTrack, playbackState } = get();
      if (currentTrack?.id === track.id) {
        if (playbackState === 'playing') {
          return;
        }
        set({ playbackState: 'playing', isMiniPlayerVisible: true });
        try {
          await TrackPlayer.play();
        } catch (e) {}
        return;
      }

      const trackDuration = (track.durationMs && track.durationMs > 0) ? track.durationMs / 1000 : 180;
      set({
        currentTrack: track,
        playbackState: 'loading',
        isMiniPlayerVisible: true,
        position: 0,
        duration: trackDuration,
      });
      await TrackPlayer.reset();
      const streamUrl = `${BASE_URL}/songs/${track.id}/stream`;
      await TrackPlayer.add({
        id: track.id,
        url: streamUrl,
        title: track.title,
        artist: track.artistName,
        artwork: track.coverUrl,
        duration: trackDuration,
      });
      await TrackPlayer.play();
      const existingQueue = get().queue || [];
      const isAlreadyInQueue = existingQueue.some(t => t.id === track.id);
      let nextQueue: SongResponse[];
      if (isAlreadyInQueue && existingQueue.length > 1) {
        nextQueue = existingQueue;
      } else {
        nextQueue = [track, ...existingQueue.filter(t => t.id !== track.id)].slice(0, MAX_QUEUE_CAPACITY);
      }
      saveQueueCache(nextQueue);
      set({
        currentTrack: track,
        queue: nextQueue,
        playbackState: 'playing',
        isMiniPlayerVisible: true,
        position: 0,
        duration: trackDuration,
      });

      // Background non-blocking sync & queue enrichment
      queueApi.addToQueue(track.id, track.albumId ? 'ALBUM' : 'SONG').catch(() => {});
      if (nextQueue.length <= 1) {
        songApi.getAll(0, 20).then(res => {
          const catalogSongs = res?.data?.content || (Array.isArray(res?.data) ? res?.data : []);
          const additional = catalogSongs.filter((s: SongResponse) => s.id !== track.id);
          if (additional.length > 0) {
            const enriched = [track, ...additional].slice(0, MAX_QUEUE_CAPACITY);
            set({ queue: enriched });
            saveQueueCache(enriched);
          }
        }).catch(() => {});
      }
    } catch (err: any) {
      set({ playbackState: 'idle', currentTrack: null });
      if (err?.name !== 'AbortError') {
        console.error('Play error:', err);
      }
    }
  },

  playMultiple: async (tracks, startIndex = 0) => {
    try {
      if (!tracks || tracks.length === 0) return;
      const validIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
      const targetSong = tracks[validIndex];
      const { currentTrack, playbackState } = get();

      if (currentTrack?.id === targetSong.id) {
        if (playbackState === 'playing') {
          return;
        }
        set({ playbackState: 'playing', isMiniPlayerVisible: true });
        try {
          await TrackPlayer.play();
        } catch (e) {}
        return;
      }

      const boundedTracks = tracks.slice(0, MAX_QUEUE_CAPACITY);
      const trackDuration = (targetSong.durationMs && targetSong.durationMs > 0) ? targetSong.durationMs / 1000 : 180;
      set({
        currentTrack: targetSong,
        queue: boundedTracks,
        playbackState: 'loading',
        isMiniPlayerVisible: true,
        position: 0,
        duration: trackDuration,
      });

      await TrackPlayer.reset();
      const playerTracks = boundedTracks.map(t => ({
        id: t.id,
        url: `${BASE_URL}/songs/${t.id}/stream`,
        title: t.title,
        artist: t.artistName,
        artwork: t.coverUrl,
        duration: (t.durationMs && t.durationMs > 0) ? t.durationMs / 1000 : 180,
      }));
      await TrackPlayer.add(playerTracks);
      if (validIndex > 0) {
        await TrackPlayer.skip(validIndex);
      }
      await TrackPlayer.play();
      saveQueueCache(boundedTracks);
      set({ currentTrack: targetSong, queue: boundedTracks, playbackState: 'playing', isMiniPlayerVisible: true, position: 0, duration: trackDuration });
    } catch (err: any) {
      set({ playbackState: 'idle', currentTrack: null });
      if (err?.name !== 'AbortError') {
        console.error('Play multiple error:', err);
      }
    }
  },

  pause: async () => {
    set({ playbackState: 'paused' });
    try {
      await TrackPlayer.pause();
    } catch (e) {}
  },

  resume: async () => {
    set({ playbackState: 'playing' });
    try {
      await TrackPlayer.play();
    } catch (e) {}
  },

  togglePlayPause: async () => {
    const { playbackState, currentTrack, queue } = get();
    if (!currentTrack) {
      if (queue && queue.length > 0) {
        return get().play(queue[0]);
      }
      return;
    }
    if (playbackState === 'playing' || playbackState === 'loading') {
      set({ playbackState: 'paused' });
      try {
        await TrackPlayer.pause();
      } catch (e) {}
    } else {
      set({ playbackState: 'playing' });
      try {
        await TrackPlayer.play();
      } catch (e) {}
    }
  },

  next: async () => {
    const { queue, currentTrack, shuffle, repeat } = get();
    if (!currentTrack) return;

    // repeat=one → restart current track
    if (repeat === 'one') {
      try {
        await TrackPlayer.seekTo(0);
        set({ position: 0, playbackState: 'playing' });
        await TrackPlayer.play();
      } catch (e) {}
      return;
    }

    let activeQueue = queue && queue.length > 0 ? [...queue] : [currentTrack];

    // If single track in queue, try fetching more songs from the catalog/API
    if (activeQueue.length <= 1) {
      try {
        const res = await songApi.getAll(0, 20);
        const catalogSongs = res?.data?.content || (Array.isArray(res?.data) ? res?.data : []);
        const additional = catalogSongs.filter((s: SongResponse) => s.id !== currentTrack.id);
        if (additional.length > 0) {
          activeQueue = [currentTrack, ...additional].slice(0, MAX_QUEUE_CAPACITY);
          set({ queue: activeQueue });
          saveQueueCache(activeQueue);
        }
      } catch (e) {}
    }

    const currentIndex = activeQueue.findIndex((t) => t.id === currentTrack.id);
    let nextIndex: number;

    if (shuffle && activeQueue.length > 1) {
      do {
        nextIndex = Math.floor(Math.random() * activeQueue.length);
      } while (nextIndex === currentIndex);
    } else {
      nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
      if (nextIndex >= activeQueue.length) {
        // End of queue: try fetching more or wrap around
        if (repeat === 'all' || activeQueue.length > 1) {
          nextIndex = 0; // wrap to start
        } else {
          // Single track with no additional tracks: restart from beginning
          try {
            await TrackPlayer.seekTo(0);
            set({ position: 0, playbackState: 'playing' });
            await TrackPlayer.play();
          } catch (e) {}
          return;
        }
      }
    }

    const nextSong = activeQueue[nextIndex];
    if (!nextSong) return;

    const streamUrl = `${BASE_URL}/songs/${nextSong.id}/stream`;
    const trackDuration = (nextSong.durationMs && nextSong.durationMs > 0) ? nextSong.durationMs / 1000 : 180;
    set({ currentTrack: nextSong, queue: activeQueue, position: 0, duration: trackDuration, playbackState: 'loading' });

    try {
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: nextSong.id,
        url: streamUrl,
        title: nextSong.title,
        artist: nextSong.artistName,
        artwork: nextSong.coverUrl,
        duration: trackDuration,
      });
      await TrackPlayer.play();
      set({ playbackState: 'playing' });
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error('next() TrackPlayer error:', e);
      }
      set({ playbackState: 'playing' });
    }
  },

  previous: async () => {
    const { queue, currentTrack, position, shuffle } = get();
    if (!currentTrack) return;

    // If more than 3 seconds in: restart current track
    if (position > 3) {
      try {
        await TrackPlayer.seekTo(0);
        set({ position: 0, playbackState: 'playing' });
        await TrackPlayer.play();
      } catch (e) {}
      return;
    }

    let activeQueue = queue && queue.length > 0 ? [...queue] : [currentTrack];

    // If single track in queue, try fetching more songs
    if (activeQueue.length <= 1) {
      try {
        const res = await songApi.getAll(0, 20);
        const catalogSongs = res?.data?.content || (Array.isArray(res?.data) ? res?.data : []);
        const additional = catalogSongs.filter((s: SongResponse) => s.id !== currentTrack.id);
        if (additional.length > 0) {
          activeQueue = [currentTrack, ...additional].slice(0, MAX_QUEUE_CAPACITY);
          set({ queue: activeQueue });
          saveQueueCache(activeQueue);
        }
      } catch (e) {}
    }

    const currentIndex = activeQueue.findIndex((t) => t.id === currentTrack.id);
    let prevIndex: number;

    if (shuffle && activeQueue.length > 1) {
      do {
        prevIndex = Math.floor(Math.random() * activeQueue.length);
      } while (prevIndex === currentIndex);
    } else {
      prevIndex = currentIndex > 0 ? currentIndex - 1 : activeQueue.length - 1;
      if (prevIndex < 0 || prevIndex === currentIndex) {
        // Only 1 track: just restart
        try {
          await TrackPlayer.seekTo(0);
          set({ position: 0, playbackState: 'playing' });
          await TrackPlayer.play();
        } catch (e) {}
        return;
      }
    }

    const prevSong = activeQueue[prevIndex];
    if (!prevSong) return;

    const streamUrl = `${BASE_URL}/songs/${prevSong.id}/stream`;
    const trackDuration = (prevSong.durationMs && prevSong.durationMs > 0) ? prevSong.durationMs / 1000 : 180;
    set({ currentTrack: prevSong, queue: activeQueue, position: 0, duration: trackDuration, playbackState: 'loading' });

    try {
      await TrackPlayer.reset();
      await TrackPlayer.add({
        id: prevSong.id,
        url: streamUrl,
        title: prevSong.title,
        artist: prevSong.artistName,
        artwork: prevSong.coverUrl,
        duration: trackDuration,
      });
      await TrackPlayer.play();
      set({ playbackState: 'playing' });
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        console.error('previous() TrackPlayer error:', e);
      }
      set({ playbackState: 'playing' });
    }
  },

  seekTo: async (position) => {
    set({ position });
    try {
      await TrackPlayer.seekTo(position);
    } catch (e) {}
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
    const currentQueue = get().queue;
    // Deduplicate and keep maximum 5 songs in queue cache
    const filtered = currentQueue.filter((t) => t.id !== track.id);
    let nextQueue = [...filtered, track];
    if (nextQueue.length > MAX_QUEUE_CAPACITY) {
      nextQueue = nextQueue.slice(nextQueue.length - MAX_QUEUE_CAPACITY);
    }
    try {
      await TrackPlayer.add({
        id: track.id,
        url: `${BASE_URL}/songs/${track.id}/stream`,
        title: track.title,
        artist: track.artistName,
        artwork: track.coverUrl,
        duration: (track.durationMs && track.durationMs > 0) ? track.durationMs / 1000 : 180,
      });
    } catch (e) {
      console.warn('Failed adding to TrackPlayer:', e);
    }
    saveQueueCache(nextQueue);
    set({ queue: nextQueue });
  },

  removeFromQueue: async (index) => {
    try {
      await TrackPlayer.remove(index);
    } catch (e) {
      console.warn('Failed to remove track from queue:', e);
    }
    const nextQueue = get().queue.filter((_, i) => i !== index);
    saveQueueCache(nextQueue);
    set({ queue: nextQueue });
  },

  clearQueue: async () => {
    await TrackPlayer.reset();
    saveQueueCache([]);
    set({ queue: [], currentTrack: null, playbackState: 'idle', isMiniPlayerVisible: false, isExpanded: false });
  },

  setMiniPlayerVisible: (visible) => set({ isMiniPlayerVisible: visible }),
  updatePlaybackState: (playbackState) => set({ playbackState }),
  updatePosition: (position, duration) => {
    const { position: curPos, duration: curDur } = get();
    const effectiveDur = duration > 0 ? duration : curDur;
    if (Math.abs(position - curPos) >= 0.15 || (duration > 0 && Math.abs(duration - curDur) >= 0.2)) {
      set({ position, duration: effectiveDur });
    }
  },

  expandPlayer: () => set({ isExpanded: true }),
  collapsePlayer: () => set({ isExpanded: false }),
}));

/**
 * Selector-safe subscription to the player's data slice. Components that only
 * display player state should use this (or a narrower per-field selector)
 * instead of `usePlayerStore()` without a selector, which subscribes to the
 * whole store and re-renders on every position/duration tick (~5x/sec).
 */
export const usePlayerState = () =>
  usePlayerStore(
    useShallow((s) => ({
      currentTrack: s.currentTrack,
      queue: s.queue,
      playbackState: s.playbackState,
      position: s.position,
      duration: s.duration,
      shuffle: s.shuffle,
      repeat: s.repeat,
      volume: s.volume,
      isMiniPlayerVisible: s.isMiniPlayerVisible,
      isExpanded: s.isExpanded,
    }))
  );

/**
 * Selector-safe subscription to the player's action functions. Actions are
 * stable references, so this never re-renders on position/duration ticks.
 */
export const usePlayerActions = () =>
  usePlayerStore(
    useShallow((s) => ({
      play: s.play,
      playMultiple: s.playMultiple,
      pause: s.pause,
      resume: s.resume,
      next: s.next,
      previous: s.previous,
      seekTo: s.seekTo,
      setShuffle: s.setShuffle,
      setRepeat: s.setRepeat,
      setVolume: s.setVolume,
      addToQueue: s.addToQueue,
      removeFromQueue: s.removeFromQueue,
      clearQueue: s.clearQueue,
      setMiniPlayerVisible: s.setMiniPlayerVisible,
      updatePlaybackState: s.updatePlaybackState,
      updatePosition: s.updatePosition,
      togglePlayPause: s.togglePlayPause,
      expandPlayer: s.expandPlayer,
      collapsePlayer: s.collapsePlayer,
    }))
  );

export async function setupTrackPlayer() {
  try {
    await TrackPlayer.setupPlayer();
  } catch (err: any) {
    if (!err?.message?.includes('already been initialized') && err?.code !== 'player_already_initialized') {
      console.error('TrackPlayer setup error:', err);
      return;
    }
  }

  try {
    await TrackPlayer.updateOptions({
      progressUpdateEventInterval: 0.25,
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
    });

    TrackPlayer.addEventListener(Event.PlaybackState, (event: any) => {
      const rawState = typeof event === 'object' && event !== null && 'state' in event ? event.state : event;
      if (rawState === undefined || rawState === null) return;
      if (rawState === State.Ready || rawState === 'ready') {
        return;
      }
      const stateMap: Record<string, PlaybackState> = {
        [State.Playing]: 'playing',
        [State.Paused]: 'paused',
        [State.Buffering]: 'loading',
        [((State as any).Loading || 'loading')]: 'loading',
        [((State as any).Connecting || 'connecting')]: 'loading',
        [State.Stopped]: 'idle',
        [State.Error]: 'error',
        [State.None]: 'idle',
      };
      const mapped = stateMap[rawState];
      if (mapped) {
        usePlayerStore.getState().updatePlaybackState(mapped);
      } else {
        usePlayerStore.getState().updatePlaybackState('idle');
      }
    });

    TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, (event) => {
      if (event.position != null && event.position >= 0) {
        usePlayerStore.getState().updatePosition(event.position, event.duration || usePlayerStore.getState().duration);
      }
    });

    TrackPlayer.addEventListener(Event.RemotePlay, () => TrackPlayer.play().catch(() => {}));
    TrackPlayer.addEventListener(Event.RemotePause, () => TrackPlayer.pause().catch(() => {}));
    TrackPlayer.addEventListener(Event.RemoteNext, () => usePlayerStore.getState().next());
    TrackPlayer.addEventListener(Event.RemotePrevious, () => usePlayerStore.getState().previous());
    TrackPlayer.addEventListener(Event.RemoteSeek, (event) => TrackPlayer.seekTo(event.position).catch(() => {}));

    const handleTrackChange = async (event: any) => {
      try {
        const { queue } = usePlayerStore.getState();
        let activeTrack = event?.track || event?.nextTrack;
        if (!activeTrack) {
          activeTrack = await TrackPlayer.getActiveTrack();
        }
        if (activeTrack && activeTrack.id) {
          const matched = queue.find((t) => t.id === activeTrack.id);
          if (matched && matched.id !== usePlayerStore.getState().currentTrack?.id) {
            usePlayerStore.setState({
              currentTrack: matched,
              position: 0,
              duration: (matched.durationMs && matched.durationMs > 0) ? matched.durationMs / 1000 : activeTrack.duration || 180,
              playbackState: 'playing',
            });
          }
        }
      } catch (e) {}
    };

    if ((Event as any).PlaybackActiveTrackChanged) {
      TrackPlayer.addEventListener((Event as any).PlaybackActiveTrackChanged, handleTrackChange);
    }
    if ((Event as any).PlaybackTrackChanged) {
      TrackPlayer.addEventListener((Event as any).PlaybackTrackChanged, handleTrackChange);
    }

    // Web audio sync: attach directly to HTML5 <audio> element if in browser
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const attachWebAudioListeners = () => {
        const audioElement = (document.getElementById('react-native-track-player') ||
          document.querySelector('audio')) as HTMLAudioElement | null;
        if (audioElement && !(audioElement as any)._spotibase_listeners_attached) {
          (audioElement as any)._spotibase_listeners_attached = true;
          const onPlay = () => usePlayerStore.getState().updatePlaybackState('playing');
          const onPause = () => {
            if (usePlayerStore.getState().playbackState === 'playing') {
              usePlayerStore.getState().updatePlaybackState('paused');
            }
          };
          const onWaiting = () => {
            if (usePlayerStore.getState().playbackState === 'playing') {
              usePlayerStore.getState().updatePlaybackState('loading');
            }
          };
          const onTimeUpdate = () => {
            const pos = audioElement.currentTime;
            const dur = audioElement.duration;
            if (typeof pos === 'number' && !isNaN(pos)) {
              usePlayerStore.getState().updatePosition(pos, typeof dur === 'number' && !isNaN(dur) && dur > 0 ? dur : usePlayerStore.getState().duration);
            }
          };
          const onDurationChange = () => {
            const dur = audioElement.duration;
            if (typeof dur === 'number' && !isNaN(dur) && dur > 0) {
              usePlayerStore.getState().updatePosition(audioElement.currentTime, dur);
            }
          };
          const onEnded = () => {
            usePlayerStore.getState().next();
          };

          audioElement.addEventListener('play', onPlay);
          audioElement.addEventListener('playing', onPlay);
          audioElement.addEventListener('pause', onPause);
          audioElement.addEventListener('waiting', onWaiting);
          audioElement.addEventListener('timeupdate', onTimeUpdate);
          audioElement.addEventListener('durationchange', onDurationChange);
          audioElement.addEventListener('loadedmetadata', onDurationChange);
          audioElement.addEventListener('ended', onEnded);
        }
      };
      attachWebAudioListeners();
      const webTimer = setInterval(attachWebAudioListeners, 1000);
      if (webTimer && typeof (webTimer as any).unref === 'function') {
        (webTimer as any).unref();
      }
    }

    console.log('TrackPlayer setup complete');
  } catch (err) {
    console.error('TrackPlayer setup error:', err);
  }
}
