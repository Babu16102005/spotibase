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

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (data) => {
    try {
      set({ isLoading: true, error: null });
      const response = await authApi.login(data);
      const { accessToken, refreshToken, user } = response.data;
      storage.set('accessToken', accessToken);
      storage.set('refreshToken', refreshToken);
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
      storage.set('accessToken', accessToken);
      storage.set('refreshToken', refreshToken);
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
      storage.set('accessToken', accessToken);
      storage.set('refreshToken', refreshToken);
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
      const token = storage.getString('accessToken');
      if (!token) {
        set({ isLoading: false });
        return;
      }
      const response = await authApi.refresh(token);
      const { accessToken, refreshToken, user } = response.data;
      storage.set('accessToken', accessToken);
      storage.set('refreshToken', refreshToken);
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      storage.clearAll();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  updateUser: (user) => set({ user }),
  clearError: () => set({ error: null }),
}));
