import React, { useEffect, useState } from 'react';
import { View, Text, Image, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { playlistApi } from '../../api/client';
import { usePlayerStore, useThemeStore, useAuthStore } from '../../store';
import { PlaylistResponse } from '../../types';
import SongCard from '../../components/SongCard';
import { formatDuration, formatCount } from '../../utils';

const PlaylistScreen = ({ route, navigation }: any) => {
  const [playlist, setPlaylist] = useState<PlaylistResponse | null>(null);
  const { id } = route.params;
  const { playMultiple } = usePlayerStore();
  const { theme } = useThemeStore();
  const user = useAuthStore(s => s.user);

  useEffect(() => {
    playlistApi.getById(id).then(r => setPlaylist(r.data)).catch(() => navigation?.goBack());
  }, [id]);

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

  if (!playlist) return <View style={[styles.container, { backgroundColor: theme.colors.background }]} />;

  const isOwner = user?.id === playlist.userId;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        ListHeaderComponent={() => (
          <View style={styles.header}>
            <Image source={{ uri: playlist.coverUrl || 'https://via.placeholder.com/200' }} style={[styles.cover, { borderColor: theme.colors.border }]} />
            <Text style={[styles.title, { color: theme.colors.text }]}>{playlist.name}</Text>
            <Text style={[styles.owner, { color: theme.colors.textSecondary }]}>
              {playlist.username} • {playlist.songCount} songs
            </Text>
            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.playButton, { backgroundColor: theme.colors.primary }]} onPress={playAll}>
                <Text style={[styles.playButtonText, { color: '#000' }]}>▶ Play</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.likeButton} onPress={toggleLike}>
                <Text style={{ fontSize: 20, color: playlist.liked ? theme.colors.primary : theme.colors.textSecondary }}>
                  {playlist.liked ? '❤️' : '🤍'}
                </Text>
              </TouchableOpacity>
            </View>
            {playlist.description && (
              <Text style={[styles.description, { color: theme.colors.textTertiary }]}>{playlist.description}</Text>
            )}
            {isOwner && (
              <TouchableOpacity style={[styles.editButton, { borderColor: theme.colors.border }]}>
                <Text style={[styles.editText, { color: theme.colors.text }]}>Edit Playlist</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        data={playlist.songs}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <SongCard song={item} index={index} showAlbum={true} />
        )}
        contentContainerStyle={{ paddingBottom: 100 }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
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
