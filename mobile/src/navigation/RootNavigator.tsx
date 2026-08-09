import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, StyleSheet } from 'react-native';
import { useAuthStore, useThemeStore } from '../store';
import { usePlayerStore } from '../store';

// Import screens (will be created separately)
import LoginScreen from '../screens/auth/LoginScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import HomeScreen from '../screens/home/HomeScreen';
import SearchScreen from '../screens/search/SearchScreen';
import LibraryScreen from '../screens/library/LibraryScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import SettingsScreen from '../screens/settings/SettingsScreen';
import AdminScreen from '../screens/admin/AdminScreen';
import NotificationsScreen from '../screens/notifications/NotificationsScreen';
import PlayerScreen from '../screens/player/PlayerScreen';
import AlbumScreen from '../screens/album/AlbumScreen';
import ArtistScreen from '../screens/artist/ArtistScreen';
import PlaylistScreen from '../screens/playlist/PlaylistScreen';
import MiniPlayer from '../components/MiniPlayer';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Player: undefined;
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
  Search: undefined;
  Library: undefined;
  Profile: undefined;
};

const RootStack = createStackNavigator<RootStackParamList>();
const AuthStack = createStackNavigator<AuthStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

const AuthNavigator = () => (
  <AuthStack.Navigator screenOptions={{ headerShown: false }}>
    <AuthStack.Screen name="Login" component={LoginScreen} />
    <AuthStack.Screen name="Register" component={RegisterScreen} />
  </AuthStack.Navigator>
);

const MainTabs = () => {
  const { theme } = useThemeStore();
  const isMiniPlayerVisible = usePlayerStore((s) => s.isMiniPlayerVisible);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: theme.colors.tabBar,
            borderTopColor: theme.colors.border,
            borderTopWidth: 0.5,
            height: isMiniPlayerVisible ? 120 : 60,
            paddingBottom: 8,
            paddingTop: 8,
          },
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.textSecondary,
          tabBarLabelStyle: { fontSize: theme.fontSize.xs, fontWeight: '600' },
        }}
      >
        <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'Home' }} />
        <Tab.Screen name="Search" component={SearchScreen} options={{ tabBarLabel: 'Search' }} />
        <Tab.Screen name="Library" component={LibraryScreen} options={{ tabBarLabel: 'Library' }} />
        <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
      </Tab.Navigator>
      {isMiniPlayerVisible && <MiniPlayer />}
    </View>
  );
};

const RootNavigator = () => {
  const { isAuthenticated, isLoading } = useAuthStore();
  const { theme } = useThemeStore();

  if (isLoading) {
    return <View style={[styles.loading, { backgroundColor: theme.colors.background }]} />;
  }

  return (
    <NavigationContainer
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
          regular: { fontFamily: 'System', fontWeight: '400' as const },
          medium: { fontFamily: 'System', fontWeight: '500' as const },
          bold: { fontFamily: 'System', fontWeight: '700' as const },
          heavy: { fontFamily: 'System', fontWeight: '800' as const },
        },
      }}
    >
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <RootStack.Screen name="Main" component={MainTabs} />
            <RootStack.Screen name="Player" component={PlayerScreen} options={{ presentation: 'modal' }} />
            <RootStack.Screen name="Album" component={AlbumScreen} />
            <RootStack.Screen name="Artist" component={ArtistScreen} />
            <RootStack.Screen name="Playlist" component={PlaylistScreen} />
            <RootStack.Screen name="Settings" component={SettingsScreen} />
            <RootStack.Screen name="Admin" component={AdminScreen} />
            <RootStack.Screen name="Notifications" component={NotificationsScreen} />
          </>
        ) : (
          <RootStack.Screen name="Auth" component={AuthNavigator} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1 },
});

export default RootNavigator;
