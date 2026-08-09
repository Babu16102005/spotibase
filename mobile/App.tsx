import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RootNavigator from './src/navigation/RootNavigator';
import { useAuthStore, useThemeStore, setupTrackPlayer, useNotificationStore } from './src/store';
import { setupRealtime } from './src/realtime/client';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    },
  },
});

function registerServiceWorker() {
  if (Platform.OS !== 'web' || !('serviceWorker' in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered:', registration.scope);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              if (confirm('A new version of SpotiBase is available. Reload to update?')) {
                window.location.reload();
              }
            }
          });
        });
      })
      .catch((error) => {
        console.log('SW registration failed:', error);
      });
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register);
  }
}

function AppContent() {
  const loadSession = useAuthStore((s) => s.loadSession);
  const loadTheme = useThemeStore((s) => s.loadTheme);
  const theme = useThemeStore((s) => s.theme);
  const handleRealtimeNotification = useNotificationStore((s) => s.pushRealtimeNotification);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const fetchUnreadCount = useNotificationStore((s) => s.fetchUnreadCount);

  useEffect(() => {
    loadTheme();
    loadSession();
    setupTrackPlayer();
    registerServiceWorker();

    // Real-time: notifications, queue sync, presence
    setupRealtime({
      onNotification: (payload) => handleRealtimeNotification(payload),
      onUnreadCount: (payload) => setUnreadCount(payload.count ?? 0),
      onConnected: () => fetchUnreadCount(),
    });
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaProvider>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <RootNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
