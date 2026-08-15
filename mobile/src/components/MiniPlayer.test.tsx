import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import MiniPlayer from './MiniPlayer';
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

describe('MiniPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePlayerStore.setState(initialPlayerState);
    (TrackPlayer.getPlaybackState as jest.Mock).mockResolvedValue({ state: State.None });
  });

  it('renders nothing when there is no current track', () => {
    const { toJSON } = render(<MiniPlayer />);
    expect(toJSON()).toBeNull();
  });

  it('renders the current track title and artist', () => {
    usePlayerStore.setState({
      currentTrack: makeSong({ title: 'Blinding Lights', artistName: 'The Weeknd' }),
      playbackState: 'playing',
    });

    const { getByText } = render(<MiniPlayer />);

    expect(getByText('Blinding Lights')).toBeTruthy();
    expect(getByText('The Weeknd')).toBeTruthy();
  });

  it('shows the pause button while playing and the play button while paused', () => {
    usePlayerStore.setState({ currentTrack: makeSong(), playbackState: 'playing' });
    const first = render(<MiniPlayer />);
    expect(first.getByLabelText('Pause')).toBeTruthy();
    expect(first.queryByLabelText('Play')).toBeNull();

    first.unmount();
    usePlayerStore.setState({ currentTrack: makeSong(), playbackState: 'paused' });
    const second = render(<MiniPlayer />);
    expect(second.getByLabelText('Play')).toBeTruthy();
    expect(second.queryByLabelText('Pause')).toBeNull();
  });

  it('toggles playback when the play button is pressed', async () => {
    usePlayerStore.setState({ currentTrack: makeSong(), playbackState: 'paused' });
    (TrackPlayer.getPlaybackState as jest.Mock).mockResolvedValue({ state: State.Paused });

    const { getByLabelText } = render(<MiniPlayer />);
    fireEvent.press(getByLabelText('Play'));
    await act(async () => {});

    expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().playbackState).toBe('playing');
    expect(getByLabelText('Pause')).toBeTruthy();
  });

  it('pauses when the button is pressed while playing', async () => {
    usePlayerStore.setState({ currentTrack: makeSong(), playbackState: 'playing' });
    (TrackPlayer.getPlaybackState as jest.Mock).mockResolvedValue({ state: State.Playing });

    const { getByLabelText } = render(<MiniPlayer />);
    fireEvent.press(getByLabelText('Pause'));
    await act(async () => {});

    expect(TrackPlayer.pause).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().playbackState).toBe('paused');
    expect(getByLabelText('Play')).toBeTruthy();
  });

  it('shows like button and toggles like state', async () => {
    const song = makeSong({ liked: false });
    usePlayerStore.setState({ currentTrack: song, playbackState: 'playing' });

    const { getByLabelText, queryByLabelText } = render(<MiniPlayer />);

    expect(getByLabelText('Like song')).toBeTruthy();
    expect(queryByLabelText('Unlike song')).toBeNull();

    fireEvent.press(getByLabelText('Like song'));
    await act(async () => {});

    expect(getByLabelText('Unlike song')).toBeTruthy();
  });

  it('shows next button and calls next on press', async () => {
    const tracks = [makeSong({ id: 'a' }), makeSong({ id: 'b' })];
    usePlayerStore.setState({ currentTrack: tracks[0], queue: tracks, playbackState: 'playing' });

    const { getByLabelText } = render(<MiniPlayer />);
    fireEvent.press(getByLabelText('Next'));
    await act(async () => {});

    // next() now navigates via reset+add+play (not skipToNext)
    expect(TrackPlayer.reset).toHaveBeenCalled();
    expect(TrackPlayer.play).toHaveBeenCalled();
  });

  it('calls expandPlayer when expand button is pressed', () => {
    usePlayerStore.setState({ currentTrack: makeSong(), playbackState: 'playing' });
    const expandSpy = jest.spyOn(usePlayerStore.getState(), 'expandPlayer');

    const { getByLabelText } = render(<MiniPlayer />);
    fireEvent.press(getByLabelText('Expand player'));

    expect(expandSpy).toHaveBeenCalledTimes(1);
  });
});
