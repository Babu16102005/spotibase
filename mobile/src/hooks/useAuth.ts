import { useAuthStore } from '../store';

export const useAuth = () => {
  const { user, isAuthenticated, isLoading, error, login, register, logout, loadSession, clearError } = useAuthStore();
  return { user, isAuthenticated, isLoading, error, login, register, logout, loadSession, clearError };
};
