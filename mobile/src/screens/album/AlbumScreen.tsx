import React, { useEffect, useState } from 'react';
import { View, Text, Image, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { albumApi } from '../../api/client';
import { usePlayerStore, useThemeStore } from '../../store';
import { AlbumResponse } from '../../types';
import SongCard from '../../components/SongCard';
import { formatDuration, formatCount } from '../../utils';

const AlbumScreen = ({ route, navigation }: any) => {
  const [album, setAlbum] = useState<AlbumResponse | null>(null);
  const { id } = route.params;
  const { playMultiple } = usePlayerStore();
  const { theme } = useThemeStore();

  useEffect(() => {
    albumApi.getById(id).then(r => setAlbum(r.data)).catch(() => navigation?.goBack());
  }, [id]);

  const playAll = () => {
    if (album?.songs) playMultiple(album.songs, 0);
  };

  if (!album) return <View style={[styles.container, { backgroundColor: theme.colors.background }]} />;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        ListHeaderComponent={() => (
          <View style={styles.header}>
            <Image source={{ uri: album.coverUrl || 'https://via.placeholder.com/200' }} style={[styles.cover, { borderColor: theme.colors.border }]} />
            <Text style={[styles.title, { color: theme.colors.text }]}>{album.name}</Text>
            <Text style={[styles.artist, { color: theme.colors.textSecondary }]}>{album.artistName}</Text>
            <Text style={[styles.meta, { color: theme.colors.textTertiary }]}>
              {album.releaseDate?.substring(0, 4)} • {album.songCount} songs • {formatDuration(album.totalDurationMs)}
            </Text>
            <TouchableOpacity style={[styles.playButton, { backgroundColor: theme.colors.primary }]} onPress={playAll}>
              <Text style={[styles.playButtonText, { color: '#000' }]}>▶ Play All</Text>
            </TouchableOpacity>
          </View>
        )}
        data={album.songs}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <SongCard song={item} index={index} showAlbum={false} />
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
  artist: { fontSize: 16, marginTop: 4 },
  meta: { fontSize: 12, marginTop: 8 },
  playButton: { paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24, marginTop: 20 },
  playButtonText: { fontSize: 16, fontWeight: '700' },
});

export default AlbumScreen;
