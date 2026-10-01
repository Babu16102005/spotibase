import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getStorage } from '../../utils';
import { TTL_MS, isFresh } from '../../cache/ttl';
import { libraryApi, playlistApi, songApi, adminApi } from '../../api/client';
import { useThemeStore, usePlayerStore, useAuthStore } from '../../store';
import { LibraryResponse } from '../../types';
import PlaylistCard from '../../components/PlaylistCard';
import AlbumCard from '../../components/AlbumCard';
import ArtistCard from '../../components/ArtistCard';
import SongCard from '../../components/SongCard';
import Icon from '../../components/Icon';
import GlassButton from '../../components/GlassButton';
import BulkAddToPlaylistModal from '../../components/BulkAddToPlaylistModal';
import SongBulkActionBar from '../../components/SongBulkActionBar';
import { CardSkeleton } from '../../components/SkeletonLoader';

const libraryCache = getStorage('spotibase-cache');
// Library freshness window — single source of truth lives in cache/ttl.
const LIBRARY_FRESH_MS = TTL_MS.LIBRARY;
// V2 cache holds LibraryResponse with optional featuredPlaylists.
// V1 (libraryData) is read as fallback for back-compat with old installs.
const LIBRARY_CACHE_KEY = 'libraryDataV2';
const LIBRARY_CACHE_AT_KEY = 'libraryDataAtV2';
const LEGACY_LIBRARY_CACHE_KEY = 'libraryData';
const LEGACY_LIBRARY_CACHE_AT_KEY = 'libraryDataAt';

const writeLibraryCache = (payload: LibraryResponse) => {
  try {
    libraryCache.set(LIBRARY_CACHE_KEY, JSON.stringify(payload));
    libraryCache.set(LIBRARY_CACHE_AT_KEY, Date.now());
  } catch {}
};

const readLibraryCache = (): LibraryResponse | null => {
  try {
    const rawV2 = libraryCache.getString(LIBRARY_CACHE_KEY);
    if (rawV2) return JSON.parse(rawV2);
    // Back-compat: old cache JSON has no featuredPlaylists — null-guard at use sites.
    const rawV1 = libraryCache.getString(LEGACY_LIBRARY_CACHE_KEY);
    return rawV1 ? JSON.parse(rawV1) : null;
  } catch {
    return null;
  }
};

const LibraryScreen = ({ navigation }: any) => {
  const [data, setData] = useState<LibraryResponse | null>(() => readLibraryCache());
  const [loading, setLoading] = useState(() => !data);
  const [refreshing, setRefreshing] = useState(false);
  const [showLikedSongsList, setShowLikedSongsList] = useState(false);
  const { theme } = useThemeStore();
  const playMultiple = usePlayerStore((s) => s.playMultiple);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';

  const [error, setError] = useState<string | null>(null);

  // Multi-selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAddModalVisible, setBulkAddModalVisible] = useState(false);
  const selectionMode = selectedIds.size > 0;

  // Create Playlist Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [playlistTitle, setPlaylistTitle] = useState('');
  const [playlistDesc, setPlaylistDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchLibrary = useCallback(async (force = false, signal?: AbortSignal) => {
    if (!force) {
      try {
        const cachedAt =
          (libraryCache.getNumber?.(LIBRARY_CACHE_AT_KEY) as number | null | undefined) ??
          (libraryCache.getNumber?.(LEGACY_LIBRARY_CACHE_AT_KEY) as number | null | undefined) ??
          0;
        if (isFresh(cachedAt, LIBRARY_FRESH_MS)) {
          setLoading(false);
          return;
        }
      } catch {}
    }
    setError(null);
    try {
      // Parallel, not waterfall: /library and /playlists/featured fire
      // together so latency is max(parts) instead of sum(parts). The
      // featured call is the back-compat fallback for payloads that omit
      // featuredPlaylists; its failure never fails the library.
      const [libSettled, featuredSettled] = await Promise.allSettled([
        libraryApi.getLibrary(signal),
        playlistApi.getFeatured(20, signal),
      ]);
      if (signal?.aborted) return;
      if (libSettled.status === 'rejected') throw libSettled.reason;
      const libData = libSettled.value.data as LibraryResponse;
      let merged: LibraryResponse = libData;
      // Back-compat: old payloads / old cache JSON may omit featuredPlaylists.
      const hasFeatured = Array.isArray(libData?.featuredPlaylists);
      if (!hasFeatured) {
        const fallbackFeatured =
          featuredSettled.status === 'fulfilled' && Array.isArray(featuredSettled.value.data)
            ? featuredSettled.value.data
            : [];
        merged = {
          ...libData,
          featuredPlaylists: fallbackFeatured,
          totalFeaturedPlaylists: libData?.totalFeaturedPlaylists ?? fallbackFeatured.length,
        };
      }
      setData(merged);
      writeLibraryCache(merged);
    } catch (err: any) {
      if (signal?.aborted || err?.code === 'ERR_CANCELED' || err?.name === 'AbortError' || err?.name === 'CanceledError') {
        return;
      }
      console.error('Failed to fetch library:', err);
      setError(err?.message || 'Failed to fetch library from server');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Focus is prefetch-only: MMKV paints synchronously on mount, and the
  // network only fires when the snapshot is stale (freshness gate inside
  // fetchLibrary). In-flight refetches are cancelled on blur/unmount.
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      fetchLibrary(false, controller.signal);
      return () => controller.abort();
    }, [fetchLibrary])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchLibrary(true);
  };

  // Long-press a playlist (like songs) to delete it completely.
  // Your Playlists: owner delete via playlistApi, admin via adminApi.
  // Featured: no long-press for non-admin (see render); admin force-deletes.
  const handleDeletePlaylist = useCallback(
    (playlistId: string, playlistName: string) => {
    Alert.alert(
      'Delete Playlist',
      `Delete "${playlistName}"? Songs in it stay in your library. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (isAdmin) await adminApi.forceDeletePlaylist(playlistId);
              else await playlistApi.delete(playlistId);
              // Optimistic removal from both lists, then forced refresh.
              setData((prev) => {
                if (!prev) return prev;
                const next: LibraryResponse = {
                  ...prev,
                  playlists: (prev.playlists || []).filter((p) => p.id !== playlistId),
                  featuredPlaylists: (prev.featuredPlaylists || []).filter(
                    (p) => p.id !== playlistId
                  ),
                  totalPlaylists: Math.max(0, (prev.totalPlaylists || 0) - 1),
                };
                writeLibraryCache(next);
                return next;
              });
              // Invalidate + force refetch so cache timestamp stays fresh.
              try {
                libraryCache.delete(LIBRARY_CACHE_AT_KEY);
              } catch {}
              fetchLibrary(true);
            } catch (err: any) {
              Alert.alert('Delete Failed', err?.response?.data?.message || err?.message || 'Could not delete playlist');
            }
          },
        },
      ]
    );
    },
    [isAdmin, fetchLibrary]
  );

  const handleCreatePlaylist = async () => {    if (!playlistTitle.trim()) return;
    setCreating(true);
    try {
      const res = await playlistApi.create({
        name: playlistTitle.trim(),
        description: playlistDesc.trim() || undefined,
      });
      const created = res.data;
      // Optimistic insert so the new playlist appears instantly.
      if (created) {
        setData((prev) => {
          if (!prev) return prev;
          if ((prev.playlists || []).some((p) => p.id === created.id)) return prev;
          const next: LibraryResponse = {
            ...prev,
            playlists: [created, ...(prev.playlists || [])],
            totalPlaylists: (prev.totalPlaylists || 0) + 1,
          };
          writeLibraryCache(next);
          return next;
        });
      }
      setPlaylistTitle('');
      setPlaylistDesc('');
      setCreateModalVisible(false);
      // Forced refresh updates cache timestamp + featured fallback.
      fetchLibrary(true);
    } catch (err: any) {
      console.error('Error creating playlist:', err);
      // Keep the modal open so the user doesn't lose their input.
      Alert.alert(
        'Could Not Create Playlist',
        err?.response?.data?.message || err?.message || 'Could not create playlist. Please try again.'
      );
    } finally {
      setCreating(false);
    }
  };

  const likedCount = data?.likedSongs?.length || 0;

  const toggleSelect = useCallback((songId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });
  }, []);

  const selectAll = () => {
    if (!data?.likedSongs) return;
    setSelectedIds(new Set(data.likedSongs.map((s) => s.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkUnlike = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    Alert.alert(
      'Remove from Liked Songs',
      `Remove ${count} selected ${count === 1 ? 'song' : 'songs'} from your liked songs?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const idsToRemove = Array.from(selectedIds);
            for (const songId of idsToRemove) {
              try {
                await songApi.unlike(songId);
              } catch (e) {}
            }
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    likedSongs: prev.likedSongs?.filter((s) => !selectedIds.has(s.id)) || [],
                  }
                : prev
            );
            setSelectedIds(new Set());
          },
        },
      ]
    );
  };

  const renderMainContent = useCallback(() => {
    if (loading) return <CardSkeleton count={6} />;
    if (error && !data) {
      return (
        <View style={styles.errorContainer}>
          <Icon name="close" size={32} color={theme.colors.error || '#EF4444'} />
          <Text style={[styles.errorTitle, { color: theme.colors.text }]}>Network Connection Error</Text>
          <Text style={[styles.errorSub, { color: theme.colors.textSecondary }]}>
            Unable to connect to SpotiBase server. Please verify your connection or login status.
          </Text>
          <GlassButton
            variant="primary"
            size="md"
            title="Retry Connection"
            onPress={() => fetchLibrary(true)}
            style={{ marginTop: 16 }}
          />
        </View>
      );
    }
    if (!data) return <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>Nothing in your library yet</Text>;

    // Null-guard old cache JSON (V1 has no featuredPlaylists) + guard duplicate ids
    // so a playlist never renders in both sections.
    const userPlaylists = data.playlists || [];
    const userIds = new Set(userPlaylists.map((p) => p.id));
    const seenFeatured = new Set<string>();
    const featuredPlaylists = (data.featuredPlaylists || []).filter((p) => {
      if (!p || userIds.has(p.id) || seenFeatured.has(p.id)) return false;
      seenFeatured.add(p.id);
      return true;
    });

    return (
      <View style={styles.sectionContainer}>
        {/* 1. Liked Songs as Top First Playlist */}
        <TouchableOpacity
          style={[
            styles.likedSongsCard,
            {
              borderColor: theme.colors.border,
            },
          ]}
          onPress={() => setShowLikedSongsList(!showLikedSongsList)}
          activeOpacity={0.85}
        >
          <View style={styles.likedSongsHeader}>
            <View style={styles.heartIconBubble}>
              <Icon name="heartFilled" size={24} color="#FFFFFF" />
            </View>
            <View style={styles.likedSongsTextCol}>
              <View style={styles.topBadgeRow}>
                <Text style={styles.topBadgeText}>TOP PLAYLIST #1</Text>
              </View>
              <Text style={styles.likedSongsTitle}>Liked Songs</Text>
              <Text style={styles.likedSongsSubtitle}>
                {likedCount} {likedCount === 1 ? 'song' : 'songs'} in your collection
              </Text>
            </View>
            <GlassButton
              variant="primary"
              size="icon"
              icon="play"
              iconSize={18}
              iconColor="#000000"
              onPress={() => {
                if (data.likedSongs && data.likedSongs.length > 0) {
                  playMultiple(data.likedSongs, 0);
                } else {
                  setShowLikedSongsList(true);
                }
              }}
              accessibilityLabel="Play Liked Songs"
            />
          </View>

          {/* Toggle Indicator */}
          <View style={styles.likedExpandRow}>
            <Text style={styles.likedExpandText}>
              {showLikedSongsList ? 'Hide tracks' : 'View tracks'}
            </Text>
            <Icon name={showLikedSongsList ? 'chevronUp' : 'chevronDown'} size={14} color="rgba(255,255,255,0.7)" />
          </View>
        </TouchableOpacity>

        {/* Liked Songs Expanded List */}
        {showLikedSongsList && (
          <View style={[styles.likedExpandedList, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <Text style={[styles.expandedTitle, { color: theme.colors.text }]}>Liked Songs ({likedCount})</Text>
            {data.likedSongs?.map((s, index) => (
              <SongCard
                key={s.id}
                song={s}
                index={index}
                onPress={() => (selectionMode ? toggleSelect(s.id) : (data.likedSongs && playMultiple(data.likedSongs, index)))}
                onSongUpdated={() => fetchLibrary(true)}
                selectionMode={selectionMode}
                isSelected={selectedIds.has(s.id)}
                onToggleSelect={() => toggleSelect(s.id)}
                onLongPress={() => toggleSelect(s.id)}
              />
            ))}
            {likedCount === 0 && (
              <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>No liked songs yet</Text>
            )}
          </View>
        )}

        {/* 2. Create Playlist Option below Liked Songs */}
        <TouchableOpacity
          style={[
            styles.createPlaylistBanner,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.primary,
            },
          ]}
          onPress={() => setCreateModalVisible(true)}
          activeOpacity={0.8}
        >
          <View style={[styles.createIconBubble, { backgroundColor: theme.colors.primary }]}>
            <Icon name="plus" size={18} color="#000000" />
          </View>
          <View style={styles.createBannerTextCol}>
            <Text style={[styles.createBannerTitle, { color: theme.colors.text }]}>
              Create New Playlist
            </Text>
            <Text style={[styles.createBannerSub, { color: theme.colors.textSecondary }]}>
              Add songs by ID to optimize storage & maintain capacity
            </Text>
          </View>
          <Icon name="chevronRight" size={16} color={theme.colors.textTertiary} />
        </TouchableOpacity>

        {/* 3. User Playlists Grid */}
        <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Your Playlists</Text>
        <View style={styles.grid}>
          {userPlaylists.map((p) => (
            <PlaylistCard
              key={p.id}
              playlist={p}
              onPress={() => navigation?.navigate('Playlist', { id: p.id })}
              onLongPress={() => handleDeletePlaylist(p.id, p.name)}
            />
          ))}
          {userPlaylists.length === 0 && (
            <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>
              No user playlists created yet. Click above to create one!
            </Text>
          )}
        </View>

        {/* 3b. Featured Playlists — tap navigates; no delete for non-admin,
            admin long-press force-deletes. Liked-song SongCards keep no
            contextPlaylistId (link-only remove lives on PlaylistScreen). */}
        <Text style={[styles.sectionTitle, { color: theme.colors.text, marginTop: 24 }]}>
          Featured Playlists
        </Text>
        {featuredPlaylists.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.featuredRow}
            accessibilityLabel="Featured playlists"
          >
            {featuredPlaylists.map((p) => (
              <PlaylistCard
                key={p.id}
                playlist={p}
                onPress={() => navigation?.navigate('Playlist', { id: p.id })}
                onLongPress={
                  isAdmin ? () => handleDeletePlaylist(p.id, p.name) : undefined
                }
              />
            ))}
          </ScrollView>
        ) : (
          <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>
            No featured playlists right now. Check back soon!
          </Text>
        )}

        {/* 4. Liked Albums Section (If Any) */}
        {data.albums && data.albums.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: theme.colors.text, marginTop: 24 }]}>Liked Albums</Text>
            <View style={styles.grid}>
              {data.albums.map((a) => (
                <AlbumCard key={a.id} album={a} onPress={() => navigation?.navigate('Album', { id: a.id })} />
              ))}
            </View>
          </>
        )}

        {/* 5. Followed Artists Section (If Any) */}
        {data.artists && data.artists.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: theme.colors.text, marginTop: 24 }]}>Followed Artists</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.artistRow}>
              {data.artists.map((a) => (
                <ArtistCard key={a.id} artist={a} onPress={() => navigation?.navigate('Artist', { id: a.id })} />
              ))}
            </ScrollView>
          </>
        )}
      </View>
    );
  }, [loading, error, data, theme, fetchLibrary, likedCount, showLikedSongsList, toggleSelect, selectionMode, selectedIds, navigation, handleDeletePlaylist, playMultiple, isAdmin]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.text }]}>Your Library</Text>

      {/* Content Scroll View (Tab row buttons removed as requested) */}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
      >
        {renderMainContent()}
      </ScrollView>

      {/* Create Playlist Modal */}
      <Modal visible={createModalVisible} transparent animationType="slide" onRequestClose={() => setCreateModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Create Playlist</Text>
              <TouchableOpacity onPress={() => setCreateModalVisible(false)} style={{ padding: 4 }}>
                <Icon name="close" size={16} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Playlist Title</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.background, color: theme.colors.text, borderColor: theme.colors.border }]}
              placeholder="e.g. Chill Beats, Gym Pump, Favorites"
              placeholderTextColor={theme.colors.textTertiary}
              value={playlistTitle}
              onChangeText={setPlaylistTitle}
              autoFocus
            />

            <Text style={[styles.inputLabel, { color: theme.colors.textSecondary, marginTop: 8 }]}>
              Description (Optional)
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.colors.background, color: theme.colors.text, borderColor: theme.colors.border }]}
              placeholder="Add songs by ID to save storage..."
              placeholderTextColor={theme.colors.textTertiary}
              value={playlistDesc}
              onChangeText={setPlaylistDesc}
            />

            <View style={styles.modalActions}>
              <GlassButton
                variant="outline"
                size="md"
                title="Cancel"
                onPress={() => setCreateModalVisible(false)}
              />
              <GlassButton
                variant="primary"
                size="md"
                title="Create Playlist"
                disabled={!playlistTitle.trim() || creating}
                loading={creating}
                onPress={handleCreatePlaylist}
              />
            </View>
          </View>
        </View>
      </Modal>

      {selectionMode && (
        <SongBulkActionBar
          selectedCount={selectedIds.size}
          totalCount={data?.likedSongs?.length || 0}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onClose={deselectAll}
          onAddToPlaylist={() => setBulkAddModalVisible(true)}
          onDelete={handleBulkUnlike}
          deleteLabel="Unlike"
        />
      )}

      <BulkAddToPlaylistModal
        visible={bulkAddModalVisible}
        songIds={Array.from(selectedIds)}
        onClose={() => setBulkAddModalVisible(false)}
        onSuccess={() => {
          deselectAll();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 28, fontWeight: '800', paddingHorizontal: 16, paddingTop: 48, paddingBottom: 12 },
  content: { paddingBottom: 120 },
  sectionContainer: { paddingHorizontal: 16 },

  // Top #1 Liked Songs Card
  likedSongsCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    backgroundColor: '#1E1B4B',
    borderWidth: 1,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  likedSongsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heartIconBubble: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#EC4899',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  likedSongsTextCol: {
    flex: 1,
  },
  topBadgeRow: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 4,
  },
  topBadgeText: {
    color: '#F472B6',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  likedSongsTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  likedSongsSubtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    marginTop: 2,
  },
  likedSongsPlayBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1DB954',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  likedExpandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255, 255, 255, 0.15)',
    gap: 6,
  },
  likedExpandText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 11,
    fontWeight: '600',
  },
  likedExpandedList: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    marginBottom: 16,
  },
  expandedTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    paddingHorizontal: 4,
  },

  // Create Playlist Banner below Liked Songs
  createPlaylistBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  createIconBubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  createBannerTextCol: {
    flex: 1,
  },
  createBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  createBannerSub: {
    fontSize: 11,
    marginTop: 2,
  },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  featuredRow: { paddingHorizontal: 4, paddingVertical: 8, gap: 12 },
  artistRow: { paddingHorizontal: 4, paddingVertical: 8 },
  empty: { fontSize: 14, padding: 32, textAlign: 'center' },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '92%',
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  inputLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4 },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  cancelBtnText: { fontSize: 13, fontWeight: '600' },
  createSubmitBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  createSubmitText: { color: '#000000', fontSize: 13, fontWeight: '700' },
  errorContainer: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 12,
  },
  errorSub: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 280,
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default LibraryScreen;
