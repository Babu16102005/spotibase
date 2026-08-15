import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { adminApi, songApi, playlistApi } from '../../api/client';
import { useThemeStore } from '../../store';
import { AdminDashboardResponse, SongResponse, PlaylistResponse } from '../../types';
import { formatCount, formatFileSize } from '../../utils';
import Skeleton, { SongSkeleton } from '../../components/SkeletonLoader';
import SongUploader from '../../components/SongUploader';
import GlassButton from '../../components/GlassButton';

let cachedAdminData: AdminDashboardResponse | null = null;
type AdminTab = 'overview' | 'songs' | 'playlists';

interface AdminScreenProps {
  navigation?: any;
}

const AdminScreen = ({ navigation }: AdminScreenProps) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [data, setData] = useState<AdminDashboardResponse | null>(cachedAdminData);
  const [refreshing, setRefreshing] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // List states
  const [songsList, setSongsList] = useState<SongResponse[]>([]);
  const [playlistsList, setPlaylistsList] = useState<PlaylistResponse[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // New playlist modal state
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);

  const { theme } = useThemeStore();

  const fetchDashboard = useCallback(async (isManual = false) => {
    if (isManual || !cachedAdminData) setRefreshing(true);
    setFetchError(null);
    try {
      const r = isManual ? await adminApi.syncStorage() : await adminApi.getDashboard();
      cachedAdminData = r.data;
      setData(r.data);
      setAccessDenied(false);
      setFetchError(null);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setAccessDenied(true);
      } else {
        console.error('Failed to fetch admin dashboard:', err);
        setFetchError(err?.response?.data?.message || err?.message || 'Server error loading admin metrics');
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadTabData = useCallback(async (tab: AdminTab) => {
    setLoadingList(true);
    try {
      if (tab === 'songs') {
        const res = await songApi.getAll(0, 50);
        setSongsList(res.data.content || []);
      } else if (tab === 'playlists') {
        const res = await playlistApi.getFeatured(50);
        setPlaylistsList(res.data || []);
      }
    } catch (err: any) {
      console.error(`Failed to load ${tab}:`, err);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(() => {
      if (!accessDenied) fetchDashboard();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboard, accessDenied]);

  useEffect(() => {
    if (activeTab !== 'overview') {
      loadTabData(activeTab);
    }
  }, [activeTab, loadTabData]);

  // Actions
  const handleDeleteSong = (songId: string, title: string) => {
    Alert.alert('Delete Song', `Are you sure you want to permanently delete "${title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await adminApi.forceDeleteSong(songId);
            setSongsList((prev) => prev.filter((s) => s.id !== songId));
            fetchDashboard(true);
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message || 'Failed to delete song');
          }
        },
      },
    ]);
  };

  const handleToggleFeatureSong = async (songId: string) => {
    try {
      await adminApi.featureSong(songId);
      loadTabData('songs');
    } catch (err) {
      console.error('Failed to feature song:', err);
    }
  };

  const handleDeletePlaylist = (playlistId: string, name: string) => {
    Alert.alert('Delete Playlist', `Are you sure you want to delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await adminApi.forceDeletePlaylist(playlistId);
            setPlaylistsList((prev) => prev.filter((p) => p.id !== playlistId));
            fetchDashboard(true);
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.message || 'Failed to delete playlist');
          }
        },
      },
    ]);
  };

  const handleClearAllStorage = () => {
    Alert.alert(
      'Purge All Songs & Cloudflare R2 Storage',
      'This will permanently delete all songs and purge all files from the Cloudflare R2 bucket to reset storage to 0 MB. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Purge to 0 MB',
          style: 'destructive',
          onPress: async () => {
            setRefreshing(true);
            try {
              const res = await adminApi.clearAllStorage();
              cachedAdminData = res.data;
              setData(res.data);
              setSongsList([]);
              Alert.alert('Storage Cleared', 'All songs and Cloudflare R2 storage have been successfully reset to 0 MB.');
            } catch (err: any) {
              Alert.alert('Error', err?.response?.data?.message || 'Failed to clear storage');
            } finally {
              setRefreshing(false);
            }
          },
        },
      ]
    );
  };

  const handleToggleFeaturePlaylist = async (playlistId: string) => {
    try {
      await adminApi.featurePlaylist(playlistId);
      loadTabData('playlists');
    } catch (err) {
      console.error('Failed to feature playlist:', err);
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    setCreatingPlaylist(true);
    try {
      await playlistApi.create({ name: newPlaylistName.trim(), isPublic: true });
      setNewPlaylistName('');
      setShowCreatePlaylist(false);
      loadTabData('playlists');
      fetchDashboard(true);
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to create playlist');
    } finally {
      setCreatingPlaylist(false);
    }
  };

  if (accessDenied) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.background }]}>
        <Text style={styles.deniedIcon}>🔒</Text>
        <Text style={[styles.deniedTitle, { color: theme.colors.text }]}>Access Denied</Text>
        <Text style={[styles.deniedSub, { color: theme.colors.textSecondary }]}>
          Your account does not have admin privileges.
        </Text>
      </View>
    );
  }

  if (fetchError && !data) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.background }]}>
        <Text style={styles.deniedIcon}>⚠️</Text>
        <Text style={[styles.deniedTitle, { color: theme.colors.text }]}>Dashboard Error</Text>
        <Text style={[styles.deniedSub, { color: theme.colors.textSecondary }]}>{fetchError}</Text>
        <GlassButton
          variant="primary"
          size="md"
          icon="sync"
          iconSize={16}
          title="Retry Live Sync"
          onPress={() => fetchDashboard(true)}
          style={{ marginTop: 20 }}
        />
      </View>
    );
  }

  if (!data) {
    return (
      <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {navigation?.canGoBack?.() && (
              <GlassButton
                variant="metal"
                size="icon"
                icon="chevronLeft"
                iconSize={18}
                onPress={() => navigation.goBack()}
                accessibilityLabel="Back"
              />
            )}
            <Text style={[styles.title, { color: theme.colors.text }]}>Admin Dashboard</Text>
          </View>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Skeleton width="100%" height={120} style={{ borderRadius: 12, marginBottom: 16 }} />
          <View style={styles.grid}>
            {[1, 2, 3, 4].map((k) => (
              <View key={k} style={[styles.kpiCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <Skeleton width="60%" height={24} style={{ marginBottom: 8 }} />
                <Skeleton width="80%" height={14} />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    );
  }

  const totalUsedBytes = data.totalStorageUsedBytes ?? 0;
  const maxLimitBytes = data.maxStorageLimitBytes || 10 * 1024 * 1024 * 1024;
  const thresholdBytes = data.maxStorageThresholdBytes || 9.5 * 1024 * 1024 * 1024;
  const usagePercentage = Math.min((totalUsedBytes / maxLimitBytes) * 100, 100);
  const isLimitReached = data.storageLimitReached || totalUsedBytes >= thresholdBytes;

  const tabs: { key: AdminTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'songs', label: 'Songs' },
    { key: 'playlists', label: 'Playlists' },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {navigation?.canGoBack?.() && (
            <GlassButton
              variant="metal"
              size="icon"
              icon="chevronLeft"
              iconSize={18}
              onPress={() => navigation.goBack()}
              accessibilityLabel="Back"
            />
          )}
          <Text style={[styles.title, { color: theme.colors.text }]}>Admin Panel</Text>
        </View>
        <GlassButton
          variant="metal"
          size="sm"
          icon="sync"
          iconSize={14}
          title="Live Sync"
          loading={refreshing}
          onPress={() => {
            fetchDashboard(true);
            if (activeTab !== 'overview') loadTabData(activeTab);
          }}
          disabled={refreshing}
        />
      </View>

      {/* Minimal & Compact Glass Tab Selector */}
      <View style={styles.minimalTabsRow}>
        {tabs.map((tab) => (
          <GlassButton
            key={tab.key}
            variant={activeTab === tab.key ? 'primary' : 'glass'}
            size="sm"
            title={tab.label}
            onPress={() => setActiveTab(tab.key)}
            style={{ minWidth: 70 }}
          />
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }}>
        {activeTab === 'overview' && (
          <View style={{ paddingTop: 8 }}>
            {/* Storage Metric Card */}
            <View style={[styles.storageCard, { backgroundColor: theme.colors.surface, borderColor: isLimitReached ? theme.colors.error : theme.colors.border }]}>
              <View style={styles.storageHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={[styles.storageTitle, { color: theme.colors.text }]}>Cloudflare R2 Live Storage (10 GB Free Tier)</Text>
                  <Text style={{ fontSize: 11, color: theme.colors.primary, marginTop: 2, fontWeight: '600' }}>
                    🟢 {data.storageProvider || 'Cloudflare R2 (Live Connected)'} • {data.r2ObjectCount ?? 0} bucket {data.r2ObjectCount === 1 ? 'file' : 'files'}
                  </Text>
                </View>
                <Text style={[styles.storageBadge, { backgroundColor: isLimitReached ? theme.colors.error : theme.colors.primary, color: '#000' }]}>
                  {isLimitReached ? 'UPLOADS RESTRICTED' : 'FREE TIER ACTIVE'}
                </Text>
              </View>
              <View style={styles.storageMetrics}>
                <Text style={[styles.storageValue, { color: theme.colors.text }]}>
                  {formatFileSize(totalUsedBytes)} / 10.00 GB
                </Text>
                <Text style={[styles.storagePercent, { color: theme.colors.textSecondary }]}>
                  {usagePercentage.toFixed(1)}%
                </Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceLight }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${usagePercentage}%`,
                      backgroundColor: isLimitReached ? theme.colors.error : usagePercentage > 75 ? '#EAB308' : theme.colors.primary,
                    },
                  ]}
                />
              </View>

              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
                <GlassButton
                  variant="destructive"
                  size="sm"
                  icon="trash"
                  iconSize={14}
                  title="Purge All to 0 MB"
                  onPress={handleClearAllStorage}
                  disabled={refreshing}
                />
              </View>
            </View>

            {/* KPI Cards */}
            <View style={styles.grid}>
              {[
                { label: 'Total Users', value: data.totalUsers },
                { label: 'Total Songs', value: data.totalSongs },
                { label: 'Playlists', value: data.totalPlaylists },
                { label: 'Listening Hours', value: data.totalListeningHours },
              ].map((kpi, i) => (
                <View key={i} style={[styles.kpiCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <Text style={[styles.kpiValue, { color: theme.colors.text }]}>{formatCount(kpi.value)}</Text>
                  <Text style={[styles.kpiLabel, { color: theme.colors.textSecondary }]}>{kpi.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {activeTab === 'songs' && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Song Management</Text>
            </View>
            <View style={{ marginBottom: 16 }}>
              <SongUploader />
            </View>

            {loadingList ? (
              <View style={{ paddingTop: 16 }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <SongSkeleton key={i} />
                ))}
              </View>
            ) : (
              songsList.map((song) => (
                <View key={song.id} style={[styles.managementCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemTitle, { color: theme.colors.text }]} numberOfLines={1}>
                      {song.title}
                    </Text>
                    <Text style={[styles.itemSub, { color: theme.colors.textSecondary }]}>
                      {song.artistName || 'Unknown Artist'} • {song.duration || '0:00'}
                    </Text>
                  </View>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.iconActionBtn, { backgroundColor: theme.colors.surfaceLight }]}
                      onPress={() => handleToggleFeatureSong(song.id)}
                    >
                      <Text style={{ fontSize: 11 }}>{song.liked ? '★ Featured' : '☆ Feature'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.deleteActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}
                      onPress={() => handleDeleteSong(song.id, song.title)}
                    >
                      <Text style={{ color: theme.colors.error, fontSize: 11, fontWeight: '700' }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'playlists' && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Playlist Management</Text>
              <TouchableOpacity
                style={[styles.createBtn, { backgroundColor: theme.colors.primary }]}
                onPress={() => setShowCreatePlaylist(!showCreatePlaylist)}
              >
                <Text style={styles.createBtnText}>+ New Playlist</Text>
              </TouchableOpacity>
            </View>

            {showCreatePlaylist && (
              <View style={[styles.createCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <TextInput
                  style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border }]}
                  placeholder="Playlist Name..."
                  placeholderTextColor={theme.colors.textSecondary}
                  value={newPlaylistName}
                  onChangeText={setNewPlaylistName}
                />
                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: theme.colors.primary }]}
                  onPress={handleCreatePlaylist}
                  disabled={creatingPlaylist}
                >
                  {creatingPlaylist ? <ActivityIndicator color="#000" /> : <Text style={styles.submitBtnText}>Create</Text>}
                </TouchableOpacity>
              </View>
            )}

            {loadingList ? (
              <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 24 }} />
            ) : (
              playlistsList.map((pl) => (
                <View key={pl.id} style={[styles.managementCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemTitle, { color: theme.colors.text }]}>{pl.name}</Text>
                    <Text style={[styles.itemSub, { color: theme.colors.textSecondary }]}>
                      {pl.songCount || 0} songs • {pl.username || 'Admin'}
                    </Text>
                  </View>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.iconActionBtn, { backgroundColor: theme.colors.surfaceLight }]}
                      onPress={() => handleToggleFeaturePlaylist(pl.id)}
                    >
                      <Text style={{ fontSize: 11 }}>{pl.liked ? '★ Featured' : '☆ Feature'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.deleteActionBtn, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}
                      onPress={() => handleDeletePlaylist(pl.id, pl.name)}
                    >
                      <Text style={{ color: theme.colors.error, fontSize: 11, fontWeight: '700' }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center', padding: 32 },
  deniedIcon: { fontSize: 56, marginBottom: 16 },
  deniedTitle: { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  deniedSub: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { fontSize: 22, fontWeight: '800' },
  syncButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
  },
  syncButtonText: { fontSize: 11, fontWeight: '700' },
  minimalTabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginVertical: 8,
    gap: 8,
  },
  minimalTabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
  },
  minimalTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  kpiCard: { width: '45%', margin: '2.5%', padding: 14, borderRadius: 12, borderWidth: 1 },
  kpiValue: { fontSize: 22, fontWeight: '700' },
  kpiLabel: { fontSize: 11, marginTop: 4 },
  storageCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  storageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  storageTitle: { fontSize: 12, fontWeight: '700', flex: 1, marginRight: 8 },
  storageBadge: { fontSize: 9, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, overflow: 'hidden' },
  storageMetrics: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 },
  storageValue: { fontSize: 16, fontWeight: '800' },
  storagePercent: { fontSize: 12, fontWeight: '700' },
  progressTrack: { height: 6, borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  clearStorageBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  clearStorageText: { fontSize: 11, fontWeight: '700' },
  retryButton: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  retryButtonText: { color: '#000000', fontSize: 14, fontWeight: '700' },
  sectionContainer: { paddingHorizontal: 16, paddingTop: 4 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  createBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14 },
  createBtnText: { color: '#000', fontSize: 11, fontWeight: '700' },
  createCard: { flexDirection: 'row', gap: 8, marginBottom: 12, padding: 10, borderRadius: 8, borderWidth: 1 },
  input: { flex: 1, height: 34, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, fontSize: 12 },
  submitBtn: { paddingHorizontal: 14, justifyContent: 'center', borderRadius: 6 },
  submitBtnText: { color: '#000', fontWeight: '700', fontSize: 12 },
  managementCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
  },
  itemTitle: { fontSize: 14, fontWeight: '600' },
  itemSub: { fontSize: 11, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  iconActionBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  deleteActionBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
});

export default AdminScreen;
