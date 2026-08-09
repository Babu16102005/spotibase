/**
 * Manual Jest mock for react-native-track-player v4.
 * Auto-applied for all tests. Every method used by src/store/playerStore.ts
 * is a jest.fn() so tests can reconfigure return values per test.
 */
const Event = {
  PlaybackState: 'playback-state',
  PlaybackError: 'playback-error',
  PlaybackActiveTrackChanged: 'playback-active-track-changed',
  PlaybackQueueEnded: 'playback-queue-ended',
  PlaybackMetadataReceived: 'playback-metadata-received',
  PlaybackProgressUpdated: 'playback-progress-updated',
  RemotePlay: 'remote-play',
  RemotePause: 'remote-pause',
  RemoteStop: 'remote-stop',
  RemoteNext: 'remote-next',
  RemotePrevious: 'remote-previous',
  RemoteSeek: 'remote-seek',
  RemoteSkip: 'remote-skip',
  RemoteSetRating: 'remote-set-rating',
  RemoteDuck: 'remote-duck',
};

const State = {
  None: 0,
  Ready: 1,
  Paused: 2,
  Playing: 3,
  Ended: 4,
  Buffering: 6,
  Loading: 7,
  Stopped: 8,
  Error: 9,
  Connecting: 10,
  Interrupted: 11,
};

const RepeatMode = {
  Off: 0,
  Track: 1,
  Queue: 2,
};

const ShuffleMode = {
  Off: 0,
  Album: 1,
  Playlist: 2,
};

const Capability = {
  Play: 'play',
  PlayFromId: 'play-from-id',
  PlayFromSearch: 'play-from-search',
  Pause: 'pause',
  Stop: 'stop',
  SeekTo: 'seek-to',
  Skip: 'skip',
  SkipToNext: 'skip-to-next',
  SkipToPrevious: 'skip-to-previous',
  JumpForward: 'jump-forward',
  JumpBackward: 'jump-backward',
  SetRating: 'set-rating',
  Like: 'like',
  Dislike: 'dislike',
  Bookmark: 'bookmark',
  SeekBackward: 'seek-backward',
  SeekForward: 'seek-forward',
};

const TrackPlayer = {
  setupPlayer: jest.fn(async () => {}),
  updateOptions: jest.fn(async () => {}),
  add: jest.fn(async () => {}),
  reset: jest.fn(async () => {}),
  play: jest.fn(async () => {}),
  pause: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
  seekTo: jest.fn(async () => {}),
  skip: jest.fn(async () => {}),
  skipToNext: jest.fn(async () => {}),
  skipToPrevious: jest.fn(async () => {}),
  remove: jest.fn(async () => {}),
  clear: jest.fn(async () => {}),
  getQueue: jest.fn(async () => []),
  getState: jest.fn(async () => State.None),
  getPlaybackState: jest.fn(async () => ({ state: State.None })),
  getPosition: jest.fn(async () => 0),
  getDuration: jest.fn(async () => 0),
  getVolume: jest.fn(async () => 1),
  setVolume: jest.fn(async () => {}),
  setRate: jest.fn(async () => {}),
  getRate: jest.fn(async () => 1),
  setRepeatMode: jest.fn(async () => {}),
  setShuffleMode: jest.fn(async () => {}),
  removeUpcomingTracks: jest.fn(async () => {}),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

module.exports = TrackPlayer;
module.exports.default = TrackPlayer;
module.exports.Event = Event;
module.exports.State = State;
module.exports.RepeatMode = RepeatMode;
module.exports.ShuffleMode = ShuffleMode;
module.exports.Capability = Capability;
