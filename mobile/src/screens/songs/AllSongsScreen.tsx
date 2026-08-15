import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, RefreshControl, TouchableOpacity, TextInput, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { songApi, searchApi, adminApi } from '../../api/client';
import { usePlayerStore, useThemeStore, useAuthStore } from '../../store';
import { SongResponse } from '../../types';
import SongRow from '../../components/SongRow';
import Icon from '../../components/Icon';
import GlassButton from '../../components/GlassButton';
import BulkAddToPlaylistModal from '../../components/BulkAddToPlaylistModal';
import SongBulkActionBar from '../../components/SongBulkActionBar';
import { CardSkeleton, SongSkeleton } from '../../components/SkeletonLoader';
import { getStorage } from '../../utils';

const PAGE_SIZE = 10;

const songsCache = getStorage('spotibase-cache');

const AllSongsScreen = () => {
  const { theme } = useThemeStore();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const playMultiple = usePlayerStore((s) => s.playMultiple);

  const [songs, setSongs] = useState<SongResponse[]>(() => {
    try {
      const cached = songsCache.getString('allSongsData');
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [total, setTotal] = useState(() => songs.length);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(() => songs.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SongResponse[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<any>(null);

  // Multi-selection states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAddModalVisible, setBulkAddModalVisible] = useState(false);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'ADMIN';
  const selectionMode = selectedIds.size > 0;

  const fetchPage = useCallback(async (pageNum: number, replace: boolean) => {
    setFetchError(null);
    try {
      const res = await songApi.getAll(pageNum, PAGE_SIZE);
      const content = res.data.content;
      setSongs((prev) => {
        const nextSongs = replace ? content : [...prev, ...content];
        if (replace) {
          try { songsCache.set('allSongsData', JSON.stringify(content)); } catch {}
        }
        return nextSongs;
      });
      setTotal(res.data.totalElements);
      setHasMore(!res.data.last && content.length > 0);
      setPage(pageNum);
      setFetchError(null);
    } catch (err: any) {
      console.error('Failed to fetch songs:', err);
      if (err?.response?.status === 403) {
        setFetchError('Access Restricted (403): Please log in or check your account permissions.');
      } else {
        setFetchError(err?.response?.data?.message || err?.message || 'Failed to connect to song library server');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  // Reload first page when the screen gains focus
  useFocusEffect(
    useCallback(() => {
      if (!searchQuery.trim()) {
        fetchPage(0, true);
      }
    }, [fetchPage, searchQuery])
  );

  useEffect(() => {
    if (!searchQuery.trim()) {
      fetchPage(0, true);
    }
  }, [fetchPage, searchQuery]);

  const onRefresh = () => {
    if (searchQuery.trim()) {
      handleSearchQueryChange(searchQuery);
    } else {
      setRefreshing(true);
      fetchPage(0, true);
    }
  };

  const onEndReached = () => {
    if (searchQuery.trim() || !hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    fetchPage(page + 1, false);
  };

  const handlePlay = (index: number) => {
    const list = searchQuery.trim() ? searchResults : songs;
    if (list.length === 0) return;
    playMultiple(list, index);
  };

  const handleToggleLike = async (song: SongResponse) => {
    const nextLiked = !song.liked;
    // Optimistic update
    setSongs((prev) => prev.map((s) => (s.id === song.id ? { ...s, liked: nextLiked } : s)));
    setSearchResults((prev) => prev.map((s) => (s.id === song.id ? { ...s, liked: nextLiked } : s)));
    try {
      if (nextLiked) await songApi.like(song.id);
      else await songApi.unlike(song.id);
    } catch (err) {
      console.error('Like toggle failed:', err);
      // Roll back on error
      setSongs((prev) => prev.map((s) => (s.id === song.id ? { ...s, liked: song.liked } : s)));
      setSearchResults((prev) => prev.map((s) => (s.id === song.id ? { ...s, liked: song.liked } : s)));
    }
  };

  const handleSearchQueryChange = (q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchApi.search(q, 'song');
        setSearchResults(res.data.songs || []);
      } catch (err) {
        console.error('Songs search error:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const filteredLocalSongs = React.useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return songs.filter((s) => {
      const matchTitle = s.title && s.title.toLowerCase().includes(q);
      const matchArtist = s.artistName && s.artistName.toLowerCase().includes(q);
      const matchAlbumArtist = s.albumArtistName && s.albumArtistName.toLowerCase().includes(q);
      const matchContributing = s.contributingArtists?.some(
        (ca) => ca.artistName && ca.artistName.toLowerCase().includes(q)
      );
      const matchComposer = s.composer && s.composer.toLowerCase().includes(q);
      return matchTitle || matchArtist || matchAlbumArtist || matchContributing || matchComposer;
    });
  }, [songs, searchQuery]);

  const activeSongs = React.useMemo(() => {
    if (!searchQuery.trim()) return songs;
    const map = new Map<string, SongResponse>();
    searchResults.forEach((s) => map.set(s.id, s));
    filteredLocalSongs.forEach((s) => {
      if (!map.has(s.id)) map.set(s.id, s);
    });
    return Array.from(map.values());
  }, [searchQuery, songs, searchResults, filteredLocalSongs]);

  const isPlaying = playbackState === 'playing';

  if (loading && songs.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.text }]}>All Songs</Text>
        </View>
        <View style={{ marginTop: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <SongSkeleton key={i} />
          ))}
        </View>
      </View>
    );
  }

  if (fetchError && songs.length === 0) {
    return (
      <View style={[styles.container, styles.centerError, { backgroundColor: theme.colors.background }]}>
        <Icon name="close" size={36} color={theme.colors.error || '#EF4444'} />
        <Text style={[styles.errorTitle, { color: theme.colors.text }]}>Songs Library Unavailable</Text>
        <Text style={[styles.errorSub, { color: theme.colors.textSecondary }]}>{fetchError}</Text>
        <GlassButton
          variant="primary"
          size="md"
          title="Retry Connection"
          onPress={() => fetchPage(0, true)}
          style={{ marginTop: 16 }}
        />
      </View>
    );
  }

  const activeTotalCount = searchQuery.trim() ? activeSongs.length : total;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleLongPress = (id: string) => {
    toggleSelect(id);
  };

  const selectAll = () => {
    setSelectedIds(new Set(activeSongs.map((s) => s.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDelete = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    Alert.alert(
      'Delete Songs',
      `Are you sure you want to permanently delete ${count} selected ${count === 1 ? 'song' : 'songs'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const idsToDelete = Array.from(selectedIds);
            for (const id of idsToDelete) {
              try {
                if (isAdmin) await adminApi.forceDeleteSong(id);
                else await songApi.delete(id);
              } catch (e) {}
            }
            setSongs((prev) => prev.filter((s) => !selectedIds.has(s.id)));
            setSearchResults((prev) => prev.filter((s) => !selectedIds.has(s.id)));
            setSelectedIds(new Set());
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.colors.text }]}>All Songs</Text>

        <View style={[styles.searchBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Icon name="search" size={16} color={theme.colors.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={[styles.input, { color: theme.colors.text }]}
            placeholder="Search by song title or singer name..."
            placeholderTextColor={theme.colors.textTertiary}
            value={searchQuery}
            onChangeText={handleSearchQueryChange}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery ? (
            <TouchableOpacity
              onPress={() => {
                setSearchQuery('');
                setSearchResults([]);
                setSearching(false);
              }}
              style={styles.clearButton}
              accessibilityLabel="Clear search"
            >
              <Icon name="close" size={14} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.headerRow}>
          <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
            {searchQuery.trim()
              ? `${activeTotalCount} ${activeTotalCount === 1 ? 'song' : 'songs'} matching "${searchQuery}"`
              : `${activeTotalCount} ${activeTotalCount === 1 ? 'song' : 'songs'}`}
          </Text>
          <GlassButton
            variant="primary"
            size="icon"
            icon="play"
            iconSize={16}
            iconColor="#000000"
            onPress={() => activeSongs.length > 0 && handlePlay(0)}
            accessibilityLabel="Play all songs"
          />
        </View>
      </View>

      <FlatList
        data={activeSongs}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <SongRow
            song={item}
            index={index + 1}
            isCurrent={currentTrack?.id === item.id}
            isPlaying={isPlaying}
            onPress={() => (selectionMode ? toggleSelect(item.id) : handlePlay(index))}
            onToggleLike={handleToggleLike}
            selectionMode={selectionMode}
            isSelected={selectedIds.has(item.id)}
            onToggleSelect={() => toggleSelect(item.id)}
            onLongPress={() => handleLongPress(item.id)}
          />
        )}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        getItemLayout={(_, index) => ({ length: 60, offset: 60 * index, index })}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>
            {searchQuery.trim() ? `No matching songs or singers found for "${searchQuery}"` : 'No songs uploaded yet'}
          </Text>
        }
        ListFooterComponent={
          searching ? (
            <ActivityIndicator color={theme.colors.primary} style={styles.footer} />
          ) : loadingMore ? (
            <ActivityIndicator color={theme.colors.primary} style={styles.footer} />
          ) : !hasMore && !searchQuery.trim() && songs.length > 0 ? (
            <Text style={[styles.footerText, { color: theme.colors.textTertiary }]}>You're all caught up</Text>
          ) : null
        }
        contentContainerStyle={[styles.listContent, selectionMode ? { paddingBottom: 140 } : null]}
      />

      {selectionMode && (
        <SongBulkActionBar
          selectedCount={selectedIds.size}
          totalCount={activeSongs.length}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onClose={deselectAll}
          onAddToPlaylist={() => setBulkAddModalVisible(true)}
          onDelete={handleBulkDelete}
          deleteLabel={isAdmin ? 'Delete' : 'Remove'}
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
  header: {
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingBottom: 8,
  },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, marginTop: 2 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    height: 42,
    padding: 0,
  },
  clearButton: {
    padding: 4,
  },
  playAllButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1DB954',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  listContent: { paddingBottom: 120 },
  empty: { fontSize: 14, padding: 40, textAlign: 'center' },
  footer: { paddingVertical: 16 },
  footerText: { textAlign: 'center', paddingVertical: 16, fontSize: 12 },
  centerError: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorTitle: { fontSize: 18, fontWeight: '700', marginTop: 12 },
  errorSub: { fontSize: 13, textAlign: 'center', marginTop: 6, maxWidth: 280, lineHeight: 18 },
  retryBtn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  retryBtnText: { color: '#000000', fontSize: 13, fontWeight: '700' },
});

export default AllSongsScreen;
