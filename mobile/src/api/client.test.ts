import axios from 'axios';
import apiClient, { storage, authApi, songApi, queueApi } from './client';
import { makeAuthResponse } from '../test/fixtures';

/**
 * The axios module is fully mocked: `axios.create` returns a callable mock
 * "instance" (apiClient) with interceptors. Handlers are captured once at
 * module scope so beforeEach clearAllMocks() cannot invalidate them.
 */
jest.mock('axios', () => {
  const instance: any = jest.fn();
  instance.interceptors = {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  };
  instance.defaults = {};
  instance.get = jest.fn();
  instance.post = jest.fn();
  instance.put = jest.fn();
  instance.patch = jest.fn();
  instance.delete = jest.fn();

  const axiosMock: any = jest.fn();
  axiosMock.create = jest.fn(() => instance);
  axiosMock.post = jest.fn();
  axiosMock.get = jest.fn();
  axiosMock.put = jest.fn();
  axiosMock.patch = jest.fn();
  axiosMock.delete = jest.fn();
  axiosMock.defaults = {};

  return { __esModule: true, default: axiosMock, AxiosError: class AxiosError extends Error {} };
});

const instance = (axios.create as jest.Mock).mock.results[0].value;
const createCallArgs = (axios.create as jest.Mock).mock.calls[0][0];
const requestFulfilled = instance.interceptors.request.use.mock.calls[0][0];
const responseFulfilled = instance.interceptors.response.use.mock.calls[0][0];
const responseRejected = instance.interceptors.response.use.mock.calls[0][1];

const authError = (overrides: any = {}) => ({
  response: { status: 401 },
  config: { headers: {} },
  ...overrides,
});

describe('api/client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storage.clearAll();
  });

  it('creates an axios instance pointed at the v1 API with a 30s timeout', () => {
    expect(createCallArgs).toEqual(
      expect.objectContaining({
        baseURL: expect.stringContaining('/api/v1'),
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  describe('request interceptor', () => {
    it('attaches the Bearer token from storage when present', () => {
      storage.set('accessToken', 'token-abc');
      const config = { headers: {} };

      const result = requestFulfilled(config);

      expect(result.headers.Authorization).toBe('Bearer token-abc');
    });

    it('does not attach a header when no token is stored', () => {
      const config = { headers: {} };
      const result = requestFulfilled(config);
      expect(result.headers.Authorization).toBeUndefined();
    });
  });

  describe('response interceptor', () => {
    it('passes successful responses through untouched', () => {
      const response = { data: { ok: true }, status: 200 };
      expect(responseFulfilled(response)).toBe(response);
    });

    it('rejects non-401 errors as-is', async () => {
      const error = { response: { status: 500 }, config: { headers: {} } };
      await expect(responseRejected(error)).rejects.toBe(error);
    });

    it('refreshes the token once on 401 and retries the original request', async () => {
      storage.set('accessToken', 'expired-token');
      storage.set('refreshToken', 'refresh-token');
      const refreshed = makeAuthResponse({ accessToken: 'fresh-token', refreshToken: 'new-refresh' });
      (axios.post as jest.Mock).mockResolvedValue({ data: refreshed });

      const originalConfig: { url: string; headers: Record<string, string>; _retry?: boolean } = {
        url: '/songs',
        headers: { Authorization: 'Bearer expired-token' },
      };
      await responseRejected(authError({ config: originalConfig }));

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/auth/refresh'),
        { refreshToken: 'refresh-token' }
      );
      expect(storage.getString('accessToken')).toBe('fresh-token');
      expect(storage.getString('refreshToken')).toBe('new-refresh');
      expect(originalConfig.headers.Authorization).toBe('Bearer fresh-token');
      // Original request retried through the same axios instance.
      expect(instance).toHaveBeenCalledWith(originalConfig);
      // The retried request is marked so a second 401 does not loop.
      expect(originalConfig._retry).toBe(true);
    });

    it('does not refresh twice for an already-retried request', async () => {
      storage.set('accessToken', 'expired-token');
      storage.set('refreshToken', 'refresh-token');
      const error = authError({ config: { headers: {}, _retry: true } });

      await expect(responseRejected(error)).rejects.toBe(error);
      expect(axios.post).not.toHaveBeenCalled();
      expect(instance).not.toHaveBeenCalled();
    });

    it('clears storage when the refresh call fails', async () => {
      storage.set('accessToken', 'expired-token');
      storage.set('refreshToken', 'refresh-token');
      (axios.post as jest.Mock).mockRejectedValue(new Error('network down'));

      const error = authError();
      await expect(responseRejected(error)).rejects.toThrow('network down');

      expect(storage.getString('accessToken')).toBeUndefined();
      expect(storage.getString('refreshToken')).toBeUndefined();
      expect(instance).not.toHaveBeenCalled();
    });

    it('clears storage without calling the refresh endpoint when no refresh token exists', async () => {
      storage.set('accessToken', 'expired-token');
      const error = authError();

      await expect(responseRejected(error)).rejects.toThrow('No refresh token');

      expect(axios.post).not.toHaveBeenCalled();
      expect(storage.getString('accessToken')).toBeUndefined();
    });

    it('exposes the storage singleton so callers can read tokens', () => {
      expect(typeof storage.getString).toBe('function');
    });
  });

  describe('exported api surfaces', () => {
    it('authApi.login posts to /auth/login', () => {
      authApi.login({ email: 'a@b.com', password: 'x' });
      expect(instance.post).toHaveBeenCalledWith('/auth/login', { email: 'a@b.com', password: 'x' });
    });

    it('songApi.getById requests the song endpoint', () => {
      songApi.getById('song-9');
      expect(instance.get).toHaveBeenCalledWith('/songs/song-9');
    });

    it('queueApi.addToQueue posts the song and source', () => {
      queueApi.addToQueue('s1', 'ALBUM');
      expect(instance.post).toHaveBeenCalledWith('/queue', { songId: 's1', source: 'ALBUM' });
    });
  });

  it('default export is the axios instance', () => {
    expect(apiClient).toBe(instance);
  });
});
