import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import MiniPlayer from './MiniPlayer';
import { usePlayerStore } from '../store';
import TrackPlayer, { State } from 'react-native-track-player';
import { makeSong } from '../test/fixtures';

jest.mock('../api/client', () => ({
  queueApi: { addToQueue: jest.fn() },
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

  it('shows the pause glyph while playing and the play glyph while paused', () => {
    usePlayerStore.setState({ currentTrack: makeSong(), playbackState: 'playing' });
    const first = render(<MiniPlayer />);
    expect(first.getByText('\u23F8')).toBeTruthy(); // pause
    expect(first.queryByText('\u25B6')).toBeNull(); // play

    first.unmount();
    usePlayerStore.setState({ currentTrack: makeSong(), playbackState: 'paused' });
    const second = render(<MiniPlayer />);
    expect(second.getByText('\u25B6')).toBeTruthy();
    expect(second.queryByText('\u23F8')).toBeNull();
  });

  it('toggles playback when the play button is pressed', async () => {
    usePlayerStore.setState({ currentTrack: makeSong(), playbackState: 'paused' });
    (TrackPlayer.getPlaybackState as jest.Mock).mockResolvedValue({ state: State.Paused });

    const { getByText } = render(<MiniPlayer />);
    fireEvent.press(getByText('\u25B6'));
    await act(async () => {});

    expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().playbackState).toBe('playing');
    expect(getByText('\u23F8')).toBeTruthy();
  });

  it('pauses when the button is pressed while playing', async () => {
    usePlayerStore.setState({ currentTrack: makeSong(), playbackState: 'playing' });
    (TrackPlayer.getPlaybackState as jest.Mock).mockResolvedValue({ state: State.Playing });

    const { getByText } = render(<MiniPlayer />);
    fireEvent.press(getByText('\u23F8'));
    await act(async () => {});

    expect(TrackPlayer.pause).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().playbackState).toBe('paused');
    expect(getByText('\u25B6')).toBeTruthy();
  });
});
