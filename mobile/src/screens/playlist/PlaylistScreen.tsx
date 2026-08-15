import React, { useEffect, useState } from 'react';
import { View, Text, Image, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { playlistApi } from '../../api/client';
import { usePlayerStore, useThemeStore, useAuthStore } from '../../store';
import { PlaylistResponse } from '../../types';
import SongCard from '../../components/SongCard';
import Icon from '../../components/Icon';
import GlassButton from '../../components/GlassButton';
import BulkAddToPlaylistModal from '../../components/BulkAddToPlaylistModal';
import SongBulkActionBar from '../../components/SongBulkActionBar';
import { formatDuration, formatCount, coverSource } from '../../utils';
import { DetailPageSkeleton } from '../../components/SkeletonLoader';

const PlaylistScreen = ({ route, navigation }: any) => {
  const [playlist, setPlaylist] = useState<PlaylistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const { id } = route.params;
  const { playMultiple } = usePlayerStore();
  const { theme } = useThemeStore();
  const user = useAuthStore(s => s.user);

  // Multi-selection states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAddModalVisible, setBulkAddModalVisible] = useState(false);
  const selectionMode = selectedIds.size > 0;

  const toggleSelect = (songId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });
  };

  const selectAll = () => {
    if (!playlist?.songs) return;
    setSelectedIds(new Set(playlist.songs.map((s) => s.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDelete = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    Alert.alert(
      'Remove Songs',
      `Remove ${count} selected ${count === 1 ? 'song' : 'songs'} from this playlist?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const idsToRemove = Array.from(selectedIds);
            for (const songId of idsToRemove) {
              try {
                await playlistApi.removeSong(id, songId);
              } catch (e) {}
            }
            setPlaylist((prev) =>
              prev
                ? {
                    ...prev,
                    songs: prev.songs?.filter((s) => !selectedIds.has(s.id)) || [],
                    songCount: Math.max(0, (prev.songCount || 0) - idsToRemove.length),
                  }
                : prev
            );
            setSelectedIds(new Set());
          },
        },
      ]
    );
  };

  useEffect(() => {
    setLoading(true);
    setError(false);
    playlistApi.getById(id)
      .then(r => {
        setPlaylist(r.data);
        setError(false);
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  const handleBack = () => {
    if (navigation?.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation?.navigate('Home');
    }
  };

  const playAll = () => {
    if (playlist?.songs) playMultiple(playlist.songs, 0);
  };

  const toggleLike = async () => {
    try {
      if (playlist?.liked) {
        await playlistApi.unlike(id);
        setPlaylist(prev => prev ? { ...prev, liked: false, likeCount: prev.likeCount - 1 } : prev);
      } else {
        await playlistApi.like(id);
        setPlaylist(prev => prev ? { ...prev, liked: true, likeCount: prev.likeCount + 1 } : prev);
      }
    } catch (err) { console.error(err); }
  };

  if (error || (!playlist && !loading)) {
    return (
      <View style={[styles.container, styles.centerContent, { backgroundColor: theme.colors.background }]}>
        <Icon name="music" size={40} color={theme.colors.textTertiary} />
        <Text style={[styles.errorTitle, { color: theme.colors.text }]}>Playlist Unavailable</Text>
        <Text style={[styles.errorSub, { color: theme.colors.textSecondary }]}>
          Unable to load this playlist. Check network connection or return to Home.
        </Text>
        <GlassButton
          variant="primary"
          size="md"
          title="Back to Safety"
          onPress={handleBack}
          style={{ marginTop: 16 }}
        />
      </View>
    );
  }

  if (loading || !playlist) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <DetailPageSkeleton />
      </View>
    );
  }

  const isOwner = user?.id === playlist.userId;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        ListHeaderComponent={() => (
          <View style={styles.header}>
            <Image source={coverSource(playlist.coverUrl)} style={[styles.cover, { borderColor: theme.colors.border }]} />
            <Text style={[styles.title, { color: theme.colors.text }]}>{playlist.name}</Text>
            <Text style={[styles.owner, { color: theme.colors.textSecondary }]}>
              {playlist.username} • {playlist.songCount} songs
            </Text>
            <View style={styles.actionRow}>
              <GlassButton
                variant="primary"
                size="lg"
                icon="play"
                iconSize={16}
                iconColor="#000000"
                title="Play All"
                onPress={playAll}
              />
              <GlassButton
                variant="secondary"
                size="icon"
                icon={playlist.liked ? 'heartFilled' : 'heart'}
                iconSize={18}
                iconColor={playlist.liked ? theme.colors.primary : theme.colors.textSecondary}
                onPress={toggleLike}
                accessibilityLabel={playlist.liked ? 'Unlike playlist' : 'Like playlist'}
              />
            </View>
            {playlist.description && (
              <Text style={[styles.description, { color: theme.colors.textTertiary }]}>{playlist.description}</Text>
            )}
            {isOwner && (
              <GlassButton
                variant="secondary"
                size="sm"
                title="Edit Playlist"
                style={{ marginTop: 12 }}
              />
            )}
          </View>
        )}
        data={playlist.songs}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <SongCard
            song={item}
            index={index}
            showAlbum={true}
            onPress={() => (selectionMode ? toggleSelect(item.id) : (playlist.songs && playMultiple(playlist.songs, index)))}
            selectionMode={selectionMode}
            isSelected={selectedIds.has(item.id)}
            onToggleSelect={() => toggleSelect(item.id)}
            onLongPress={() => toggleSelect(item.id)}
          />
        )}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews={true}
        contentContainerStyle={{ paddingBottom: selectionMode ? 140 : 100 }}
      />

      {selectionMode && (
        <SongBulkActionBar
          selectedCount={selectedIds.size}
          totalCount={playlist.songs?.length || 0}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onClose={deselectAll}
          onAddToPlaylist={() => setBulkAddModalVisible(true)}
          onDelete={handleBulkDelete}
          deleteLabel={isOwner ? 'Remove' : 'Delete'}
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
  centerContent: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorTitle: { fontSize: 20, fontWeight: '700', marginTop: 16 },
  errorSub: { fontSize: 14, textAlign: 'center', marginTop: 8, maxWidth: 300, lineHeight: 20 },
  navBackBtn: { marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  navBackBtnText: { color: '#000000', fontSize: 14, fontWeight: '700' },
  header: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 },
  cover: { width: 200, height: 200, borderRadius: 12, borderWidth: 1 },
  title: { fontSize: 22, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  owner: { fontSize: 14, marginTop: 4 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 20 },
  playButton: { paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24 },
  playButtonText: { fontSize: 16, fontWeight: '700' },
  likeButton: { padding: 8 },
  description: { fontSize: 13, marginTop: 12, textAlign: 'center', lineHeight: 18 },
  editButton: { marginTop: 16, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
  editText: { fontSize: 14, fontWeight: '500' },
});

export default PlaylistScreen;
