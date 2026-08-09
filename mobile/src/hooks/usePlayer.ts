import { usePlayerStore } from '../store';
import { SongResponse } from '../types';

export const usePlayer = () => {
  const { currentTrack, queue, playbackState, position, duration, shuffle, repeat, volume, isMiniPlayerVisible,
    play, playMultiple, pause, resume, next, previous, seekTo, setShuffle, setRepeat, setVolume,
    addToQueue, removeFromQueue, clearQueue, togglePlayPause } = usePlayerStore();

  const isPlaying = playbackState === 'playing';
  const isLoading = playbackState === 'loading';
  const progress = duration > 0 ? position / duration : 0;

  return {
    currentTrack, queue, playbackState, position, duration, shuffle, repeat, volume,
    isMiniPlayerVisible, isPlaying, isLoading, progress,
    play, playMultiple, pause, resume, next, previous, seekTo,
    setShuffle, setRepeat, setVolume, addToQueue, removeFromQueue, clearQueue, togglePlayPause,
  };
};
