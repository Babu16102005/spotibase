import TrackPlayer from 'react-native-track-player';
import { usePlayerStore } from './playerStore';
import { useYouTubePlayerStore } from './youtubePlayerStore';
import type { YouTubeVideo } from '../types/youtube';

/**
 * Mutual-exclusion tests for the YouTube video player store (Expo SDK 57).
 *
 * Single-player invariant: audio (playerStore / TrackPlayer) and video
 * (youtubePlayerStore) never overlap. Video wins on play/resume; audio
 * winning calls notifyAudioStarted() so the video UI pauses presentation.
 */
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
  getBaseUrl: () => 'http://localhost:8088/api/v1',
  getTrackStreamUrl: (track: any) => `http://localhost:8088/api/v1/songs/${track?.id}/stream`,
}));

const makeVideo = (overrides: Partial<YouTubeVideo> = {}): YouTubeVideo => ({
  videoId: 'dQw4w9WgXcQ',
  title: 'Lo-Fi Beats to Focus',
  channelTitle: 'Chill Lab',
  thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  ...overrides,
});

describe('youtubePlayerStore mutual exclusion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useYouTubePlayerStore.setState({ currentVideo: null, isPlaying: false });
    usePlayerStore.setState({ playbackState: 'idle' });
  });

  it('starts with no video loaded', () => {
    const state = useYouTubePlayerStore.getState();
    expect(state.currentVideo).toBeNull();
    expect(state.isPlaying).toBe(false);
  });

  describe('playVideo', () => {
    it('loads the video and marks it playing', () => {
      const video = makeVideo();

      useYouTubePlayerStore.getState().playVideo(video);

      const state = useYouTubePlayerStore.getState();
      expect(state.currentVideo).toEqual(video);
      expect(state.isPlaying).toBe(true);
    });

    it('pauses running audio first so audio + video never overlap', async () => {
      usePlayerStore.setState({ playbackState: 'playing' });

      useYouTubePlayerStore.getState().playVideo(makeVideo());
      // pause() is fire-and-forget from the video side.
      await Promise.resolve();

      expect(TrackPlayer.pause).toHaveBeenCalled();
      expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    });

    it('also pauses audio that is still loading', async () => {
      usePlayerStore.setState({ playbackState: 'loading' });

      useYouTubePlayerStore.getState().playVideo(makeVideo());
      await Promise.resolve();

      expect(TrackPlayer.pause).toHaveBeenCalled();
    });

    it('leaves idle/paused audio alone', async () => {
      usePlayerStore.setState({ playbackState: 'paused' });

      useYouTubePlayerStore.getState().playVideo(makeVideo());
      await Promise.resolve();

      expect(TrackPlayer.pause).not.toHaveBeenCalled();
      expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    });

    it('still presents the video when audio teardown fails', async () => {
      usePlayerStore.setState({ playbackState: 'playing' });
      (TrackPlayer.pause as jest.Mock).mockRejectedValueOnce(new Error('teardown boom'));
      const video = makeVideo();

      useYouTubePlayerStore.getState().playVideo(video);
      await Promise.resolve();
      await Promise.resolve();

      const state = useYouTubePlayerStore.getState();
      expect(state.currentVideo).toEqual(video);
      expect(state.isPlaying).toBe(true);
    });

    it('switching videos replaces the current one', () => {
      const store = useYouTubePlayerStore.getState();
      store.playVideo(makeVideo({ videoId: 'AAAAAAAAAAA', title: 'First' }));

      useYouTubePlayerStore.getState().playVideo(makeVideo({ videoId: 'BBBBBBBBBBB', title: 'Second' }));

      expect(useYouTubePlayerStore.getState().currentVideo?.videoId).toBe('BBBBBBBBBBB');
      expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    });
  });

  describe('pauseVideo / resumeVideo', () => {
    it('pauseVideo keeps the video loaded but stops presentation', () => {
      const store = useYouTubePlayerStore.getState();
      store.playVideo(makeVideo());

      useYouTubePlayerStore.getState().pauseVideo();

      expect(useYouTubePlayerStore.getState().currentVideo).not.toBeNull();
      expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
    });

    it('resumeVideo re-asserts video-wins over running audio', async () => {
      useYouTubePlayerStore.getState().playVideo(makeVideo());
      useYouTubePlayerStore.getState().pauseVideo();
      usePlayerStore.setState({ playbackState: 'playing' });
      jest.clearAllMocks();

      useYouTubePlayerStore.getState().resumeVideo();
      await Promise.resolve();

      expect(TrackPlayer.pause).toHaveBeenCalled();
      expect(useYouTubePlayerStore.getState().isPlaying).toBe(true);
    });

    it('resumeVideo is a no-op without a loaded video', () => {
      useYouTubePlayerStore.getState().resumeVideo();

      expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
    });
  });

  describe('closePlayer / notifyAudioStarted', () => {
    it('closePlayer unloads the video entirely', () => {
      useYouTubePlayerStore.getState().playVideo(makeVideo());

      useYouTubePlayerStore.getState().closePlayer();

      const state = useYouTubePlayerStore.getState();
      expect(state.currentVideo).toBeNull();
      expect(state.isPlaying).toBe(false);
    });

    it('notifyAudioStarted pauses video presentation when audio takes over', () => {
      useYouTubePlayerStore.getState().playVideo(makeVideo());

      useYouTubePlayerStore.getState().notifyAudioStarted();

      const state = useYouTubePlayerStore.getState();
      expect(state.isPlaying).toBe(false);
      // The video stays loaded so the UI can resume it later.
      expect(state.currentVideo).not.toBeNull();
    });

    it('notifyAudioStarted is a no-op when the video is already paused', () => {
      const video = makeVideo();
      useYouTubePlayerStore.setState({ currentVideo: video, isPlaying: false });

      useYouTubePlayerStore.getState().notifyAudioStarted();

      expect(useYouTubePlayerStore.getState().currentVideo).toEqual(video);
      expect(useYouTubePlayerStore.getState().isPlaying).toBe(false);
    });
  });
});
