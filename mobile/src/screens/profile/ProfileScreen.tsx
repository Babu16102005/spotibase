import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, ScrollView } from 'react-native';
import { useAuthStore, useThemeStore } from '../../store';
import SongUploader from '../../components/SongUploader';
import GlassButton from '../../components/GlassButton';
import { coverSource } from '../../utils';

const ProfileScreen = ({ navigation }: any) => {
  const { user, logout } = useAuthStore();
  const { theme, themeMode, setThemeMode, greetingPattern, setGreetingPattern } = useThemeStore();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Image
          source={coverSource(user?.avatarUrl)}
          style={[styles.avatar, { borderColor: theme.colors.border }]}
        />
        <Text style={[styles.name, { color: theme.colors.text }]}>{user?.username}</Text>
        <Text style={[styles.email, { color: theme.colors.textSecondary }]}>{user?.email}</Text>
        {user?.bio && <Text style={[styles.bio, { color: theme.colors.textSecondary }]}>{user.bio}</Text>}

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={[styles.statValue, { color: theme.colors.text }]}>{user?.role || 'USER'}</Text>
            <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Role</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Appearance & Theme</Text>
        <View style={styles.themeRow}>
          {(['DARK', 'AMOLED', 'LIGHT'] as const).map((mode) => (
            <GlassButton
              key={mode}
              variant={themeMode === mode ? 'primary' : 'metal'}
              size="sm"
              title={mode}
              onPress={() => setThemeMode(mode)}
              style={{ flex: 1, minWidth: 80, justifyContent: 'center' }}
            />
          ))}
        </View>

        <Text style={[styles.subSectionTitle, { color: theme.colors.textSecondary }]}>Greeting Section Theme</Text>
        <View style={styles.patternGrid}>
          {(['RANDOM', 'FLUID', 'AURORA', 'COSMIC', 'GEOMETRIC'] as const).map((pat) => (
            <GlassButton
              key={pat}
              variant={greetingPattern === pat ? 'primary' : 'glass'}
              size="sm"
              title={pat}
              onPress={() => setGreetingPattern(pat)}
              style={{ borderRadius: 14 }}
              textStyle={{ fontSize: 11 }}
            />
          ))}
        </View>
      </View>

      {isAdmin && (
        <View style={[styles.section, { borderBottomWidth: 0.5, borderBottomColor: theme.colors.border }]}>
          <SongUploader />
        </View>
      )}

      <View style={styles.section}>
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
  subSectionTitle: { fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  themeRow: { flexDirection: 'row', gap: 8 },
  patternGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  menuItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 0.5 },
  menuItemText: { fontSize: 16 },
});

export default ProfileScreen;
