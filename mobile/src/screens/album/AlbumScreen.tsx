import React, { useEffect, useState } from 'react';
import { View, Text, Image, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { albumApi } from '../../api/client';
import { usePlayerStore, useThemeStore } from '../../store';
import { AlbumResponse } from '../../types';
import SongCard from '../../components/SongCard';
import Icon from '../../components/Icon';
import GlassButton from '../../components/GlassButton';
import { formatDuration, formatCount, coverSource } from '../../utils';
import { DetailPageSkeleton } from '../../components/SkeletonLoader';

const AlbumScreen = ({ route, navigation }: any) => {
  const [album, setAlbum] = useState<AlbumResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { id } = route.params;
  const { playMultiple } = usePlayerStore();
  const { theme } = useThemeStore();

  useEffect(() => {
    setLoading(true);
    albumApi.getById(id)
      .then(r => setAlbum(r.data))
      .catch(() => {
        if (navigation?.canGoBack?.()) navigation.goBack();
        else navigation?.navigate('Home');
      })
      .finally(() => setLoading(false));
  }, [id]);

  const playAll = () => {
    if (album?.songs) playMultiple(album.songs, 0);
  };

  if (loading || !album) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <DetailPageSkeleton />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        ListHeaderComponent={() => (
          <View style={styles.header}>
            <Image source={coverSource(album.coverUrl)} style={[styles.cover, { borderColor: theme.colors.border }]} />
            <Text style={[styles.title, { color: theme.colors.text }]}>{album.name}</Text>
            <Text style={[styles.artist, { color: theme.colors.textSecondary }]}>{album.artistName}</Text>
            <Text style={[styles.meta, { color: theme.colors.textTertiary }]}>
              {album.releaseDate?.substring(0, 4)} • {album.songCount} songs • {formatDuration(album.totalDurationMs)}
            </Text>
            <GlassButton
              variant="primary"
              size="lg"
              icon="play"
              iconSize={16}
              iconColor="#000000"
              title="Play All"
              onPress={playAll}
              style={{ marginTop: 20 }}
            />
          </View>
        )}
        data={album.songs}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <SongCard
            song={item}
            index={index}
            showAlbum={false}
            onPress={() => album.songs && playMultiple(album.songs, index)}
          />
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
  playButtonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playButtonText: { fontSize: 16, fontWeight: '700' },
});

export default AlbumScreen;
