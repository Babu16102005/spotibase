/**
 * Sync mutual-exclusion bus for audio (playerStore) vs video (youtubePlayerStore).
 *
 * Both stores import this module synchronously — no dynamic import(), no async
 * gap where audio + video overlap. The bus holds a shared exclusion flag plus
 * sync listener sets so each side can signal the other in the same tick.
 *
 * - Video wins: youtubePlayerStore.playVideo/resumeVideo call
 *   emitVideoStarted() synchronously; playerStore registers onVideoStarted()
 *   to bump its playRequestId (abort pending audio continuations) in the same
 *   tick. The direct TrackPlayer.pause() from the video side stays sync too.
 * - Audio wins: playerStore play/resume/next/prev call emitAudioStarted()
 *   synchronously; youtubePlayerStore registers onAudioStarted() to pause
 *   video presentation in the same tick.
 *
 * (Expo SDK v57 versioned docs read before writing: no background-audio or
 * WebView autoplay changes needed — this is pure zustand sync signalling.)
 */

type Listener = () => void;

const audioStartedListeners = new Set<Listener>();
const videoStartedListeners = new Set<Listener>();

let youtubeActive = false;

/** Shared exclusion flag: true while a YouTube video is presenting. */
export function isYoutubeActive(): boolean {
  return youtubeActive;
}

export function setYoutubeActive(active: boolean): void {
  youtubeActive = active;
}

export function onAudioStarted(cb: Listener): () => void {
  audioStartedListeners.add(cb);
  return () => {
    audioStartedListeners.delete(cb);
  };
}

export function onVideoStarted(cb: Listener): () => void {
  videoStartedListeners.add(cb);
  return () => {
    videoStartedListeners.delete(cb);
  };
}

/** Synchronously notify video side that audio took over (same tick). */
export function emitAudioStarted(): void {
  for (const cb of Array.from(audioStartedListeners)) {
    try {
      cb();
    } catch {}
  }
}

/** Synchronously notify audio side that video took over (same tick). */
export function emitVideoStarted(): void {
  for (const cb of Array.from(videoStartedListeners)) {
    try {
      cb();
    } catch {}
  }
}
