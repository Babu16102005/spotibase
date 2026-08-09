import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, ScrollView } from 'react-native';
import { useAuthStore, useNotificationStore, useThemeStore } from '../../store';
import { formatCount } from '../../utils';

const ProfileScreen = ({ navigation }: any) => {
  const { user, logout } = useAuthStore();
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const { theme, themeMode, setThemeMode } = useThemeStore();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Image
          source={{ uri: user?.avatarUrl || 'https://via.placeholder.com/120' }}
          style={[styles.avatar, { borderColor: theme.colors.border }]}
        />
        <Text style={[styles.name, { color: theme.colors.text }]}>{user?.username}</Text>
        <Text style={[styles.email, { color: theme.colors.textSecondary }]}>{user?.email}</Text>
        {user?.bio && <Text style={[styles.bio, { color: theme.colors.textSecondary }]}>{user.bio}</Text>}

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.colors.text }]}>{formatCount(user?.followerCount || 0)}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Followers</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.colors.text }]}>{formatCount(user?.followingCount || 0)}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Following</Text>
          </View>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.colors.text }]}>{user?.role || 'USER'}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Role</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Appearance</Text>
        <View style={styles.themeRow}>
          {(['DARK', 'AMOLED', 'LIGHT'] as const).map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[styles.themeButton, { backgroundColor: themeMode === mode ? theme.colors.primary : theme.colors.surface }]}
              onPress={() => setThemeMode(mode)}
            >
              <Text style={[styles.themeButtonText, { color: themeMode === mode ? '#000' : theme.colors.text }]}>{mode}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <TouchableOpacity
          style={[styles.menuItem, { borderBottomColor: theme.colors.border }]}
          onPress={() => navigation?.navigate('Notifications')}
        >
          <View style={styles.menuRow}>
            <Text style={[styles.menuItemText, { color: theme.colors.text }]}>Notifications</Text>
            {unreadCount > 0 && (
              <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </View>
          <Text style={{ color: theme.colors.textSecondary }}>›</Text>
        </TouchableOpacity>
        {isAdmin && (
          <TouchableOpacity
            style={[styles.menuItem, { borderBottomColor: theme.colors.border }]}
            onPress={() => navigation?.navigate('Admin')}
          >
            <Text style={[styles.menuItemText, { color: theme.colors.text }]}>Admin Panel</Text>
            <Text style={{ color: theme.colors.textSecondary }}>›</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.menuItem, { borderBottomColor: theme.colors.border }]} onPress={() => navigation?.navigate('Settings')}>
          <Text style={[styles.menuItemText, { color: theme.colors.text }]}>Settings</Text>
          <Text style={{ color: theme.colors.textSecondary }}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.menuItem} onPress={logout}>
          <Text style={[styles.menuItemText, { color: theme.colors.error }]}>Log Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24 },
  avatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, marginBottom: 16 },
  name: { fontSize: 24, fontWeight: '700' },
  email: { fontSize: 14, marginTop: 4 },
  bio: { fontSize: 13, marginTop: 8, textAlign: 'center' },
  statsRow: { flexDirection: 'row', marginTop: 24, gap: 32 },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 12, marginTop: 2 },
  section: { paddingHorizontal: 24, paddingVertical: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  themeRow: { flexDirection: 'row', gap: 8 },
  themeButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  themeButtonText: { fontSize: 12, fontWeight: '600' },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 0.5 },
  menuItemText: { fontSize: 16 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#000', fontSize: 12, fontWeight: '700' },
});

export default ProfileScreen;
