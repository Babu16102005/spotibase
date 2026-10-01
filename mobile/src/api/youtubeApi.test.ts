import apiClient from './client';
import { youtubeApi } from './youtubeApi';

/**
 * Contract tests for the YouTube API surface (Expo SDK 57 / jest-expo).
 *
 * Pins the exact canonical request lines the screens depend on
 * (backend YoutubeController, India-first defaults):
 * - GET /youtube/trending?maxResults=&regionCode=IN
 * - GET /youtube/search?q=&maxResults=[&pageToken=]&regionCode=IN&relevanceLanguage=ta&hl=ta
 * - GET /youtube/resolve?id=
 * plus AbortSignal forwarding so debounce/unmount cancellation works,
 * plus the 5s fail-fast budget (YOUTUBE_SEARCH_TIMEOUT_MS) on every call.
 */
jest.mock('./client', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  YOUTUBE_SEARCH_TIMEOUT_MS: 5000,
}));

const getMock = apiClient.get as unknown as jest.Mock;

describe('youtubeApi contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMock.mockResolvedValue({ data: [] });
  });

  describe('trending', () => {
    it('requests the trending feed with the default limit and India region when none is given', async () => {
      await youtubeApi.trending();

      expect(getMock).toHaveBeenCalledTimes(1);
      expect(getMock).toHaveBeenCalledWith('/youtube/trending?maxResults=20&regionCode=IN', {
        timeout: 5000,
      });
    });

    it('forwards a custom limit as maxResults so the backend honors it', async () => {
      await youtubeApi.trending(5);

      expect(getMock).toHaveBeenCalledWith('/youtube/trending?maxResults=5&regionCode=IN', {
        timeout: 5000,
      });
    });

    it('forwards the AbortSignal so focus changes can cancel the request', async () => {
      const controller = new AbortController();

      await youtubeApi.trending(20, controller.signal);

      expect(getMock).toHaveBeenCalledWith('/youtube/trending?maxResults=20&regionCode=IN', {
        signal: controller.signal,
        timeout: 5000,
      });
    });

    it('forwards a custom regionCode override when given', async () => {
      await youtubeApi.trending(20, undefined, 'US');

      expect(getMock).toHaveBeenCalledWith('/youtube/trending?maxResults=20&regionCode=US', {
        timeout: 5000,
      });
    });

    it('always passes the 5s fail-fast timeout so hung backends cannot stall scroll', async () => {
      await youtubeApi.trending();

      const config = getMock.mock.calls[0][1] as { timeout?: number };
      expect(config.timeout).toBe(5000);
    });

    it('resolves with whatever the backend returns (array or envelope)', async () => {
      const envelope = { videos: [{ videoId: 'dQw4w9WgXcQ' }], nextPageToken: null };
      getMock.mockResolvedValueOnce({ data: envelope });

      await expect(youtubeApi.trending()).resolves.toEqual({ data: envelope });
    });
  });

  describe('search', () => {
    it('builds the search URL with an encoded query, default limit, and IN/ta/ta locale', async () => {
      await youtubeApi.search('lofi hip hop');

      expect(getMock).toHaveBeenCalledWith(
        '/youtube/search?q=lofi%20hip%20hop&maxResults=20&regionCode=IN&relevanceLanguage=ta&hl=ta',
        { timeout: 5000 }
      );
    });

    it('encodes reserved characters in the query', async () => {
      await youtubeApi.search('a&b=c?d/e');

      expect(getMock).toHaveBeenCalledWith(
        '/youtube/search?q=a%26b%3Dc%3Fd%2Fe&maxResults=20&regionCode=IN&relevanceLanguage=ta&hl=ta',
        { timeout: 5000 }
      );
    });

    it('appends an encoded pageToken when paginating', async () => {
      await youtubeApi.search('queen', 25, 'CAE QAA');

      expect(getMock).toHaveBeenCalledWith(
        '/youtube/search?q=queen&maxResults=25&pageToken=CAE%20QAA&regionCode=IN&relevanceLanguage=ta&hl=ta',
        { timeout: 5000 }
      );
    });

    it('forwards the AbortSignal for debounced keystrokes', async () => {
      const controller = new AbortController();

      await youtubeApi.search('queen', 25, undefined, controller.signal);

      expect(getMock).toHaveBeenCalledWith(
        '/youtube/search?q=queen&maxResults=25&regionCode=IN&relevanceLanguage=ta&hl=ta',
        {
          signal: controller.signal,
          timeout: 5000,
        }
      );
    });

    it('passes timeout 5000 together with the signal so debounced typing fails fast', async () => {
      const controller = new AbortController();

      await youtubeApi.search('queen', 20, undefined, controller.signal);

      const config = getMock.mock.calls[0][1] as { signal?: AbortSignal; timeout?: number };
      expect(config.signal).toBe(controller.signal);
      expect(config.timeout).toBe(5000);
    });

    it('forwards locale overrides when given', async () => {
      await youtubeApi.search('queen', 25, undefined, undefined, {
        regionCode: 'US',
        relevanceLanguage: 'en',
        hl: 'en',
      });

      expect(getMock).toHaveBeenCalledWith(
        '/youtube/search?q=queen&maxResults=25&regionCode=US&relevanceLanguage=en&hl=en',
        { timeout: 5000 }
      );
    });
  });

  describe('resolve', () => {
    it('requests the resolve endpoint with an encoded video id', async () => {
      await youtubeApi.resolve('dQw4w9WgXcQ');

      expect(getMock).toHaveBeenCalledWith(
        '/youtube/resolve?id=dQw4w9WgXcQ',
        { timeout: 5000 }
      );
    });

    it('forwards the AbortSignal so row unmounts cancel resolution', async () => {
      const controller = new AbortController();

      await youtubeApi.resolve('dQw4w9WgXcQ', controller.signal);

      expect(getMock).toHaveBeenCalledWith('/youtube/resolve?id=dQw4w9WgXcQ', {
        signal: controller.signal,
        timeout: 5000,
      });
    });

    it('propagates backend failures so the player can fall back to direct embed', async () => {
      const failure = { response: { status: 404 } };
      getMock.mockRejectedValueOnce(failure);

      await expect(youtubeApi.resolve('AAAAAAAAAAA')).rejects.toBe(failure);
    });
  });
});
