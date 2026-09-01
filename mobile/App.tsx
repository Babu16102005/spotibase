import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  Montserrat_800ExtraBold,
} from '@expo-google-fonts/montserrat';
import RootNavigator from './src/navigation/RootNavigator';
import PlayerSheet from './src/components/PlayerSheet';
import AppSplashScreen from './src/components/AppSplashScreen';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore, useThemeStore, setupTrackPlayer, useNotificationStore, usePlayerStore } from './src/store';
import { setupRealtime } from './src/realtime/client';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
    },
  },
});

function injectGlobalWebStyles() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  const styleId = 'spotibase-global-input-styles';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Remove browser / Chrome / Safari / Android auto-suggest yellow & blue background */
      input:-webkit-autofill,
      input:-webkit-autofill:hover,
      input:-webkit-autofill:focus,
      input:-webkit-autofill:active,
      textarea:-webkit-autofill,
      textarea:-webkit-autofill:hover,
      textarea:-webkit-autofill:focus,
      textarea:-webkit-autofill:active {
        -webkit-background-clip: text !important;
        background-clip: text !important;
        -webkit-text-fill-color: inherit !important;
        transition: background-color 500000s ease-in-out 0s, color 500000s ease-in-out 0s !important;
        caret-color: inherit !important;
      }
    `;
    document.head.appendChild(style);
  }
}

injectGlobalWebStyles();

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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const [splashFinished, setSplashFinished] = useState(false);

  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
  });

  useEffect(() => {
    loadTheme();
    loadSession();
    setupTrackPlayer();
    registerServiceWorker();
    // Request permissions on install/first launch: Notifications + MIC for AI voice
    (async () => {
      try {
        if (Platform.OS === 'android' || Platform.OS === 'ios') {
          // 1) Notifications (POST_NOTIFICATIONS)
          try {
            const Notifications = await import('expo-notifications');
            if (Platform.OS === 'android') {
              await Notifications.setNotificationChannelAsync('spotibase-default', {
                name: 'SpotiBase',
                importance: Notifications.AndroidImportance.MAX,
                vibrationPattern: [0, 250, 250, 250],
                lightColor: '#1DB954',
              });
            }
            const { status: existing } = await Notifications.getPermissionsAsync();
            let finalStatus = existing;
            if (existing !== 'granted') {
              const { status } = await Notifications.requestPermissionsAsync({
                ios: { allowAlert: true, allowBadge: true, allowSound: true },
                android: {},
              } as any);
              finalStatus = status;
            }
            if (finalStatus === 'granted') {
              try {
                const token = (await Notifications.getExpoPushTokenAsync()).data;
                console.log('[Notifications] granted, token:', token?.slice(0, 20) + '...');
              } catch {}
            }
            Notifications.setNotificationHandler({
              handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true } as any),
            });
          } catch (e) { console.log('[Notifications] skip', e); }

          // 2) MIC for AI voice - NOT requested at launch (must be user gesture for web getUserMedia)
          // Will be requested on orb tap via AiOrb's AudioModule.requestRecordingPermissionsAsync
          console.log('[Mic] will be requested on orb tap (user gesture)');
        }
      } catch (e) {
        console.log('[Permissions] setup skip', e);
      }
    })();

    // Real-time: notifications, queue sync, presence
    setupRealtime({
      onNotification: (payload) => handleRealtimeNotification(payload),
      onUnreadCount: (payload) => setUnreadCount(payload.count ?? 0),
      onConnected: () => fetchUnreadCount(),
    });

    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <SafeAreaProvider>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <RootNavigator />
        {isAuthenticated && currentTrack && <PlayerSheet />}
        {!splashFinished && (
          <AppSplashScreen
            isReady={fontsLoaded}
            onAnimationComplete={() => setSplashFinished(true)}
          />
        )}
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
