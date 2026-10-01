import { Platform } from 'react-native';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import TrackPlayer, { State, RepeatMode as TpRepeatMode, Event, Capability } from 'react-native-track-player';
import { SongResponse, RepeatMode, PlaybackState } from '../types';
import { queueApi, songApi, getTrackStreamUrl, getBaseUrl } from '../api/client';

const getWebAudio = (): HTMLAudioElement | null => {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  return document.querySelector('audio[data-spotibase]') as HTMLAudioElement | null;
};

import { getStorage } from '../utils';
import { emitAudioStarted, onVideoStarted } from './playbackExclusion';

const MAX_QUEUE_CAPACITY = 100;
const queueStorage = getStorage('spotibase-cache');
const authStorage = getStorage('spotibase-auth');

// --- Spotify-smooth playback helpers --------------------------------------
// Monotonic id: every explicit play/next/prev bumps it. Async continuations
// compare their captured id and bail out when stale, so rapid taps never
// apply out-of-order (older request finishing after a newer one is ignored).
let playRequestId = 0;
// One retry per track when the CDN (R2 fileUrl) fails: fall back to /stream.
let nativeRetriedTrackId: string | null = null;
let webRetriedTrackId: string | null = null;
// Preload dedupe: warm the next track once per track.
let lastPreloadedTrackId: string | null = null;
// Former web-sync poll timer (removed; kept so unmount cleanup stays safe).
let webAudioSyncTimer: ReturnType<typeof setInterval> | null = null;

export function cleanupTrackPlayerWebSync() {
  if (webAudioSyncTimer) {
    clearInterval(webAudioSyncTimer);
    webAudioSyncTimer = null;
  }
}

const PRELOAD_PROGRESS_THRESHOLD = 0.8;
const PRELOAD_RANGE_HEADER = 'bytes=0-262143';

const getInitialCachedQueue = (): SongResponse[] => {
  try {
    const raw = queueStorage.getString('spotibase_queue_cache');
    if (!raw) return [];
    const parsed: SongResponse[] = JSON.parse(raw);
    // Deduplicate and fix old cache that had all songs (causing duplicate key warnings)
    const map = new Map<string, SongResponse>();
    for (const s of parsed) {
      if (s && s.id && !map.has(s.id)) map.set(s.id, s);
    }
    return Array.from(map.values()).slice(0, MAX_QUEUE_CAPACITY);
  } catch {
    return [];
  }
};

const saveQueueCache = (q: SongResponse[]) => {
  try {
    queueStorage.set('spotibase_queue_cache', JSON.stringify(q.slice(0, MAX_QUEUE_CAPACITY)));
  } catch {}
};

const trackDurationOf = (t: SongResponse): number =>
  t.durationMs && t.durationMs > 0 ? t.durationMs / 1000 : 180;

const toPlayerTrack = (t: SongResponse, url: string) => ({
  id: t.id,
  url,
  title: t.title,
  artist: t.artistName,
  artwork: t.coverUrl,
  duration: trackDurationOf(t),
});

/** Fallback backend stream URL (used when the R2/CDN fileUrl fails). */
const getStreamFallbackUrl = (track: { id?: string }): string =>
  `${getBaseUrl()}/songs/${track?.id}/stream`;

/**
 * P0-1: direct-CDN plays bypass backend /stream so no play is ever counted.
 * After a successful direct play, fire-and-forget GET
 * /songs/{id}/stream?count=1 with Range bytes=0-0 (1 byte, no body needed).
 * Backend counts start==0 or ?count=1; seeks and prefetch warmups never call
 * this. AbortController 5s, silent catch. Skips when the URL already hits
 * backend /stream (backend counts those itself).
 */
const pingDirectPlayCount = (trackId?: string, streamUrl?: string) => {
  try {
    if (!trackId || !streamUrl) return;
    if (streamUrl.includes(`/songs/${trackId}/stream`)) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, 5000);
    const headers: Record<string, string> = { Range: 'bytes=0-0' };
    try {
      const token = authStorage.getString('accessToken');
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {}
    fetch(`${getBaseUrl()}/songs/${trackId}/stream?count=1`, {
      headers,
      signal: controller.signal,
    })
      .then((res) => {
        clearTimeout(timeout);
        // Drain the 1-byte body so the bytes flow; never throws.
        try {
          const ab = (res as Response).arrayBuffer?.();
          if (ab && typeof (ab as Promise<ArrayBuffer>).catch === 'function') {
            (ab as Promise<ArrayBuffer>).catch(() => {});
          }
        } catch {}
      })
      .catch(() => {
        clearTimeout(timeout);
      });
  } catch {}
};

/**
 * P0-3 sync reverse exclusion: audio winning must pause any playing YouTube
 * video so audio + video never overlap. Uses the shared playbackExclusion
 * bus (imported synchronously by both stores) so the video pauses in the
 * same tick — no dynamic import() async gap where both keep playing.
 */
const notifyYoutubeAudioStarted = () => {
  try {
    emitAudioStarted();
  } catch {}
};

/**
 * Video wins: invalidate any in-flight audio play/next/prev so a pending
 * resolvePlaybackUrl/playOnWeb continuation cannot flip back to playing
 * after the video already paused audio. The sync listener below bumps the
 * epoch in the same tick via the shared exclusion bus (no dynamic import,
 * no cycle: this module never imports youtubePlayerStore statically).
 */
export const abortPendingAudioForVideo = () => {
  playRequestId++;
};

try {
  onVideoStarted(() => {
    playRequestId++;
  });
} catch {}

/**
 * Offline-first URL resolution. Fallback chain:
 *   local download (file://) -> fileUrl CDN -> backend /stream
 * downloadStore is imported lazily (call time, after module init) so the
 * two zustand stores can never deadlock in a require cycle.
 */
const resolvePlaybackUrl = async (track: SongResponse): Promise<string> => {
  try {
    const { useDownloadStore } = await import('./downloadStore');
    const ds = useDownloadStore.getState();
    if (track?.id && ds.isDownloaded(track.id)) {
      const dl = ds.getDownload(track.id);
      const p = dl?.filePath;
      if (p) {
        if (p.startsWith('file://') || p.startsWith('http://') || p.startsWith('https://')) return p;
        if (p.startsWith('/')) return `file://${p}`;
      }
    }
  } catch {}
  return getTrackStreamUrl(track);
};

/**
 * Fire-and-forget warmup of the upcoming track: a small Range fetch primes
 * the HTTP/CDN connection while a hidden Audio element primes the web
 * decoder. Never throws; never blocks playback.
 */
const preloadNextTrack = (url?: string | null) => {
  if (!url || !url.startsWith('http')) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, 8000);
    fetch(url, { headers: { Range: PRELOAD_RANGE_HEADER }, signal: controller.signal })
      .then((res) => {
        clearTimeout(timeout);
        // Drain a chunk so the bytes are actually pulled through caches.
        try {
          const ab = (res as Response).arrayBuffer?.();
          if (ab && typeof (ab as Promise<ArrayBuffer>).catch === 'function') {
            (ab as Promise<ArrayBuffer>).catch(() => {});
          }
        } catch {}
      })
      .catch(() => {
        clearTimeout(timeout);
      });
  } catch {}
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    try {
      const AudioCtor = (globalThis as unknown as { Audio?: typeof Audio }).Audio;
      if (typeof AudioCtor !== 'undefined') {
        const probe = new AudioCtor();
        probe.preload = 'auto';
        probe.src = url;
        try {
          probe.load?.();
        } catch {}
      }
    } catch {}
  }
};

/** Called from progress updates: warm the next track past 80% playback. */
const maybePreloadNext = (position: number, duration: number) => {
  try {
    if (!duration || duration <= 0 || !position || position <= 0) return;
    if (position / duration < PRELOAD_PROGRESS_THRESHOLD) return;
    const { queue, currentTrack } = usePlayerStore.getState();
    if (!currentTrack || queue.length < 2) return;
    const idx = queue.findIndex((t) => t.id === currentTrack.id);
    const nextSong = idx >= 0 ? queue[idx + 1] : undefined;
    if (!nextSong || nextSong.id === lastPreloadedTrackId) return;
    lastPreloadedTrackId = nextSong.id;
    // Resolve async; the warmup itself is fire-and-forget.
    void resolvePlaybackUrl(nextSong).then(preloadNextTrack).catch(() => {});
  } catch {}
};

// --- Web singleton audio ----------------------------------------------------

const ensureWebAudio = (): HTMLAudioElement | null => {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  let audio = getWebAudio();
  if (!audio) {
    audio = document.createElement('audio');
    audio.setAttribute('data-spotibase', 'true');
    audio.preload = 'auto';
    audio.style.display = 'none';
    document.body.appendChild(audio);
  }
  wireWebAudioSingleton(audio);
  return audio;
};

let webAudioWired: HTMLAudioElement | null = null;

/** Wire real Buffering/Playing/Error mapping onto the singleton (idempotent). */
const wireWebAudioSingleton = (audio: HTMLAudioElement) => {
  if (webAudioWired === audio && (audio as unknown as { _spotibase_wired?: boolean })._spotibase_wired) return;
  (audio as unknown as { _spotibase_wired?: boolean })._spotibase_wired = true;
  webAudioWired = audio;
  audio.onended = () => {
    try {
      void usePlayerStore.getState().next();
    } catch {}
  };
  audio.ontimeupdate = () => {
    try {
      if (!isNaN(audio.currentTime)) {
        usePlayerStore
          .getState()
          .updatePosition(
            audio.currentTime,
            !isNaN(audio.duration) && audio.duration > 0 ? audio.duration : usePlayerStore.getState().duration,
          );
      }
    } catch {}
  };
  audio.onpause = () => {
    try {
      if (usePlayerStore.getState().playbackState === 'playing') usePlayerStore.setState({ playbackState: 'paused' });
    } catch {}
  };
  audio.onplaying = () => {
    try {
      usePlayerStore.setState({ playbackState: 'playing' });
    } catch {}
  };
  audio.onwaiting = () => {
    try {
      if (usePlayerStore.getState().playbackState === 'playing') usePlayerStore.setState({ playbackState: 'loading' });
    } catch {}
  };
  audio.onstalled = () => {
    try {
      if (usePlayerStore.getState().playbackState === 'playing') usePlayerStore.setState({ playbackState: 'loading' });
    } catch {}
  };
  const markReady = () => {
    try {
      if (usePlayerStore.getState().playbackState === 'loading') usePlayerStore.setState({ playbackState: 'playing' });
    } catch {}
  };
  try {
    audio.addEventListener('canplaythrough', markReady);
  } catch {}
  audio.onerror = () => {
    void (async () => {
      try {
        const { currentTrack } = usePlayerStore.getState();
        if (!currentTrack) return;
        const src = audio.src || '';
        console.warn('[WebAudio] Stream error for URL:', src);
        // Single retry: R2/CDN fileUrl -> backend /stream fallback.
        if (webRetriedTrackId !== currentTrack.id && (src.startsWith('http://') || src.startsWith('https://'))) {
          webRetriedTrackId = currentTrack.id;
          const fallback = getStreamFallbackUrl(currentTrack);
          if (fallback && fallback !== src) {
            try {
              audio.src = fallback;
              audio.load();
              audio.currentTime = 0;
              await audio.play().catch(() => {});
              return;
            } catch {}
          }
        }
        if (usePlayerStore.getState().currentTrack?.id === currentTrack.id) {
          usePlayerStore.setState({ playbackState: 'error' });
        }
      } catch {}
    })();
  };
};

/**
 * Web playback path: HTML audio element ONLY (no TrackPlayer.reset/add on
 * web — the web stub has no real queue and duplicated adds caused
 * double-loads). Resolves when the browser can actually render audio
 * (canplaythrough / buffered > 1.5s / playing event), not via a timer hack.
 */
const playOnWeb = async (
  track: SongResponse,
  url: string,
  trackDuration: number,
  myReq: number,
): Promise<void> => {
  const audio = ensureWebAudio();
  if (!audio) throw new Error('Web audio unavailable');
  webRetriedTrackId = null;
  usePlayerStore.setState({ playbackState: 'loading', position: 0 });
  audio.src = url;
  audio.load();
  try {
    audio.currentTime = 0;
  } catch {}
  const canPlay = new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    try {
      audio.addEventListener('canplaythrough', finish, { once: true });
    } catch {}
    // Buffered-bytes fallback: >1.5s buffered means smooth start.
    const probe = setInterval(() => {
      try {
        const st = usePlayerStore.getState();
        if (myReq !== playRequestId || st.currentTrack?.id !== track.id) {
          clearInterval(probe);
          finish();
          return;
        }
        const buffered = audio.buffered;
        if (buffered && buffered.length > 0) {
          try {
            if (buffered.end(buffered.length - 1) > 1.5) {
              clearInterval(probe);
              finish();
              return;
            }
          } catch {}
        }
        if (audio.readyState >= 3) {
          clearInterval(probe);
          finish();
        }
      } catch {}
    }, 150);
    // Hard cap so a stalled stream still surfaces an error instead of
    // hanging in loading forever.
    setTimeout(() => {
      try {
        clearInterval(probe);
      } catch {}
      finish();
    }, 12000);
  });
  await audio.play().catch(() => {});
  if (myReq !== playRequestId) return;
  await canPlay;
  if (myReq !== playRequestId) return;
  // Only leave loading when the element is really rendering.
  try {
    const buffered = audio.buffered;
    const bufferedEnough =
      (buffered && buffered.length > 0 && (() => { try { return buffered.end(buffered.length - 1) > 1.5; } catch { return false; } })()) ||
      audio.readyState >= 3;
    if (bufferedEnough || !audio.paused) {
      if (usePlayerStore.getState().currentTrack?.id === track.id) usePlayerStore.setState({ playbackState: 'playing' });
    }
    // Otherwise onplaying/canplaythrough handlers flip the state when ready.
  } catch {}
};

// --- Native queue-preserving playback --------------------------------------
// The TrackPlayer queue is NEVER reset on tap. Single taps skip() when the
// track is already queued, else setQueue([track]). next/prev skip within the
// kept queue (adding the target first when it is not queued yet).

const playSingleOnNative = async (track: SongResponse, url: string, trackDuration: number, myReq: number): Promise<boolean> => {
  const playerTrack = toPlayerTrack(track, url);
  // Fast path: track already queued -> just skip to it.
  try {
    const q = (await TrackPlayer.getQueue()) as unknown as Array<{ id?: string }>;
    const idx = Array.isArray(q) ? q.findIndex((t) => t?.id === track.id) : -1;
    if (idx >= 0) {
      if (myReq !== playRequestId) return false;
      await TrackPlayer.skip(idx);
      if (myReq !== playRequestId) return false;
      await TrackPlayer.play();
      return true;
    }
  } catch {}
  if (myReq !== playRequestId) return false;
  try {
    const tp = TrackPlayer as unknown as { setQueue?: (t: unknown[]) => Promise<void>; load?: (t: unknown) => Promise<void> };
    if (typeof tp.setQueue === 'function') {
      await tp.setQueue([playerTrack]);
    } else if (typeof tp.load === 'function') {
      await tp.load(playerTrack);
    } else {
      await TrackPlayer.reset();
      await TrackPlayer.add(playerTrack);
    }
  } catch {
    await TrackPlayer.reset();
    await TrackPlayer.add(playerTrack);
  }
  if (myReq !== playRequestId) return false;
  await TrackPlayer.play();
  return true;
};

/** Skip to a queued native track, adding it first when it is not queued. */
const skipToNativeTrack = async (
  song: SongResponse,
  url: string,
  direction: 'next' | 'prev',
): Promise<void> => {
  const playerTrack = toPlayerTrack(song, url);
  try {
    const q = (await TrackPlayer.getQueue().catch(() => null)) as unknown as Array<{ id?: string }> | null;
    const idx = Array.isArray(q) ? q.findIndex((t) => t?.id === song.id) : -1;
    if (idx >= 0) {
      await TrackPlayer.skip(idx);
      await TrackPlayer.play();
      return;
    }
    if (direction === 'prev') {
      // Insert before the head so skip(0) lands exactly on the target.
      try {
        await TrackPlayer.add(playerTrack, 0);
        await TrackPlayer.skip(0);
        await TrackPlayer.play();
        return;
      } catch {}
    } else {
      await TrackPlayer.add(playerTrack);
      try {
        const q2 = (await TrackPlayer.getQueue().catch(() => null)) as unknown as Array<{ id?: string }> | null;
        const idx2 = Array.isArray(q2) ? q2.findIndex((t) => t?.id === song.id) : -1;
        if (idx2 >= 0) {
          await TrackPlayer.skip(idx2);
          await TrackPlayer.play();
          return;
        }
      } catch {}
    }
    if (direction === 'next') {
      await TrackPlayer.skipToNext().catch(() => TrackPlayer.play());
    } else {
      await TrackPlayer.skipToPrevious().catch(() => TrackPlayer.play());
    }
    await TrackPlayer.play().catch(() => {});
  } catch {
    try {
      await TrackPlayer.add(playerTrack);
      if (direction === 'next') {
        await TrackPlayer.skipToNext().catch(() => {});
      } else {
        await TrackPlayer.skipToPrevious().catch(() => {});
      }
      await TrackPlayer.play();
    } catch {}
  }
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
    // P0-2: audio wins — pause any playing YouTube video first.
    notifyYoutubeAudioStarted();
    const myReq = ++playRequestId;
    const isStale = () => myReq !== playRequestId;
    try {
      const { currentTrack, playbackState } = get();
      if (currentTrack?.id === track.id) {
        if (playbackState === 'playing') {
          return;
        }
        set({ playbackState: 'playing', isMiniPlayerVisible: true });
        try {
          if (Platform.OS === 'web') {
            const wa = getWebAudio();
            if (wa) await wa.play().catch(() => {});
          } else {
            await TrackPlayer.play();
          }
        } catch (e) {}
        return;
      }

      const trackDuration = trackDurationOf(track);
      nativeRetriedTrackId = null;
      lastPreloadedTrackId = null;
      set({
        currentTrack: track,
        playbackState: 'loading',
        isMiniPlayerVisible: true,
        position: 0,
        duration: trackDuration,
      });
      const streamUrl = await resolvePlaybackUrl(track);
      if (isStale()) return;

      // Web path: HTML audio singleton only (no TrackPlayer queue churn).
      if (Platform.OS === 'web') {
        try {
          await playOnWeb(track, streamUrl, trackDuration, myReq);
          if (!isStale()) pingDirectPlayCount(track.id, streamUrl);
        } catch (e) {
          console.warn('Web audio play failed', e);
          if (!isStale() && get().currentTrack?.id === track.id) set({ playbackState: 'error' });
        }
      } else {
        try {
          await playSingleOnNative(track, streamUrl, trackDuration, myReq);
          if (!isStale()) pingDirectPlayCount(track.id, streamUrl);
        } catch (e: unknown) {
          if ((e as { name?: string })?.name !== 'AbortError') {
            console.error('Play error:', e);
          }
          throw e;
        }
        // Optimistic: show playing state immediately; TrackPlayer events will sync real state
        if (!isStale()) set({ playbackState: 'playing', isMiniPlayerVisible: true });
      }

      // FIX: Single play should NOT auto-queue all songs - queue = only current track + manually added via addToQueue
      // Previously this auto-enriched queue with all catalog songs causing "queue shows for all"
      const nextQueue: SongResponse[] = [track];
      saveQueueCache(nextQueue);
      if (isStale()) return;
      set({
        currentTrack: track,
        queue: nextQueue,
        playbackState: Platform.OS === 'web' ? get().playbackState : 'playing',
        isMiniPlayerVisible: true,
        position: 0,
        duration: trackDuration,
      });

      // Background non-blocking sync (no auto-enrichment)
      queueApi.addToQueue(track.id, track.albumId ? 'ALBUM' : 'SONG').catch(() => {});
    } catch (err: unknown) {
      if (isStale()) return;
      set({ playbackState: 'idle', currentTrack: null });
      if ((err as { name?: string })?.name !== 'AbortError') {
        console.error('Play error:', err);
      }
    }
  },

  playMultiple: async (tracks, startIndex = 0) => {
    // P0-2: audio wins — pause any playing YouTube video first.
    notifyYoutubeAudioStarted();
    const myReq = ++playRequestId;
    const isStale = () => myReq !== playRequestId;
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
          if (Platform.OS === 'web') {
            const wa = getWebAudio();
            if (wa) await wa.play().catch(() => {});
          } else {
            await TrackPlayer.play();
          }
        } catch (e) {}
        return;
      }

      const boundedTracks = tracks.slice(0, MAX_QUEUE_CAPACITY);
      const trackDuration = trackDurationOf(targetSong);
      nativeRetriedTrackId = null;
      lastPreloadedTrackId = null;
      set({
        currentTrack: targetSong,
        queue: boundedTracks,
        playbackState: 'loading',
        isMiniPlayerVisible: true,
        position: 0,
        duration: trackDuration,
      });

      // Web path: HTML audio singleton only (no duplicate TrackPlayer.add).
      if (Platform.OS === 'web') {
        try {
          const streamUrl = await resolvePlaybackUrl(targetSong);
          if (isStale()) return;
          await playOnWeb(targetSong, streamUrl, trackDuration, myReq);
          if (!isStale()) pingDirectPlayCount(targetSong.id, streamUrl);
        } catch (e) {
          console.warn('Web playMultiple failed', e);
          if (!isStale() && get().currentTrack?.id === targetSong.id) set({ playbackState: 'error' });
        }
        if (isStale()) return;
        saveQueueCache(boundedTracks);
        set({
          currentTrack: targetSong,
          queue: boundedTracks,
          playbackState: get().playbackState === 'error' ? 'error' : 'playing',
          isMiniPlayerVisible: true,
          position: 0,
          duration: trackDuration,
        });
        return;
      }

      // Native: replace the kept queue in place (no reset), then skip to start.
      const playerTracks = await Promise.all(
        boundedTracks.map(async (t) => toPlayerTrack(t, await resolvePlaybackUrl(t))),
      );
      if (isStale()) return;
      let queueSet = false;
      try {
        const tp = TrackPlayer as unknown as { setQueue?: (t: unknown[]) => Promise<void> };
        if (typeof tp.setQueue === 'function') {
          await tp.setQueue(playerTracks);
          queueSet = true;
        }
      } catch {}
      if (!queueSet) {
        await TrackPlayer.reset();
        await TrackPlayer.add(playerTracks);
      }
      if (isStale()) return;
      if (validIndex > 0) {
        await TrackPlayer.skip(validIndex);
        if (isStale()) return;
      }
      await TrackPlayer.play();
      if (isStale()) return;
      try {
        const targetUrl = (playerTracks[validIndex] as { url?: string })?.url;
        if (typeof targetUrl === 'string') pingDirectPlayCount(targetSong.id, targetUrl);
      } catch {}
      saveQueueCache(boundedTracks);
      set({ currentTrack: targetSong, queue: boundedTracks, playbackState: 'playing', isMiniPlayerVisible: true, position: 0, duration: trackDuration });
    } catch (err: unknown) {
      if (myReq !== playRequestId) return;
      set({ playbackState: 'idle', currentTrack: null });
      if ((err as { name?: string })?.name !== 'AbortError') {
        console.error('Play multiple error:', err);
      }
    }
  },

  pause: async () => {
    set({ playbackState: 'paused' });
    try {
      const wa = getWebAudio();
      if (wa) wa.pause();
      if (Platform.OS !== 'web') {
        await TrackPlayer.pause();
      }
    } catch (e) {}
  },

  resume: async () => {
    // P0-2: audio wins — pause any playing YouTube video first.
    notifyYoutubeAudioStarted();
    set({ playbackState: 'playing' });
    try {
      const wa = getWebAudio();
      if (wa) await wa.play().catch(() => {});
      if (Platform.OS !== 'web') {
        await TrackPlayer.play();
      }
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
        const wa = getWebAudio();
        if (wa) wa.pause();
        if (Platform.OS !== 'web') {
          await TrackPlayer.pause();
        }
      } catch (e) {}
    } else {
      // P0-2: audio wins — pause any playing YouTube video first.
      notifyYoutubeAudioStarted();
      set({ playbackState: 'playing' });
      try {
        const wa = getWebAudio();
        if (wa) await wa.play().catch(() => {});
        if (Platform.OS !== 'web') {
          await TrackPlayer.play();
        }
      } catch (e) {}
    }
  },

  next: async () => {
    // P0-2: audio wins — pause any playing YouTube video first.
    notifyYoutubeAudioStarted();
    const myReq = ++playRequestId;
    const isStale = () => myReq !== playRequestId;
    const { queue, currentTrack, shuffle, repeat } = get();
    if (!currentTrack) return;

    // repeat=one → restart current track
    if (repeat === 'one') {
      try {
        if (Platform.OS === 'web') {
          const wa = getWebAudio();
          if (wa) {
            wa.currentTime = 0;
            await wa.play().catch(() => {});
          }
        } else {
          await TrackPlayer.seekTo(0);
          await TrackPlayer.play();
        }
        if (!isStale()) set({ position: 0, playbackState: 'playing' });
      } catch (e) {}
      return;
    }

    const activeQueue = queue && queue.length > 0 ? [...queue] : [currentTrack];

    // FIX: Don't auto-fill queue with all catalog songs (was causing "queue shows for all")
    // Single track queue stays single - Next will just restart or stop

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
            if (Platform.OS === 'web') {
              const wa = getWebAudio();
              if (wa) {
                wa.currentTime = 0;
                await wa.play().catch(() => {});
              }
            } else {
              await TrackPlayer.seekTo(0);
              await TrackPlayer.play();
            }
            if (!isStale()) set({ position: 0, playbackState: 'playing' });
          } catch (e) {}
          return;
        }
      }
    }

    const nextSong = activeQueue[nextIndex];
    if (!nextSong) return;

    const streamUrl = await resolvePlaybackUrl(nextSong);
    if (isStale()) return;
    const trackDuration = trackDurationOf(nextSong);
    lastPreloadedTrackId = null;
    set({ currentTrack: nextSong, queue: activeQueue, position: 0, duration: trackDuration, playbackState: 'loading' });

    if (Platform.OS === 'web') {
      try {
        await playOnWeb(nextSong, streamUrl, trackDuration, myReq);
        if (isStale()) return;
        pingDirectPlayCount(nextSong.id, streamUrl);
        if (get().currentTrack?.id === nextSong.id && get().playbackState === 'loading') {
          set({ playbackState: 'playing' });
        }
        return;
      } catch (e) {
        console.warn('Web next failed', e);
        if (!isStale()) set({ playbackState: 'error' });
        return;
      }
    }

    // Native: skip within the kept queue (never reset+add single).
    try {
      await skipToNativeTrack(nextSong, streamUrl, 'next');
      if (isStale()) return;
      pingDirectPlayCount(nextSong.id, streamUrl);
      set({ playbackState: 'playing' });
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== 'AbortError') {
        console.error('next() TrackPlayer error:', e);
      }
      if (!isStale()) set({ playbackState: 'playing' });
    }
  },

  previous: async () => {
    // P0-2: audio wins — pause any playing YouTube video first.
    notifyYoutubeAudioStarted();
    const myReq = ++playRequestId;
    const isStale = () => myReq !== playRequestId;
    const { queue, currentTrack, position, shuffle } = get();
    if (!currentTrack) return;

    // If more than 3 seconds in: restart current track
    if (position > 3) {
      try {
        if (Platform.OS === 'web') {
          const wa = getWebAudio();
          if (wa) {
            wa.currentTime = 0;
            await wa.play().catch(() => {});
          }
        } else {
          await TrackPlayer.seekTo(0);
          await TrackPlayer.play();
        }
        if (!isStale()) set({ position: 0, playbackState: 'playing' });
      } catch (e) {}
      return;
    }

    const activeQueue = queue && queue.length > 0 ? [...queue] : [currentTrack];

    // FIX: Don't auto-fill queue

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
          if (Platform.OS === 'web') {
            const wa = getWebAudio();
            if (wa) {
              wa.currentTime = 0;
              await wa.play().catch(() => {});
            }
          } else {
            await TrackPlayer.seekTo(0);
            await TrackPlayer.play();
          }
          if (!isStale()) set({ position: 0, playbackState: 'playing' });
        } catch (e) {}
        return;
      }
    }

    const prevSong = activeQueue[prevIndex];
    if (!prevSong) return;

    const streamUrl = await resolvePlaybackUrl(prevSong);
    if (isStale()) return;
    const trackDuration = trackDurationOf(prevSong);
    lastPreloadedTrackId = null;
    set({ currentTrack: prevSong, queue: activeQueue, position: 0, duration: trackDuration, playbackState: 'loading' });

    if (Platform.OS === 'web') {
      try {
        await playOnWeb(prevSong, streamUrl, trackDuration, myReq);
        if (isStale()) return;
        pingDirectPlayCount(prevSong.id, streamUrl);
        if (get().currentTrack?.id === prevSong.id && get().playbackState === 'loading') {
          set({ playbackState: 'playing' });
        }
        return;
      } catch (e) {
        console.warn('Web previous failed', e);
        if (!isStale()) set({ playbackState: 'error' });
        return;
      }
    }

    // Native: skip within the kept queue (never reset+add single).
    try {
      await skipToNativeTrack(prevSong, streamUrl, 'prev');
      if (isStale()) return;
      pingDirectPlayCount(prevSong.id, streamUrl);
      set({ playbackState: 'playing' });
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== 'AbortError') {
        console.error('previous() TrackPlayer error:', e);
      }
      if (!isStale()) set({ playbackState: 'playing' });
    }
  },

  seekTo: async (position) => {
    set({ position });
    try {
      const wa = getWebAudio();
      if (wa) {
        try {
          wa.currentTime = position;
        } catch {}
      }
      if (Platform.OS !== 'web') {
        await TrackPlayer.seekTo(position);
      }
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
    try {
      const wa = getWebAudio();
      if (wa) {
        try {
          wa.volume = Math.max(0, Math.min(1, volume));
        } catch {}
      }
      if (Platform.OS !== 'web') {
        await TrackPlayer.setVolume(volume);
      }
    } catch {}
    set({ volume });
  },

  addToQueue: async (track) => {
    const currentQueue = get().queue;
    // Deduplicate and cap to MAX_QUEUE_CAPACITY (100) in memory + cache.
    const filtered = currentQueue.filter((t) => t.id !== track.id);
    let nextQueue = [...filtered, track];
    if (nextQueue.length > MAX_QUEUE_CAPACITY) {
      nextQueue = nextQueue.slice(nextQueue.length - MAX_QUEUE_CAPACITY);
    }
    try {
      // Append only — never disturb the current playback queue.
      await TrackPlayer.add(toPlayerTrack(track, await resolvePlaybackUrl(track)));
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
    // Warm the next track once playback passes 80% (Spotify-style gapless).
    maybePreloadNext(position, effectiveDur);
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
  // Spotify-smooth buffering (TrackPlayer v5 PlayerOptions). Falls back to a
  // bare setup on builds whose native module does not accept these keys.
  const bufferOptions = {
    minBuffer: 15,
    maxBuffer: 30,
    playBuffer: 2.5,
    backBuffer: 30,
    maxCacheSize: 102400,
  };
  try {
    await TrackPlayer.setupPlayer(bufferOptions);
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? '';
    const code = (err as { code?: string })?.code;
    if (!msg.includes('already been initialized') && code !== 'player_already_initialized') {
      try {
        await TrackPlayer.setupPlayer();
      } catch (retryErr: unknown) {
        const retryMsg = (retryErr as { message?: string })?.message ?? '';
        const retryCode = (retryErr as { code?: string })?.code;
        if (!retryMsg.includes('already been initialized') && retryCode !== 'player_already_initialized') {
          console.error('TrackPlayer setup error:', retryErr);
          return;
        }
      }
    }
  }

  try {
    await TrackPlayer.updateOptions({
      progressUpdateEventInterval: 0.25,
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      notificationCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.SeekTo,
      ],
      forwardJumpInterval: 15,
      backwardJumpInterval: 15,
    });

    TrackPlayer.addEventListener(Event.PlaybackState, (event: any) => {
      const rawState = typeof event === 'object' && event !== null && 'state' in event ? event.state : event;
      if (rawState === undefined || rawState === null) return;
      const stateMap: Record<string, PlaybackState> = {
        [State.Playing]: 'playing',
        [State.Paused]: 'paused',
        [State.Ready as any]: 'playing',
        ['ready' as any]: 'playing',
        [State.Buffering]: 'loading',
        [((State as any).Loading || 'loading')]: 'loading',
        [((State as any).Connecting || 'connecting')]: 'loading',
        [State.Stopped]: 'idle',
        [State.Error]: 'error',
        [State.None]: 'idle',
      };
      const mapped = stateMap[rawState];
      if (mapped === 'error') {
        // Real error mapping with a single retry: R2/CDN fileUrl -> /stream.
        const cur = usePlayerStore.getState().currentTrack;
        if (cur && nativeRetriedTrackId !== cur.id && cur.fileUrl?.startsWith('http')) {
          nativeRetriedTrackId = cur.id;
          usePlayerStore.getState().updatePlaybackState('loading');
          void (async () => {
            try {
              const fallback = getStreamFallbackUrl(cur);
              const playerTrack = toPlayerTrack(cur, fallback);
              const tp = TrackPlayer as unknown as { setQueue?: (t: unknown[]) => Promise<void> };
              if (typeof tp.setQueue === 'function') {
                await tp.setQueue([playerTrack]);
              } else {
                await TrackPlayer.reset();
                await TrackPlayer.add(playerTrack);
              }
              await TrackPlayer.play();
            } catch {}
          })();
          return;
        }
        usePlayerStore.getState().updatePlaybackState('error');
      } else if (mapped) {
        // Fresh connecting/buffering states flow straight through; stale
        // retries never overwrite a newer explicit play (guarded by callers).
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

    // NOTE (P0-2): Remote* handlers live ONLY in mobile/index.ts
    // registerPlaybackService (single owner, delegates to the store via
    // dynamic import). Registering them here too fires next/prev/play/pause
    // twice per headset/notification tap, so this setup path keeps only
    // PlaybackState / Progress / ActiveTrack listeners.

    const handleTrackChange = async (event: any) => {
      try {
        const { queue } = usePlayerStore.getState();
        const evt = event as { track?: { id?: string; duration?: number }; nextTrack?: { id?: string; duration?: number } } | null;
        let activeTrack = evt?.track || evt?.nextTrack;
        if (!activeTrack) {
          activeTrack = (await TrackPlayer.getActiveTrack()) as unknown as { id?: string; duration?: number } | undefined;
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

    // Web: wire the singleton <audio data-spotibase> directly. No polling
    // interval (the old 1s setInterval leaked for the app lifetime); the
    // singleton is (re)wired on creation in ensureWebAudio.
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      try {
        cleanupTrackPlayerWebSync();
        const existing = document.querySelector('audio[data-spotibase]') as HTMLAudioElement | null;
        if (existing) wireWebAudioSingleton(existing);
      } catch {}
    }

    console.log('TrackPlayer setup complete');
  } catch (err) {
    console.error('TrackPlayer setup error:', err);
  }
}
