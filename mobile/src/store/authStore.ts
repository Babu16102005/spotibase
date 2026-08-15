import { create } from 'zustand';
import { UserResponse, LoginRequest, RegisterRequest } from '../types';
import { authApi } from '../api/client';
import { getStorage } from '../utils';

const storage = getStorage('spotibase-auth');

interface AuthState {
  user: UserResponse | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  socialAuth: (provider: string, idToken: string) => Promise<void>;
  logout: () => void;
  loadSession: () => Promise<void>;
  updateUser: (user: UserResponse) => void;
  clearError: () => void;
}

const saveAuthSession = (accessToken: string, refreshToken: string, user: UserResponse) => {
  try {
    storage.set('accessToken', accessToken);
    storage.set('refreshToken', refreshToken);
    storage.set('userCache', JSON.stringify(user));
  } catch (e) {
    console.error('Failed to save auth session:', e);
  }
};

const getCachedUser = (): UserResponse | null => {
  try {
    const raw = storage.getString('userCache');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const getInitialAuthStatus = (): boolean => {
  try {
    const token = storage.getString('refreshToken') || storage.getString('accessToken');
    const user = getCachedUser();
    return !!(token && user);
  } catch {
    return false;
  }
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: getCachedUser(),
  isAuthenticated: getInitialAuthStatus(),
  isLoading: true,
  error: null,

  login: async (data) => {
    try {
      set({ isLoading: true, error: null });
      const response = await authApi.login(data);
      const { accessToken, refreshToken, user } = response.data;
      saveAuthSession(accessToken, refreshToken, user);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Login failed', isLoading: false });
      throw err;
    }
  },

  register: async (data) => {
    try {
      set({ isLoading: true, error: null });
      const response = await authApi.register(data);
      const { accessToken, refreshToken, user } = response.data;
      saveAuthSession(accessToken, refreshToken, user);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Registration failed', isLoading: false });
      throw err;
    }
  },

  socialAuth: async (provider, idToken) => {
    try {
      set({ isLoading: true, error: null });
      const response = await authApi.socialAuth(provider, idToken);
      const { accessToken, refreshToken, user } = response.data;
      saveAuthSession(accessToken, refreshToken, user);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err: any) {
      set({ error: err.response?.data?.message || 'Social login failed', isLoading: false });
      throw err;
    }
  },

  logout: () => {
    storage.clearAll();
    set({ user: null, isAuthenticated: false, isLoading: false, error: null });
  },

  loadSession: async () => {
    try {
      const refreshToken = storage.getString('refreshToken') || storage.getString('accessToken');
      const cachedUser = getCachedUser();

      // If we have cached credentials & user, keep user logged in immediately!
      if (cachedUser && refreshToken) {
        set({ user: cachedUser, isAuthenticated: true, isLoading: false });
      }

      if (!refreshToken) {
        set({ isLoading: false, isAuthenticated: false, user: null });
        return;
      }

      // Background token refresh to keep user session fresh
      try {
        const response = await authApi.refresh(refreshToken);
        const { accessToken: newAccess, refreshToken: newRefresh, user: newUser } = response.data;
        saveAuthSession(newAccess, newRefresh, newUser);
        set({ user: newUser, isAuthenticated: true, isLoading: false });
      } catch (refreshErr: any) {
        const isNetworkError = refreshErr.message === 'Network Error' || refreshErr.code === 'ERR_NETWORK';
        if (!isNetworkError) {
          storage.clearAll();
          set({ user: null, isAuthenticated: false, isLoading: false });
        } else {
          // On network error or offline, maintain the cached session!
          set({ isLoading: false });
        }
      }
    } catch {
      set({ isLoading: false });
    }
  },

  updateUser: (user) => {
    try {
      storage.set('userCache', JSON.stringify(user));
    } catch {}
    set({ user });
  },
  clearError: () => set({ error: null }),
}));
