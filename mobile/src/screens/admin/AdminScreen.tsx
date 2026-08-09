import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { adminApi } from '../../api/client';
import { useThemeStore } from '../../store';
import { AdminDashboardResponse } from '../../types';
import { formatCount } from '../../utils';

const AdminScreen = () => {
  const [data, setData] = useState<AdminDashboardResponse | null>(null);
  const { theme } = useThemeStore();

  useEffect(() => {
    adminApi.getDashboard().then(r => setData(r.data)).catch(console.error);
  }, []);

  if (!data) return <View style={[styles.container, { backgroundColor: theme.colors.background }]} />;

  const kpiCards = [
    { label: 'Total Users', value: data.totalUsers },
    { label: 'Active Users', value: data.activeUsers },
    { label: 'Total Songs', value: data.totalSongs },
    { label: 'Total Albums', value: data.totalAlbums },
    { label: 'Total Artists', value: data.totalArtists },
    { label: 'Playlists', value: data.totalPlaylists },
    { label: 'Listening Hours', value: data.totalListeningHours },
    { label: 'Downloads', value: data.totalDownloads },
  ];

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.text }]}>Admin Dashboard</Text>
      
      <View style={styles.grid}>
        {kpiCards.map((kpi, i) => (
          <View key={i} style={[styles.kpiCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.kpiValue, { color: theme.colors.text }]}>{formatCount(kpi.value)}</Text>
            <Text style={[styles.kpiLabel, { color: theme.colors.textSecondary }]}>{kpi.label}</Text>
          </View>
        ))}
      </View>

      {data.topSongs?.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Top Songs</Text>
          {data.topSongs.slice(0, 5).map((song: any, i: number) => (
            <View key={i} style={[styles.listItem, { borderBottomColor: theme.colors.border }]}>
              <Text style={[styles.listRank, { color: theme.colors.textSecondary }]}>{i + 1}</Text>
              <Text style={[styles.listText, { color: theme.colors.text }]}>{song.name || `Song ${i + 1}`}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 28, fontWeight: '800', paddingHorizontal: 16, paddingTop: 48, paddingBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  kpiCard: { width: '45%', margin: '2.5%', padding: 16, borderRadius: 12, borderWidth: 1 },
  kpiValue: { fontSize: 24, fontWeight: '700' },
  kpiLabel: { fontSize: 12, marginTop: 4 },
  section: { paddingHorizontal: 16, paddingVertical: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5 },
  listRank: { width: 30, fontSize: 14, fontWeight: '600' },
  listText: { fontSize: 14 },
});

export default AdminScreen;
