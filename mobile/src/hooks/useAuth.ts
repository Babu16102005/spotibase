import { useAuthStore } from '../store';

export const useAuth = () => {
  const { user, isAuthenticated, isLoading, error, login, register, socialAuth, logout, loadSession, updateUser, clearError } = useAuthStore();
  return { user, isAuthenticated, isLoading, error, login, register, socialAuth, logout, loadSession, updateUser, clearError };
};
