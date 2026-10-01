import React, { useCallback } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AlbumResponse,
  HomeSection,
  PlaylistResponse,
  SongResponse,
} from '../../types';
import { usePlayerStore, useThemeStore } from '../../store';
import AlbumCard from '../../components/AlbumCard';
import PlaylistCard from '../../components/PlaylistCard';
import SectionHeader from '../../components/SectionHeader';
import SongCard from '../../components/SongCard';

interface HomeSectionRowProps {
  section: HomeSection;
  navigation?: any;
  onYouTubePress?: () => void;
}

const isRecentlyPlayedSection = (section: HomeSection): boolean => {
  const id = section.id?.toLowerCase() ?? '';
  const title = section.title?.toLowerCase() ?? '';
  return (
    id.includes('recently-played') ||
    id.includes('recently_played') ||
    title.includes('recently played') ||
    title.includes('recently-played')
  );
};

const keyOf = (item: any, index: number): string =>
  (item?.id != null ? String(item.id) : `index-${index}`);

/**
 * One home section: header + virtualized horizontal row (first 10 items).
 * Memoized so a tier update only re-renders the rows it owns — the
 * orderly critical → secondary → heavy paint never re-lays-out settled rows.
 */
const HomeSectionRowComponent: React.FC<HomeSectionRowProps> = ({
  section,
  navigation,
  onYouTubePress,
}) => {
  const { theme } = useThemeStore();
  const playMultiple = usePlayerStore((s) => s.playMultiple);

  const renderSongItem = useCallback(
    ({ item, index }: { item: SongResponse; index: number }) => (
      <View style={{ width: 160, marginRight: 12 }}>
        <SongCard
          song={item}
          compact
          onPress={() =>
            playMultiple(section.items as SongResponse[], index)
          }
        />
      </View>
    ),
    [playMultiple, section.items]
  );

  const renderAlbumItem = useCallback(
    ({ item }: { item: AlbumResponse }) => (
      <AlbumCard
        album={item}
        onPress={() => navigation?.navigate('Album', { id: item.id })}
      />
    ),
    [navigation]
  );

  const renderPlaylistItem = useCallback(
    ({ item }: { item: PlaylistResponse }) => (
      <PlaylistCard
        playlist={item}
        onPress={() => navigation?.navigate('Playlist', { id: item.id })}
      />
    ),
    [navigation]
  );

  const renderGenreItem = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <TouchableOpacity
        key={item?.id ?? index}
        style={[
          styles.genreCard,
          { backgroundColor: item?.color || theme.colors.surface },
        ]}
        onPress={() => navigation?.navigate('Songs')}
        accessibilityRole="button"
        accessibilityLabel={item?.name ?? 'Genre'}
      >
        <Text style={styles.genreName}>{item?.name}</Text>
      </TouchableOpacity>
    ),
    [navigation, theme.colors.surface]
  );

  if (!section?.items || section.items.length === 0) return null;

  const items = section.items.slice(0, 10);
  const recentlyPlayed = isRecentlyPlayedSection(section);

  switch (section.type) {
    case 'SONG':
      return (
        <View>
          <SectionHeader
            title={section.title}
            subtitle={section.subtitle}
            actionLabel={recentlyPlayed ? 'YouTube' : undefined}
            actionVariant={recentlyPlayed ? 'button' : 'link'}
            actionIcon={recentlyPlayed ? 'music' : undefined}
            actionTestID={
              recentlyPlayed ? 'recently-played-youtube-button' : undefined
            }
            onAction={recentlyPlayed ? onYouTubePress : undefined}
          />
          <FlatList
            horizontal
            data={items as SongResponse[]}
            keyExtractor={keyOf}
            renderItem={renderSongItem}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
            accessibilityLabel={section.title}
          />
        </View>
      );
    case 'ALBUM':
      return (
        <View>
          <SectionHeader title={section.title} subtitle={section.subtitle} />
          <FlatList
            horizontal
            data={items as AlbumResponse[]}
            keyExtractor={keyOf}
            renderItem={renderAlbumItem}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
            accessibilityLabel={section.title}
          />
        </View>
      );
    case 'ARTIST':
      // Preserved legacy behavior: home artist sections are not rendered
      // (backend remains the source of truth for section membership).
      return null;
    case 'PLAYLIST':
      return (
        <View>
          <SectionHeader title={section.title} subtitle={section.subtitle} />
          <FlatList
            horizontal
            data={items as PlaylistResponse[]}
            keyExtractor={keyOf}
            renderItem={renderPlaylistItem}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
            accessibilityLabel={section.title}
          />
        </View>
      );
    case 'GENRE':
      return (
        <View>
          <SectionHeader title={section.title} subtitle={section.subtitle} />
          <FlatList
            horizontal
            data={items as any[]}
            keyExtractor={keyOf}
            renderItem={renderGenreItem}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
            accessibilityLabel={section.title}
          />
        </View>
      );
    default:
      return null;
  }
};

export const HomeSectionRow = React.memo(HomeSectionRowComponent);

const styles = StyleSheet.create({
  horizontalList: { paddingHorizontal: 16, paddingBottom: 8 },
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

export default HomeSectionRow;
