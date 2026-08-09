import { useAuthStore } from './authStore';
import { authApi } from '../api/client';
import { getStorage } from '../utils';
import { makeAuthResponse, makeUser } from '../test/fixtures';

jest.mock('../api/client', () => ({
  authApi: {
    login: jest.fn(),
    register: jest.fn(),
    socialAuth: jest.fn(),
    refresh: jest.fn(),
  },
}));

const storage = getStorage('spotibase-auth');

const initialAuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
};

describe('authStore', () => {
  beforeEach(() => {
    storage.clearAll();
    jest.clearAllMocks();
    useAuthStore.setState(initialAuthState);
  });

  it('has the expected initial state', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(true);
    expect(state.error).toBeNull();
  });

  describe('login', () => {
    it('stores tokens, sets the user and marks the session authenticated', async () => {
      const response = makeAuthResponse();
      (authApi.login as jest.Mock).mockResolvedValue({ data: response });

      await useAuthStore.getState().login({ email: 'alice@example.com', password: 'secret123' });

      expect(authApi.login).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'secret123' });
      expect(storage.getString('accessToken')).toBe(response.accessToken);
      expect(storage.getString('refreshToken')).toBe(response.refreshToken);
      const state = useAuthStore.getState();
      expect(state.user).toEqual(response.user);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sets a server-provided error message on failure and rethrows', async () => {
      (authApi.login as jest.Mock).mockRejectedValue({
        response: { data: { message: 'Invalid credentials' } },
      });

      await expect(
        useAuthStore.getState().login({ email: 'a@b.com', password: 'wrong' })
      ).rejects.toEqual({ response: { data: { message: 'Invalid credentials' } } });

      const state = useAuthStore.getState();
      expect(state.error).toBe('Invalid credentials');
      expect(state.isLoading).toBe(false);
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
    });

    it('falls back to a generic message when the error has no message', async () => {
      (authApi.login as jest.Mock).mockRejectedValue(new Error('network down'));

      await expect(
        useAuthStore.getState().login({ email: 'a@b.com', password: 'wrong' })
      ).rejects.toThrow('network down');

      expect(useAuthStore.getState().error).toBe('Login failed');
    });
  });

  describe('register', () => {
    it('stores tokens and authenticates the new user', async () => {
      const response = makeAuthResponse({ user: makeUser({ username: 'bob' }) });
      (authApi.register as jest.Mock).mockResolvedValue({ data: response });

      await useAuthStore
        .getState()
        .register({ email: 'bob@example.com', username: 'bob', password: 'password123' });

      expect(authApi.register).toHaveBeenCalledWith({
        email: 'bob@example.com',
        username: 'bob',
        password: 'password123',
      });
      expect(storage.getString('accessToken')).toBe(response.accessToken);
      const state = useAuthStore.getState();
      expect(state.user?.username).toBe('bob');
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('sets an error and rethrows on failure', async () => {
      (authApi.register as jest.Mock).mockRejectedValue({
        response: { data: { message: 'Email already taken' } },
      });

      await expect(
        useAuthStore
          .getState()
          .register({ email: 'bob@example.com', username: 'bob', password: 'password123' })
      ).rejects.toEqual({ response: { data: { message: 'Email already taken' } } });

      expect(useAuthStore.getState().error).toBe('Email already taken');
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('socialAuth', () => {
    it('authenticates via provider token', async () => {
      const response = makeAuthResponse();
      (authApi.socialAuth as jest.Mock).mockResolvedValue({ data: response });

      await useAuthStore.getState().socialAuth('google', 'google-id-token');

      expect(authApi.socialAuth).toHaveBeenCalledWith('google', 'google-id-token');
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user).toEqual(response.user);
    });
  });

  describe('logout', () => {
    it('clears storage and resets the session', async () => {
      const response = makeAuthResponse();
      (authApi.login as jest.Mock).mockResolvedValue({ data: response });
      await useAuthStore.getState().login({ email: 'a@b.com', password: 'x' });

      useAuthStore.getState().logout();

      expect(storage.getString('accessToken')).toBeUndefined();
      expect(storage.getString('refreshToken')).toBeUndefined();
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('loadSession', () => {
    it('refreshes the session when an access token exists', async () => {
      storage.set('accessToken', 'stored-token');
      const response = makeAuthResponse();
      (authApi.refresh as jest.Mock).mockResolvedValue({ data: response });

      await useAuthStore.getState().loadSession();

      expect(authApi.refresh).toHaveBeenCalledWith('stored-token');
      expect(storage.getString('accessToken')).toBe(response.accessToken);
      const state = useAuthStore.getState();
      expect(state.user).toEqual(response.user);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('does nothing but stop loading when no token is stored', async () => {
      await useAuthStore.getState().loadSession();

      expect(authApi.refresh).not.toHaveBeenCalled();
      const state = useAuthStore.getState();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.user).toBeNull();
    });

    it('clears storage and state when the refresh fails', async () => {
      storage.set('accessToken', 'expired-token');
      storage.set('refreshToken', 'stale-refresh');
      (authApi.refresh as jest.Mock).mockRejectedValue(new Error('expired'));

      await useAuthStore.getState().loadSession();

      expect(storage.getString('accessToken')).toBeUndefined();
      expect(storage.getString('refreshToken')).toBeUndefined();
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
    });
  });

  describe('updateUser & clearError', () => {
    it('updateUser replaces the user object', () => {
      const user = makeUser();
      useAuthStore.getState().updateUser(user);
      expect(useAuthStore.getState().user).toEqual(user);
    });

    it('clearError resets the error field', () => {
      useAuthStore.setState({ error: 'something broke' });
      useAuthStore.getState().clearError();
      expect(useAuthStore.getState().error).toBeNull();
    });
  });
});
