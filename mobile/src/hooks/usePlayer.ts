import { usePlayerState, usePlayerActions } from '../store';

export const usePlayer = () => {
  const {
    currentTrack,
    queue,
    playbackState,
    position,
    duration,
    shuffle,
    repeat,
    volume,
    isMiniPlayerVisible,
  } = usePlayerState();

  const {
    play,
    playMultiple,
    pause,
    resume,
    next,
    previous,
    seekTo,
    setShuffle,
    setRepeat,
    setVolume,
    addToQueue,
    removeFromQueue,
    clearQueue,
    togglePlayPause,
  } = usePlayerActions();

  const isPlaying = playbackState === 'playing' || playbackState === 'loading';
  const isLoading = playbackState === 'loading';
  const progress = duration > 0 ? position / duration : 0;

  return {
    currentTrack, queue, playbackState, position, duration, shuffle, repeat, volume,
    isMiniPlayerVisible, isPlaying, isLoading, progress,
    play, playMultiple, pause, resume, next, previous, seekTo,
    setShuffle, setRepeat, setVolume, addToQueue, removeFromQueue, clearQueue, togglePlayPause,
  };
};
