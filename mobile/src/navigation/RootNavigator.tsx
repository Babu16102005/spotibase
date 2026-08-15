import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { useAuthStore, useThemeStore } from '../store';
import { usePlayerStore } from '../store';

// Import screens (will be created separately)
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import HomeScreen from '../screens/home/HomeScreen';
import SearchScreen from '../screens/search/SearchScreen';
import LibraryScreen from '../screens/library/LibraryScreen';
import AllSongsScreen from '../screens/songs/AllSongsScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import AdminScreen from '../screens/admin/AdminScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import AlbumScreen from '../screens/album/AlbumScreen';
import ArtistScreen from '../screens/artist/ArtistScreen';
import PlaylistScreen from '../screens/playlist/PlaylistScreen';
import MiniPlayer from '../components/MiniPlayer';
import Sidebar, { TabKey } from '../components/Sidebar';
import PlayBar from '../components/PlayBar';
import Icon from '../components/Icon';
import GlobalBulkSelectionBar from '../components/GlobalBulkSelectionBar';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Album: { id: string };
  Artist: { id: string };
  Playlist: { id: string };
  Profile: undefined;
  Settings: undefined;
  Admin: undefined;
  Notifications: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Search: { genre?: string } | undefined;
  Library: undefined;
  Songs: undefined;
  Profile: undefined;
};

const RootStack = createStackNavigator<RootStackParamList>();
const AuthStack = createStackNavigator<AuthStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

const DESKTOP_MIN_WIDTH = 1100;

const AuthNavigator = () => (
  <AuthStack.Navigator screenOptions={{ headerShown: false }}>
    <AuthStack.Screen name="Login" component={LoginScreen} />
    <AuthStack.Screen name="Register" component={RegisterScreen} />
  </AuthStack.Navigator>
);

const TAB_ICONS: Partial<Record<keyof MainTabParamList, React.ComponentProps<typeof Icon>['name']>> = {
  Home: 'home',
  Songs: 'songs',
  Library: 'library',
  Profile: 'profile',
};

const MainTabs = () => {
  const { theme } = useThemeStore();
  const isMiniPlayerVisible = usePlayerStore((s) => s.isMiniPlayerVisible);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const [activeTab, setActiveTab] = React.useState<TabKey>('Home');
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;

  const navigateToTab = (tab: TabKey) => {
    setActiveTab(tab);
    if (navigationRef.isReady()) {
      navigationRef.navigate('Main', { screen: tab } as any);
    }
  };

  const tabBar = (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.tabBar,
          borderTopColor: theme.colors.border,
          borderTopWidth: 0.5,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
          ...(isDesktop ? { display: 'none' } : {}),
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        tabBarIcon: ({ color, size }) => (
          <Icon name={TAB_ICONS[route.name as keyof MainTabParamList] || 'music'} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Home' }} />
      <Tab.Screen name="Songs" component={AllSongsScreen} options={{ tabBarLabel: 'Songs' }} />
      <Tab.Screen name="Library" component={LibraryScreen} options={{ tabBarLabel: 'Library' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
    </Tab.Navigator>
  );

  if (isDesktop) {
    return (
      <View style={styles.desktopShell}>
        {/* macOS Desktop Wallpaper Background */}
        <View style={[styles.wallpaper, { backgroundColor: theme.dark ? '#0A0B10' : '#EAF0F6' }]}>
          {theme.dark ? (
            // Dark Mode Mesh Gradient
            <View style={styles.gradientContainer}>
              <View style={[styles.gradientBubble, { top: '-20%', left: '-10%', width: '60%', height: '60%', backgroundColor: '#1A1B4B', opacity: 0.8 }]} />
              <View style={[styles.gradientBubble, { top: '-10%', right: '-10%', width: '70%', height: '70%', backgroundColor: '#4C1D95', opacity: 0.65 }]} />
              <View style={[styles.gradientBubble, { bottom: '-20%', left: '20%', width: '65%', height: '65%', backgroundColor: '#831843', opacity: 0.5 }]} />
              <View style={[styles.gradientBubble, { bottom: '10%', right: '-20%', width: '55%', height: '55%', backgroundColor: '#1E1B4B', opacity: 0.9 }]} />
            </View>
          ) : (
            // Light Mode Mesh Gradient
            <View style={styles.gradientContainer}>
              <View style={[styles.gradientBubble, { top: '-20%', left: '-10%', width: '60%', height: '60%', backgroundColor: '#D2E3FC', opacity: 0.85 }]} />
              <View style={[styles.gradientBubble, { top: '-10%', right: '-10%', width: '70%', height: '70%', backgroundColor: '#F3E8FF', opacity: 0.8 }]} />
              <View style={[styles.gradientBubble, { bottom: '-20%', left: '20%', width: '65%', height: '65%', backgroundColor: '#FCE7F3', opacity: 0.75 }]} />
              <View style={[styles.gradientBubble, { bottom: '10%', right: '-20%', width: '55%', height: '55%', backgroundColor: '#E0F2FE', opacity: 0.9 }]} />
            </View>
          )}
        </View>

        {/* Floating App Window */}
        <View style={[
          styles.appWindow,
          {
            backgroundColor: theme.colors.background,
            borderColor: theme.colors.border,
            boxShadow: theme.dark
              ? '0 25px 50px -12px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
              : '0 25px 50px -12px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
          } as any
        ]}>
          <Sidebar activeTab={activeTab} onSelectTab={navigateToTab} />
          <View style={styles.desktopMain}>
            <View style={styles.mainContentWrapper}>
              {tabBar}
            </View>
            {isMiniPlayerVisible && currentTrack ? (
              <PlayBar onOpenPlayer={() => usePlayerStore.getState().expandPlayer()} />
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {tabBar}
      {isMiniPlayerVisible && <MiniPlayer />}
    </View>
  );
};

const RootNavigator = () => {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const { theme } = useThemeStore();
  const isAdmin = user?.role === 'ADMIN';

  if (isLoading) {
    return <View style={[styles.loading, { backgroundColor: theme.colors.background }]} />;
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={{
        dark: theme.dark,
        colors: {
          primary: theme.colors.primary,
          background: theme.colors.background,
          card: theme.colors.surface,
          text: theme.colors.text,
          border: theme.colors.border,
          notification: theme.colors.error,
        },
        fonts: {
          regular: { fontFamily: theme.fonts.regular, fontWeight: '400' as const },
          medium: { fontFamily: theme.fonts.medium, fontWeight: '500' as const },
          bold: { fontFamily: theme.fonts.bold, fontWeight: '700' as const },
          heavy: { fontFamily: theme.fonts.display, fontWeight: '800' as const },
        },
      }}
    >
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <RootStack.Screen name="Main" component={MainTabs} />
            <RootStack.Screen name="Album" component={AlbumScreen} />
            <RootStack.Screen name="Artist" component={ArtistScreen} />
            <RootStack.Screen name="Playlist" component={PlaylistScreen} />
            <RootStack.Screen name="Settings" component={SettingsScreen} />
            {isAdmin && <RootStack.Screen name="Admin" component={AdminScreen} />}
            <RootStack.Screen name="Notifications" component={NotificationsScreen} />
          </>
        ) : (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        )}
      </RootStack.Navigator>
      {isAuthenticated && <GlobalBulkSelectionBar />}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1 },
  desktopShell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
  wallpaper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
    overflow: 'hidden',
  },
  gradientContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  gradientBubble: {
    position: 'absolute',
    borderRadius: 999,
    filter: 'blur(80px)',
    WebkitFilter: 'blur(80px)',
  } as any,
  appWindow: {
    width: '95%',
    height: '92%',
    maxWidth: 1360,
    maxHeight: 840,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    zIndex: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.35,
    shadowRadius: 30,
    ...(Platform.OS === 'web' ? {
      backdropFilter: 'blur(30px)',
      WebkitBackdropFilter: 'blur(30px)',
    } : {}),
  },
  desktopMain: {
    flex: 1,
    flexDirection: 'column',
    minWidth: 0,
  },
  mainContentWrapper: {
    flex: 1,
    minWidth: 0,
  },
});

export default RootNavigator;