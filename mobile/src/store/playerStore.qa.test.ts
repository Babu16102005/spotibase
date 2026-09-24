/**
 * playerStore.setup QA — TestAgent additive suite.
 *
 * Pins the INTENDED architecture after P0-2:
 * - setupTrackPlayer() wires ONLY PlaybackState / Progress / ActiveTrack
 *   (Remote* live ONLY in mobile/index.ts registerPlaybackService).
 * - buffering + 0.25s progress interval preserved.
 *
 * This documents why the legacy `playerStore.test.ts` Remote* expectations
 * (2 failures) are stale and must be updated, not treated as prod bugs.
 *
 * Expo SDK v57 docs reviewed per mobile/AGENTS.md; no native API change here
 * (pure jest + react-native-track-player mock assertions).
 */
import { usePlayerStore, setupTrackPlayer } from './playerStore';
import TrackPlayer, { Event } from 'react-native-track-player';

declare const __dirname: string;
declare const require: any;

describe('playerStore.setup QA (P0-2 single-owner Remote*)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usePlayerStore.setState({
      currentTrack: null,
      queue: [],
      playbackState: 'idle',
      position: 0,
      duration: 0,
      shuffle: false,
      repeat: 'off',
      volume: 1,
      isMiniPlayerVisible: false,
      isExpanded: false,
    } as any);
  });

  it('wires playback-state + progress + active-track, NOT Remote*', async () => {
    await setupTrackPlayer();
    const calls = (TrackPlayer.addEventListener as jest.Mock).mock.calls;
    const events = calls.map((c) => c[0]);
    expect(events).toContain(Event.PlaybackState);
    expect(events).toContain(Event.PlaybackProgressUpdated);
    // single-owner rule: Remote* must NOT be registered here
    expect(events).not.toContain(Event.RemotePlay);
    expect(events).not.toContain(Event.RemotePause);
    expect(events).not.toContain(Event.RemoteNext);
    expect(events).not.toContain(Event.RemotePrevious);
  });

  it('keeps smooth buffering + 0.25s progress interval', async () => {
    await setupTrackPlayer();
    expect(TrackPlayer.setupPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ minBuffer: 15, playBuffer: 2.5, backBuffer: 30 }),
    );
    expect(TrackPlayer.updateOptions).toHaveBeenCalledWith(
      expect.objectContaining({ progressUpdateEventInterval: 0.25 }),
    );
  });

  it('mobile/index.ts owns Remote* (single-owner proof)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'index.ts'), 'utf8');
    for (const h of ['RemotePlay', 'RemotePause', 'RemoteNext', 'RemotePrevious', 'RemoteSeek']) {
      expect(src).toContain(h);
    }
  });
});
