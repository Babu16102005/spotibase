import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { homeApi } from '../../api/client';
import { useThemeStore } from '../../store';
import { HomeSection, SongResponse, AlbumResponse, ArtistResponse, PlaylistResponse } from '../../types';
import SongCard from '../../components/SongCard';
import AlbumCard from '../../components/AlbumCard';
import ArtistCard from '../../components/ArtistCard';
import PlaylistCard from '../../components/PlaylistCard';
import SectionHeader from '../../components/SectionHeader';
import { CardSkeleton, SongSkeleton } from '../../components/SkeletonLoader';
import { getGreeting } from '../../utils';

const HomeScreen = ({ navigation }: any) => {
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const { theme } = useThemeStore();

  const fetchHome = useCallback(async () => {
    try {
      const res = await homeApi.getHome();
      setData({ ...res.data, greeting: getGreeting() });
    } catch (err) {
      console.error('Failed to fetch home:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchHome(); }, [fetchHome]);

  const onRefresh = () => { setRefreshing(true); fetchHome(); };

  const renderSection = (section: HomeSection) => {
    switch (section.type) {
      case 'SONG':
        return (
          <View key={section.id}>
            <SectionHeader title={section.title} subtitle={section.subtitle} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {(section.items as SongResponse[]).slice(0, 10).map((item, i) => (
                <View key={item.id || i} style={{ width: 160, marginRight: 8 }}>
                  <SongCard song={item} />
                </View>
              ))}
            </ScrollView>
          </View>
        );
      case 'ALBUM':
        return (
          <View key={section.id}>
            <SectionHeader title={section.title} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {(section.items as AlbumResponse[]).slice(0, 10).map((item) => (
                <AlbumCard key={item.id} album={item} onPress={() => navigation?.navigate('Album', { id: item.id })} />
              ))}
            </ScrollView>
          </View>
        );
      case 'ARTIST':
        return (
          <View key={section.id}>
            <SectionHeader title={section.title} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {(section.items as ArtistResponse[]).slice(0, 10).map((item) => (
                <ArtistCard key={item.id} artist={item} onPress={() => navigation?.navigate('Artist', { id: item.id })} />
              ))}
            </ScrollView>
          </View>
        );
      case 'PLAYLIST':
        return (
          <View key={section.id}>
            <SectionHeader title={section.title} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {(section.items as PlaylistResponse[]).slice(0, 10).map((item) => (
                <PlaylistCard key={item.id} playlist={item} onPress={() => navigation?.navigate('Playlist', { id: item.id })} />
              ))}
            </ScrollView>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
    >
      <Text style={[styles.greeting, { color: theme.colors.text }]}>
        {data?.greeting || getGreeting()}
      </Text>

      {loading ? (
        <View>
          <CardSkeleton count={5} />
          <SongSkeleton />
          <CardSkeleton count={3} />
        </View>
      ) : (
        data?.sections?.map(renderSection)
      )}
      <View style={{ height: 100 }} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  greeting: { fontSize: 28, fontWeight: '800', paddingHorizontal: 16, paddingTop: 48, paddingBottom: 16 },
  horizontalScroll: { paddingHorizontal: 16, paddingBottom: 8 },
});

export default HomeScreen;
