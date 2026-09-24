import apiClient from './client';
import { youtubeApi } from './youtubeApi';

/**
 * Contract tests for the YouTube API surface (Expo SDK 57 / jest-expo).
 *
 * Pins the exact canonical request lines the screens depend on
 * (backend YoutubeController):
 * - GET /youtube/trending?maxResults=
 * - GET /youtube/search?q=&maxResults=[&pageToken=]
 * - GET /youtube/resolve?id=
 * plus AbortSignal forwarding so debounce/unmount cancellation works.
 */
jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const getMock = apiClient.get as unknown as jest.Mock;

describe('youtubeApi contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMock.mockResolvedValue({ data: [] });
  });

  describe('trending', () => {
    it('requests the trending feed with the default limit when none is given', async () => {
      await youtubeApi.trending();

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock).toHaveBeenCalledWith('/youtube/trending?maxResults=20', undefined);
    });

    it('forwards a custom limit as maxResults so the backend honors it', async () => {
      await youtubeApi.trending(5);

      expect(getMock).toHaveBeenCalledWith('/youtube/trending?maxResults=5', undefined);
    });

    it('forwards the AbortSignal so focus changes can cancel the request', async () => {
      const controller = new AbortController();

      await youtubeApi.trending(20, controller.signal);

      expect(getMock).toHaveBeenCalledWith('/youtube/trending?maxResults=20', {
        signal: controller.signal,
      });
    });

    it('resolves with whatever the backend returns (array or envelope)', async () => {
      const envelope = { videos: [{ videoId: 'dQw4w9WgXcQ' }], nextPageToken: null };
      getMock.mockResolvedValueOnce({ data: envelope });

      await expect(youtubeApi.trending()).resolves.toEqual({ data: envelope });
    });
  });

  describe('search', () => {
    it('builds the search URL with an encoded query and default limit', async () => {
      await youtubeApi.search('lofi hip hop');

      expect(getMock).toHaveBeenCalledWith(
        '/youtube/search?q=lofi%20hip%20hop&maxResults=20',
        undefined
      );
    });

    it('encodes reserved characters in the query', async () => {
      await youtubeApi.search('a&b=c?d/e');

      expect(getMock).toHaveBeenCalledWith(
        '/youtube/search?q=a%26b%3Dc%3Fd%2Fe&maxResults=20',
        undefined
      );
    });

    it('appends an encoded pageToken when paginating', async () => {
      await youtubeApi.search('queen', 25, 'CAE QAA');

      expect(getMock).toHaveBeenCalledWith(
        '/youtube/search?q=queen&maxResults=25&pageToken=CAE%20QAA',
        undefined
      );
    });

    it('forwards the AbortSignal for debounced keystrokes', async () => {
      const controller = new AbortController();

      await youtubeApi.search('queen', 25, undefined, controller.signal);

      expect(getMock).toHaveBeenCalledWith('/youtube/search?q=queen&maxResults=25', {
        signal: controller.signal,
      });
    });
  });

  describe('resolve', () => {
    it('requests the resolve endpoint with an encoded video id', async () => {
      await youtubeApi.resolve('dQw4w9WgXcQ');

      expect(getMock).toHaveBeenCalledWith(
        '/youtube/resolve?id=dQw4w9WgXcQ',
        undefined
      );
    });

    it('forwards the AbortSignal so row unmounts cancel resolution', async () => {
      const controller = new AbortController();

      await youtubeApi.resolve('dQw4w9WgXcQ', controller.signal);

      expect(getMock).toHaveBeenCalledWith('/youtube/resolve?id=dQw4w9WgXcQ', {
        signal: controller.signal,
      });
    });

    it('propagates backend failures so the player can fall back to direct embed', async () => {
      const failure = { response: { status: 404 } };
      getMock.mockRejectedValueOnce(failure);

      await expect(youtubeApi.resolve('AAAAAAAAAAA')).rejects.toBe(failure);
    });
  });
});
