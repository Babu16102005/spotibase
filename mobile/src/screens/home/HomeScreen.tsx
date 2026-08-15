import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { homeApi } from '../../api/client';
import { useThemeStore, usePlayerStore } from '../../store';
import { HomeSection, SongResponse, AlbumResponse, ArtistResponse, PlaylistResponse } from '../../types';
import SongCard from '../../components/SongCard';
import AlbumCard from '../../components/AlbumCard';
import ArtistCard from '../../components/ArtistCard';
import PlaylistCard from '../../components/PlaylistCard';
import SectionHeader from '../../components/SectionHeader';
import { CardSkeleton, SongSkeleton } from '../../components/SkeletonLoader';
import { getGreeting, getStorage } from '../../utils';
import Icon from '../../components/Icon';
import GreetingHeader from '../../components/GreetingHeader';

const PILLS = [
  { label: 'Songs', icon: 'songs' as const },
  { label: 'Albums', icon: 'library' as const },
  { label: 'Playlists', icon: 'music' as const },
];

const homeCache = getStorage('spotibase-cache');

const HomeScreen = ({ navigation }: any) => {
  const [data, setData] = useState<any>(() => {
    try {
      const cached = homeCache.getString('homeData');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(() => !data);
  const { theme } = useThemeStore();
  const playMultiple = usePlayerStore((s) => s.playMultiple);

  const fetchHome = useCallback(async () => {
    try {
      const res = await homeApi.getHome();
      const nextData = { ...res.data, greeting: getGreeting() };
      setData(nextData);
      try {
        homeCache.set('homeData', JSON.stringify(nextData));
      } catch {}
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
    if (!section.items || section.items.length === 0) return null;

    switch (section.type) {
      case 'SONG':
        return (
          <View key={section.id}>
            <SectionHeader title={section.title} subtitle={section.subtitle} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {(section.items as SongResponse[]).slice(0, 10).map((item, i) => (
                <View key={item.id || i} style={{ width: 160, marginRight: 12 }}>
                  <SongCard
                    song={item}
                    compact
                    onPress={() => playMultiple(section.items as SongResponse[], i)}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        );
      case 'ALBUM':
        return (
          <View key={section.id}>
            <SectionHeader title={section.title} subtitle={section.subtitle} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {(section.items as AlbumResponse[]).slice(0, 10).map((item) => (
                <AlbumCard key={item.id} album={item} onPress={() => navigation?.navigate('Album', { id: item.id })} />
              ))}
            </ScrollView>
          </View>
        );
      case 'ARTIST':
        return null;
      case 'PLAYLIST':
        return (
          <View key={section.id}>
            <SectionHeader title={section.title} subtitle={section.subtitle} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {(section.items as PlaylistResponse[]).slice(0, 10).map((item) => (
                <PlaylistCard key={item.id} playlist={item} onPress={() => navigation?.navigate('Playlist', { id: item.id })} />
              ))}
            </ScrollView>
          </View>
        );
      case 'GENRE':
        return (
          <View key={section.id}>
            <SectionHeader title={section.title} subtitle={section.subtitle} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
              {(section.items as any[]).slice(0, 10).map((item, i) => (
                <TouchableOpacity
                  key={item.id || i}
                  style={[styles.genreCard, { backgroundColor: item.color || theme.colors.surface }]}
                  onPress={() => navigation?.navigate('Songs')}
                >
                  <Text style={styles.genreName}>{item.name}</Text>
                </TouchableOpacity>
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
      <GreetingHeader
        greetingText={data?.greeting}
        loading={loading}
        onPillPress={(pillLabel) => {
          if (pillLabel === 'Liked Songs') {
            navigation?.navigate('Library');
          } else {
            navigation?.navigate('Songs');
          }
        }}
      />

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
  hero: {
    paddingTop: Platform.OS === 'web' ? 24 : 48,
    paddingBottom: 20,
    borderRadius: 0,
  },
  greeting: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  pillScroll: {
    marginTop: 0,
  },
  pillRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  horizontalScroll: { paddingHorizontal: 16, paddingBottom: 8 },
  genreCard: {
    width: 140,
    height: 80,
    marginRight: 12,
    borderRadius: 12,
    padding: 12,
    justifyContent: 'flex-end',
  },
  genreName: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
});

export default HomeScreen;