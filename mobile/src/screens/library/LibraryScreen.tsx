import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { libraryApi } from '../../api/client';
import { useThemeStore } from '../../store';
import { LibraryResponse } from '../../types';
import PlaylistCard from '../../components/PlaylistCard';
import AlbumCard from '../../components/AlbumCard';
import ArtistCard from '../../components/ArtistCard';
import SongCard from '../../components/SongCard';
import { CardSkeleton } from '../../components/SkeletonLoader';
import DownloadsScreen from './DownloadsScreen';

const LibraryScreen = ({ navigation }: any) => {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'playlists' | 'albums' | 'artists' | 'songs' | 'downloads'>('playlists');
  const [loading, setLoading] = useState(true);
  const { theme } = useThemeStore();

  useEffect(() => {
    libraryApi.getLibrary().then(r => { setData(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const tabs = [
    { key: 'playlists', label: 'Playlists' },
    { key: 'albums', label: 'Albums' },
    { key: 'artists', label: 'Artists' },
    { key: 'songs', label: 'Liked Songs' },
    { key: 'downloads', label: 'Downloads' },
  ] as const;

  const renderContent = () => {
    if (loading) return <CardSkeleton count={6} />;
    if (!data) return <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>Nothing in your library yet</Text>;

    switch (activeTab) {
      case 'playlists':
        return (
          <View style={styles.grid}>
            {data.playlists?.map(p => (
              <PlaylistCard key={p.id} playlist={p} onPress={() => navigation?.navigate('Playlist', { id: p.id })} />
            ))}
            {data.playlists?.length === 0 && <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>No playlists yet</Text>}
          </View>
        );
      case 'albums':
        return (
          <View style={styles.grid}>
            {data.albums?.map(a => (
              <AlbumCard key={a.id} album={a} onPress={() => navigation?.navigate('Album', { id: a.id })} />
            ))}
            {data.albums?.length === 0 && <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>No liked albums</Text>}
          </View>
        );
      case 'artists':
        return (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.artistRow}>
            {data.artists?.map(a => (
              <ArtistCard key={a.id} artist={a} onPress={() => navigation?.navigate('Artist', { id: a.id })} />
            ))}
            {data.artists?.length === 0 && <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>No followed artists</Text>}
          </ScrollView>
        );
      case 'songs':
        return (
          <View>
            {data.likedSongs?.map(s => (
              <SongCard key={s.id} song={s} />
            ))}
            {data.likedSongs?.length === 0 && <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>No liked songs</Text>}
          </View>
        );
      case 'downloads':
        return <DownloadsScreen navigation={navigation} />;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={[styles.title, { color: theme.colors.text }]}>Your Library</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, { backgroundColor: activeTab === tab.key ? theme.colors.primary : theme.colors.surface }]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, { color: activeTab === tab.key ? '#000' : theme.colors.text }]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={styles.content}>
        {renderContent()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 28, fontWeight: '800', paddingHorizontal: 16, paddingTop: 48, paddingBottom: 8 },
  tabRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 },
  tab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8 },
  tabText: { fontSize: 13, fontWeight: '600' },
  content: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  artistRow: { paddingHorizontal: 16, paddingVertical: 8 },
  empty: { fontSize: 14, padding: 32, textAlign: 'center' },
});

export default LibraryScreen;
