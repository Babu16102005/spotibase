import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { useThemeStore, usePlayerStore } from '../../store';

const SettingsScreen = ({ navigation }: any) => {
  const { theme, themeMode, setThemeMode } = useThemeStore();
  const { shuffle, repeat, setShuffle, setRepeat, volume, setVolume } = usePlayerStore();

  const qualityOptions = ['LOW', 'MEDIUM', 'HIGH', 'LOSSLESS'];

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.text }]}>Settings</Text>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>Theme</Text>
        <View style={styles.themeRow}>
          {(['DARK', 'AMOLED', 'LIGHT'] as const).map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.themeButton, { backgroundColor: themeMode === m ? theme.colors.primary : theme.colors.surface }]}
              onPress={() => setThemeMode(m)}
            >
              <Text style={{ color: themeMode === m ? '#000' : theme.colors.text, fontWeight: '600', fontSize: 13 }}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>Playback</Text>
        <View style={[styles.settingRow, { borderBottomColor: theme.colors.border }]}>
          <Text style={[styles.settingLabel, { color: theme.colors.text }]}>Shuffle</Text>
          <Switch value={shuffle} onValueChange={setShuffle} trackColor={{ true: theme.colors.primary }} />
        </View>
        <View style={styles.settingRow}>
          <Text style={[styles.settingLabel, { color: theme.colors.text }]}>Repeat</Text>
          <TouchableOpacity onPress={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}>
            <Text style={[styles.settingValue, { color: theme.colors.primary }]}>
              {repeat === 'off' ? 'Off' : repeat === 'all' ? 'All' : 'One'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>Audio Quality</Text>
        <View style={styles.qualityRow}>
          {qualityOptions.map(q => (
            <TouchableOpacity key={q} style={[styles.qualityButton, { backgroundColor: theme.colors.surface }]}>
              <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: '600' }}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>About</Text>
        <Text style={[styles.aboutText, { color: theme.colors.textTertiary }]}>SpotiBase v1.0.0</Text>
        <Text style={[styles.aboutText, { color: theme.colors.textTertiary }]}>A premium music streaming experience</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 28, fontWeight: '800', paddingHorizontal: 16, paddingTop: 48, paddingBottom: 16 },
  section: { paddingHorizontal: 16, paddingVertical: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  themeRow: { flexDirection: 'row', gap: 8 },
  themeButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 0.5 },
  settingLabel: { fontSize: 16 },
  settingValue: { fontSize: 14, fontWeight: '600' },
  qualityRow: { flexDirection: 'row', gap: 8 },
  qualityButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  aboutText: { fontSize: 14, marginTop: 4 },
});

export default SettingsScreen;
