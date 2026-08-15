import { usePlayerStore, setupTrackPlayer } from './playerStore';
import TrackPlayer, { State, Event, RepeatMode as TpRepeatMode } from 'react-native-track-player';
import { queueApi, BASE_URL } from '../api/client';
import { makeSong } from '../test/fixtures';

jest.mock('../api/client', () => ({
  queueApi: {
    addToQueue: jest.fn(),
    playNext: jest.fn(),
    getQueue: jest.fn(),
  },
  songApi: {
    getAll: jest.fn().mockResolvedValue({ data: { content: [] } }),
    getRecent: jest.fn().mockResolvedValue({ data: [] }),
    like: jest.fn(),
    unlike: jest.fn(),
  },
  BASE_URL: 'http://localhost:8088/api/v1',
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

describe('playerStore', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    usePlayerStore.setState(initialPlayerState);
    (queueApi.addToQueue as jest.Mock).mockResolvedValue({ data: {} });
    // Default playback state returned by the native module mock.
    (TrackPlayer.getPlaybackState as jest.Mock).mockResolvedValue({ state: State.None });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('has the expected initial state', () => {
    const state = usePlayerStore.getState();
    expect(state.currentTrack).toBeNull();
    expect(state.queue).toEqual([]);
    expect(state.playbackState).toBe('idle');
    expect(state.position).toBe(0);
    expect(state.duration).toBe(0);
    expect(state.shuffle).toBe(false);
    expect(state.repeat).toBe('off');
    expect(state.volume).toBe(1);
    expect(state.isMiniPlayerVisible).toBe(false);
    expect(state.isExpanded).toBe(false);
  });

  describe('play', () => {
    it('resets, adds the track, plays it and notifies the backend', async () => {
      const song = makeSong({ id: 's1', durationMs: 214_000 });
      await usePlayerStore.getState().play(song);

      expect(TrackPlayer.reset).toHaveBeenCalledTimes(1);
      expect(TrackPlayer.add).toHaveBeenCalledWith({
        id: 's1',
        url: `${BASE_URL}/songs/s1/stream`,
        title: 'Test Song',
        artist: 'Test Artist',
        artwork: song.coverUrl,
        duration: 214,
      });
      expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
      expect(queueApi.addToQueue).toHaveBeenCalledWith('s1', 'ALBUM');

      const state = usePlayerStore.getState();
      expect(state.currentTrack).toEqual(song);
      expect(state.playbackState).toBe('playing');
      expect(state.isMiniPlayerVisible).toBe(true);
      expect(state.isExpanded).toBe(false);
    });

    it('uses SONG as the source when the track has no album', async () => {
      const song = makeSong({ albumId: undefined, albumName: undefined });
      await usePlayerStore.getState().play(song);
      expect(queueApi.addToQueue).toHaveBeenCalledWith(song.id, 'SONG');
    });

    it('swallows native errors and keeps state unchanged', async () => {
      const song = makeSong();
      (TrackPlayer.reset as jest.Mock).mockRejectedValueOnce(new Error('native failure'));

      await expect(usePlayerStore.getState().play(song)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
      expect(usePlayerStore.getState().playbackState).toBe('idle');
      expect(usePlayerStore.getState().currentTrack).toBeNull();
    });
  });

  describe('playMultiple', () => {
    it('queues all tracks, starts at the requested index and plays', async () => {
      const tracks = [makeSong({ id: 'a' }), makeSong({ id: 'b' }), makeSong({ id: 'c' })];
      await usePlayerStore.getState().playMultiple(tracks, 1);

      expect(TrackPlayer.reset).toHaveBeenCalledTimes(1);
      expect(TrackPlayer.add).toHaveBeenCalledWith(
        tracks.map((t) => ({
          id: t.id,
          url: `${BASE_URL}/songs/${t.id}/stream`,
          title: t.title,
          artist: t.artistName,
          artwork: t.coverUrl,
          duration: t.durationMs / 1000,
        }))
      );
      expect(TrackPlayer.skip).toHaveBeenCalledWith(1);
      expect(TrackPlayer.play).toHaveBeenCalledTimes(1);

      const state = usePlayerStore.getState();
      expect(state.currentTrack).toEqual(tracks[1]);
      expect(state.queue).toEqual(tracks);
      expect(state.playbackState).toBe('playing');
      expect(state.isMiniPlayerVisible).toBe(true);
    });

    it('defaults to the first track when no index is given', async () => {
      const tracks = [makeSong({ id: 'a' }), makeSong({ id: 'b' })];
      await usePlayerStore.getState().playMultiple(tracks);
      expect(usePlayerStore.getState().currentTrack?.id).toBe('a');
    });
  });

  describe('pause / resume', () => {
    it('pause calls the native module and sets playbackState', async () => {
      usePlayerStore.setState({ playbackState: 'playing' });
      await usePlayerStore.getState().pause();
      expect(TrackPlayer.pause).toHaveBeenCalledTimes(1);
      expect(usePlayerStore.getState().playbackState).toBe('paused');
    });

    it('resume calls the native module and sets playbackState', async () => {
      await usePlayerStore.getState().resume();
      expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
      expect(usePlayerStore.getState().playbackState).toBe('playing');
    });
  });

  describe('next / previous', () => {
    it('next loads the next track and sets playbackState to playing', async () => {
      const tracks = [makeSong({ id: 'a' }), makeSong({ id: 'b' })];
      usePlayerStore.setState({ queue: tracks, currentTrack: tracks[0] });
      await usePlayerStore.getState().next();
      expect(TrackPlayer.reset).toHaveBeenCalled();
      expect(TrackPlayer.add).toHaveBeenCalled();
      expect(TrackPlayer.play).toHaveBeenCalled();
      expect(usePlayerStore.getState().currentTrack?.id).toBe('b');
      expect(usePlayerStore.getState().playbackState).toBe('playing');
    });

    it('next maps a non-playing native state to paused', async () => {
      const tracks = [makeSong({ id: 'a' }), makeSong({ id: 'b' })];
      usePlayerStore.setState({ queue: tracks, currentTrack: tracks[0], repeat: 'off' });
      (TrackPlayer.getPlaybackState as jest.Mock).mockResolvedValue({ state: State.Paused });
      await usePlayerStore.getState().next();
      expect(usePlayerStore.getState().currentTrack?.id).toBe('b');
    });

    it('previous loads the previous track and sets playbackState to playing', async () => {
      const tracks = [makeSong({ id: 'a' }), makeSong({ id: 'b' })];
      usePlayerStore.setState({ queue: tracks, currentTrack: tracks[1], position: 1 });
      await usePlayerStore.getState().previous();
      expect(TrackPlayer.reset).toHaveBeenCalled();
      expect(TrackPlayer.add).toHaveBeenCalled();
      expect(TrackPlayer.play).toHaveBeenCalled();
      expect(usePlayerStore.getState().currentTrack?.id).toBe('a');
      expect(usePlayerStore.getState().playbackState).toBe('playing');
    });
  });

  describe('seekTo', () => {
    it('seeks the native module and stores the position', async () => {
      await usePlayerStore.getState().seekTo(45);
      expect(TrackPlayer.seekTo).toHaveBeenCalledWith(45);
      expect(usePlayerStore.getState().position).toBe(45);
    });
  });

  describe('setShuffle / setRepeat / setVolume', () => {
    it('setShuffle toggles the flag', () => {
      usePlayerStore.getState().setShuffle(true);
      expect(usePlayerStore.getState().shuffle).toBe(true);
      usePlayerStore.getState().setShuffle(false);
      expect(usePlayerStore.getState().shuffle).toBe(false);
    });

    it('setRepeat("off") maps to the native Off mode', () => {
      usePlayerStore.getState().setRepeat('off');
      expect(TrackPlayer.setRepeatMode).toHaveBeenCalledWith(TpRepeatMode.Off);
      expect(usePlayerStore.getState().repeat).toBe('off');
    });

    it('setRepeat("all") maps to the native Queue mode', () => {
      usePlayerStore.getState().setRepeat('all');
      expect(TrackPlayer.setRepeatMode).toHaveBeenCalledWith(TpRepeatMode.Queue);
    });

    it('setRepeat("one") maps to the native Track mode', () => {
      usePlayerStore.getState().setRepeat('one');
      expect(TrackPlayer.setRepeatMode).toHaveBeenCalledWith(TpRepeatMode.Track);
    });

    it('setVolume sets the native volume and stores it', async () => {
      await usePlayerStore.getState().setVolume(0.5);
      expect(TrackPlayer.setVolume).toHaveBeenCalledWith(0.5);
      expect(usePlayerStore.getState().volume).toBe(0.5);
    });
  });

  describe('queue management', () => {
    it('addToQueue appends the track to the native queue and store', async () => {
      const song = makeSong({ id: 'q1' });
      await usePlayerStore.getState().addToQueue(song);
      expect(TrackPlayer.add).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'q1', duration: 214 })
      );
      expect(usePlayerStore.getState().queue).toEqual([song]);
    });

    it('removeFromQueue removes the native track and filters the store', async () => {
      const tracks = [makeSong({ id: 'a' }), makeSong({ id: 'b' }), makeSong({ id: 'c' })];
      usePlayerStore.setState({ queue: tracks });
      await usePlayerStore.getState().removeFromQueue(1);
      expect(TrackPlayer.remove).toHaveBeenCalledWith(1);
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['a', 'c']);
    });

    it('removeFromQueue still filters the store when the native remove fails', async () => {
      const tracks = [makeSong({ id: 'a' }), makeSong({ id: 'b' })];
      usePlayerStore.setState({ queue: tracks });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      (TrackPlayer.remove as jest.Mock).mockRejectedValueOnce(new Error('no such index'));
      await usePlayerStore.getState().removeFromQueue(0);
      expect(warnSpy).toHaveBeenCalled();
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(['b']);
      warnSpy.mockRestore();
    });

    it('clearQueue resets the player state', async () => {
      usePlayerStore.setState({
        currentTrack: makeSong(),
        queue: [makeSong()],
        playbackState: 'playing',
        isMiniPlayerVisible: true,
        isExpanded: true,
      });
      await usePlayerStore.getState().clearQueue();
      expect(TrackPlayer.reset).toHaveBeenCalledTimes(1);
      const state = usePlayerStore.getState();
      expect(state.currentTrack).toBeNull();
      expect(state.queue).toEqual([]);
      expect(state.playbackState).toBe('idle');
      expect(state.isMiniPlayerVisible).toBe(false);
      expect(state.isExpanded).toBe(false);
    });
  });

  describe('state helpers', () => {
    it('setMiniPlayerVisible toggles the flag', () => {
      usePlayerStore.getState().setMiniPlayerVisible(true);
      expect(usePlayerStore.getState().isMiniPlayerVisible).toBe(true);
    });

    it('updatePlaybackState stores the state', () => {
      usePlayerStore.getState().updatePlaybackState('loading');
      expect(usePlayerStore.getState().playbackState).toBe('loading');
    });

    it('updatePosition stores position and duration', () => {
      usePlayerStore.getState().updatePosition(30, 120);
      expect(usePlayerStore.getState().position).toBe(30);
      expect(usePlayerStore.getState().duration).toBe(120);
    });
  });

  describe('expandPlayer / collapsePlayer', () => {
    it('expandPlayer sets isExpanded to true', () => {
      usePlayerStore.getState().expandPlayer();
      expect(usePlayerStore.getState().isExpanded).toBe(true);
    });

    it('collapsePlayer sets isExpanded to false', () => {
      usePlayerStore.setState({ isExpanded: true });
      usePlayerStore.getState().collapsePlayer();
      expect(usePlayerStore.getState().isExpanded).toBe(false);
    });

    it('expandPlayer does not affect playback state', () => {
      usePlayerStore.setState({ playbackState: 'playing' });
      usePlayerStore.getState().expandPlayer();
      expect(usePlayerStore.getState().playbackState).toBe('playing');
    });

    it('collapsePlayer does not affect playback state', () => {
      usePlayerStore.setState({ playbackState: 'playing', isExpanded: true });
      usePlayerStore.getState().collapsePlayer();
      expect(usePlayerStore.getState().playbackState).toBe('playing');
    });
  });

  describe('togglePlayPause', () => {
    it('pauses when the native player is playing', async () => {
      usePlayerStore.setState({ playbackState: 'playing' });
      (TrackPlayer.getPlaybackState as jest.Mock).mockResolvedValue({ state: State.Playing });
      await usePlayerStore.getState().togglePlayPause();
      expect(TrackPlayer.pause).toHaveBeenCalledTimes(1);
      expect(TrackPlayer.play).not.toHaveBeenCalled();
      expect(usePlayerStore.getState().playbackState).toBe('paused');
    });

    it('plays when the native player is not playing', async () => {
      usePlayerStore.setState({ playbackState: 'paused' });
      (TrackPlayer.getPlaybackState as jest.Mock).mockResolvedValue({ state: State.Paused });
      await usePlayerStore.getState().togglePlayPause();
      expect(TrackPlayer.play).toHaveBeenCalledTimes(1);
      expect(usePlayerStore.getState().playbackState).toBe('playing');
    });
  });

  describe('setupTrackPlayer', () => {
    it('configures the player and wires all event listeners', async () => {
      await setupTrackPlayer();

      expect(TrackPlayer.setupPlayer).toHaveBeenCalledWith();
      const addEventListenerMock = TrackPlayer.addEventListener as jest.Mock;
      const events = addEventListenerMock.mock.calls.map((call) => call[0]);
      expect(events).toEqual(
        expect.arrayContaining([
          Event.PlaybackState,
          Event.PlaybackProgressUpdated,
          Event.RemotePlay,
          Event.RemotePause,
          Event.RemoteNext,
          Event.RemotePrevious,
          Event.RemoteSeek,
        ])
      );
    });

    it('maps native playback states onto the store', async () => {
      await setupTrackPlayer();
      const handler = (TrackPlayer.addEventListener as jest.Mock).mock.calls.find(
        (call) => call[0] === Event.PlaybackState
      )![1];

      handler({ state: State.Playing });
      expect(usePlayerStore.getState().playbackState).toBe('playing');
      handler({ state: State.Paused });
      expect(usePlayerStore.getState().playbackState).toBe('paused');
      handler({ state: State.Buffering });
      expect(usePlayerStore.getState().playbackState).toBe('loading');
      handler({ state: State.Stopped });
      expect(usePlayerStore.getState().playbackState).toBe('idle');
      handler({ state: State.Error });
      expect(usePlayerStore.getState().playbackState).toBe('error');
      handler({ state: State.None });
      expect(usePlayerStore.getState().playbackState).toBe('idle');
      handler({ state: 9999 as any });
      expect(usePlayerStore.getState().playbackState).toBe('idle');
    });

    it('forwards progress updates into the store', async () => {
      await setupTrackPlayer();
      const handler = (TrackPlayer.addEventListener as jest.Mock).mock.calls.find(
        (call) => call[0] === Event.PlaybackProgressUpdated
      )![1];

      handler({ position: 42, duration: 210 });
      expect(usePlayerStore.getState().position).toBe(42);
      expect(usePlayerStore.getState().duration).toBe(210);
    });

    it('wires remote controls to player actions', async () => {
      await setupTrackPlayer();
      const calls = (TrackPlayer.addEventListener as jest.Mock).mock.calls;
      const handler = (event: string) => calls.find((c) => c[0] === event)![1];

      handler(Event.RemotePlay)();
      expect(TrackPlayer.play).toHaveBeenCalled();
      handler(Event.RemotePause)();
      expect(TrackPlayer.pause).toHaveBeenCalled();
      // RemoteNext/RemotePrevious now delegate to next()/previous() which
      // use reset+add+play internally (not skipToNext/skipToPrevious)
      handler(Event.RemoteNext)();
      handler(Event.RemotePrevious)();
      handler(Event.RemoteSeek)({ position: 10 });
      expect(TrackPlayer.seekTo).toHaveBeenCalledWith(10);
    });

    it('does not throw when the native setup fails', async () => {
      (TrackPlayer.setupPlayer as jest.Mock).mockRejectedValueOnce(new Error('setup boom'));
      await expect(setupTrackPlayer()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
