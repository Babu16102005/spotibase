import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import PlayerSheet from './PlayerSheet';
import { usePlayerStore } from '../store';
import TrackPlayer, { State } from 'react-native-track-player';
import { makeSong } from '../test/fixtures';

jest.mock('../api/client', () => ({
  queueApi: { addToQueue: jest.fn() },
  songApi: { like: jest.fn(), unlike: jest.fn() },
}));

const initialPlayerState = {
  currentTrack: null,
  queue: [] as any[],
  playbackState: 'idle' as const,
  position: 0,
  duration: 0,
  shuffle: false,
  repeat: 'off' as const,
  volume: 1,
  isMiniPlayerVisible: false,
  isExpanded: false,
};

describe('PlayerSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePlayerStore.setState(initialPlayerState);
    (TrackPlayer.getPlaybackState as jest.Mock).mockResolvedValue({ state: State.None });
  });

  it('renders nothing when there is no current track', () => {
    const { queryByTestId } = render(<PlayerSheet />);
    expect(queryByTestId('player-sheet')).toBeNull();
  });

  it('renders mini player content when collapsed', () => {
    usePlayerStore.setState({
      currentTrack: makeSong({ title: 'Test Song', artistName: 'Test Artist' }),
      playbackState: 'playing',
      isExpanded: false,
    });

    const { toJSON } = render(<PlayerSheet />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders full player content when expanded', () => {
    usePlayerStore.setState({
      currentTrack: makeSong({ title: 'Full Song', artistName: 'Full Artist', lyrics: 'Some lyrics' }),
      playbackState: 'playing',
      isExpanded: true,
    });

    const { getByText, getAllByText, getByLabelText, getAllByLabelText } = render(<PlayerSheet />);

    expect(getByText('NOW PLAYING')).toBeTruthy();
    expect(getAllByText('Full Song').length).toBeGreaterThan(0);
    expect(getAllByText('Full Artist').length).toBeGreaterThan(0);
    expect(getByLabelText('Minimize player')).toBeTruthy();
    expect(getByLabelText('Previous')).toBeTruthy();
    expect(getAllByLabelText('Pause').length).toBeGreaterThan(0);
    expect(getAllByLabelText('Next').length).toBeGreaterThan(0);
    expect(getByLabelText('Shuffle')).toBeTruthy();
    expect(getByLabelText('Repeat')).toBeTruthy();
    expect(getByLabelText('Volume')).toBeTruthy();
    expect(getByText('LYRICS')).toBeTruthy();
    expect(getByText('Some lyrics')).toBeTruthy();
  });

  it('toggles like when heart button is pressed', async () => {
    usePlayerStore.setState({
      currentTrack: makeSong({ liked: false }),
      playbackState: 'playing',
      isExpanded: true,
    });

    const { getAllByLabelText } = render(<PlayerSheet />);

    const likeButtons = getAllByLabelText('Like song');
    fireEvent.press(likeButtons[likeButtons.length - 1]);
    await act(async () => {});
    expect(getAllByLabelText('Unlike song').length).toBeGreaterThan(0);
  });

  it('calls previous/next on control press', async () => {
    const tracks = [makeSong({ id: 'a' }), makeSong({ id: 'b' })];
    usePlayerStore.setState({
      currentTrack: tracks[1],
      queue: tracks,
      playbackState: 'playing',
      isExpanded: true,
      position: 1,
    });

    const { getByLabelText, getAllByLabelText } = render(<PlayerSheet />);

    fireEvent.press(getByLabelText('Previous'));
    await act(async () => {});
    // previous() now uses reset+add+play (not skipToPrevious)
    expect(TrackPlayer.reset).toHaveBeenCalled();
    expect(TrackPlayer.play).toHaveBeenCalled();

    const nextButtons = getAllByLabelText('Next');
    fireEvent.press(nextButtons[nextButtons.length - 1]);
    await act(async () => {});
    // next() now uses reset+add+play (not skipToNext)
    expect(TrackPlayer.reset).toHaveBeenCalled();
    expect(TrackPlayer.play).toHaveBeenCalled();
  });

  it('toggles shuffle and repeat', () => {
    usePlayerStore.setState({
      currentTrack: makeSong(),
      playbackState: 'playing',
      isExpanded: true,
      shuffle: false,
      repeat: 'off',
    });

    const { getByLabelText } = render(<PlayerSheet />);

    fireEvent.press(getByLabelText('Shuffle'));
    expect(usePlayerStore.getState().shuffle).toBe(true);

    fireEvent.press(getByLabelText('Repeat'));
    expect(usePlayerStore.getState().repeat).toBe('all');

    fireEvent.press(getByLabelText('Repeat'));
    expect(usePlayerStore.getState().repeat).toBe('one');

    fireEvent.press(getByLabelText('Repeat'));
    expect(usePlayerStore.getState().repeat).toBe('off');
  });

  it('calls collapsePlayer when minimize button is pressed', () => {
    usePlayerStore.setState({
      currentTrack: makeSong(),
      playbackState: 'playing',
      isExpanded: true,
    });
    const collapseSpy = jest.spyOn(usePlayerStore.getState(), 'collapsePlayer');

    const { getByLabelText } = render(<PlayerSheet />);
    fireEvent.press(getByLabelText('Minimize player'));

    expect(collapseSpy).toHaveBeenCalledTimes(1);
  });

  it('does not stop playback when minimized', async () => {
    usePlayerStore.setState({
      currentTrack: makeSong(),
      playbackState: 'playing',
      isExpanded: true,
    });

    const { getByLabelText } = render(<PlayerSheet />);
    fireEvent.press(getByLabelText('Minimize player'));
    await act(async () => {});

    // TrackPlayer.pause should NOT be called when minimizing
    expect(TrackPlayer.pause).not.toHaveBeenCalled();
    // playbackState should still be 'playing' (only UI state changed)
    expect(usePlayerStore.getState().playbackState).toBe('playing');
  });
});