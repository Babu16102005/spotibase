import React, { useEffect, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { artistApi } from '../../api/client';
import { useThemeStore } from '../../store';
import { ArtistResponse, SongResponse, AlbumResponse } from '../../types';
import SongCard from '../../components/SongCard';
import AlbumCard from '../../components/AlbumCard';
import { formatCount } from '../../utils';

const ArtistScreen = ({ route, navigation }: any) => {
  const [artist, setArtist] = useState<ArtistResponse | null>(null);
  const { id } = route.params;
  const { theme } = useThemeStore();

  useEffect(() => {
    artistApi.getById(id).then(r => setArtist(r.data)).catch(() => navigation?.goBack());
  }, [id]);

  if (!artist) return <View style={[styles.container, { backgroundColor: theme.colors.background }]} />;

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={styles.header}>
        <Image source={{ uri: artist.imageUrl || 'https://via.placeholder.com/200' }} style={[styles.image, { borderColor: theme.colors.border }]} />
        <Text style={[styles.name, { color: theme.colors.text }]}>{artist.name}</Text>
        <Text style={[styles.listeners, { color: theme.colors.textSecondary }]}>
          {formatCount(artist.monthlyListeners)} monthly listeners
        </Text>
        {artist.verified && <Text style={[styles.verified, { color: theme.colors.primary }]}>✓ Verified Artist</Text>}
        {artist.bio && <Text style={[styles.bio, { color: theme.colors.textSecondary }]}>{artist.bio}</Text>}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { alignItems: 'center', padding: 24 },
  image: { width: 200, height: 200, borderRadius: 100, borderWidth: 2 },
  name: { fontSize: 28, fontWeight: '700', marginTop: 16 },
  listeners: { fontSize: 14, marginTop: 4 },
  verified: { fontSize: 13, marginTop: 4, fontWeight: '600' },
  bio: { fontSize: 13, marginTop: 12, textAlign: 'center', lineHeight: 20 },
});

export default ArtistScreen;
