import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Dimensions } from 'react-native';
import { AlbumResponse } from '../types';
import { useThemeStore } from '../store';
import { formatCount } from '../utils';

interface AlbumCardProps {
  album: AlbumResponse;
  onPress: () => void;
  variant?: 'grid' | 'list';
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

const AlbumCard: React.FC<AlbumCardProps> = ({ album, onPress, variant = 'grid' }) => {
  const { theme } = useThemeStore();

  if (variant === 'list') {
    return (
      <TouchableOpacity style={[styles.listContainer, { backgroundColor: 'transparent' }]} onPress={onPress} activeOpacity={0.7}>
        <Image source={{ uri: album.coverUrl || 'https://via.placeholder.com/56' }} style={styles.listCover} />
        <View style={styles.listInfo}>
          <Text style={[styles.listTitle, { color: theme.colors.text }]} numberOfLines={1}>{album.name}</Text>
          <Text style={[styles.listSubtitle, { color: theme.colors.textSecondary }]}>{album.artistName} \u2022 {album.songCount} songs</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={[styles.gridContainer]} onPress={onPress} activeOpacity={0.8}>
      <Image source={{ uri: album.coverUrl || 'https://via.placeholder.com/160' }} style={styles.gridCover} />
      <Text style={[styles.gridTitle, { color: theme.colors.text }]} numberOfLines={1}>{album.name}</Text>
      <Text style={[styles.gridSubtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>{album.artistName}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  gridContainer: { width: CARD_WIDTH, marginBottom: 16, marginHorizontal: 4 },
  gridCover: { width: CARD_WIDTH, height: CARD_WIDTH, borderRadius: 8 },
  gridTitle: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  gridSubtitle: { fontSize: 11, marginTop: 2 },
  listContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  listCover: { width: 56, height: 56, borderRadius: 4 },
  listInfo: { flex: 1, marginLeft: 12 },
  listTitle: { fontSize: 14, fontWeight: '500' },
  listSubtitle: { fontSize: 12, marginTop: 2 },
});

export default AlbumCard;
