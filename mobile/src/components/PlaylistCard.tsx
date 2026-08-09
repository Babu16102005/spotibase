import React from 'react';
import { Text, TouchableOpacity, Image, StyleSheet, Dimensions } from 'react-native';
import { PlaylistResponse } from '../types';
import { useThemeStore } from '../store';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

interface PlaylistCardProps {
  playlist: PlaylistResponse;
  onPress: () => void;
}

const PlaylistCard: React.FC<PlaylistCardProps> = ({ playlist, onPress }) => {
  const { theme } = useThemeStore();

  return (
    <TouchableOpacity style={[styles.container]} onPress={onPress} activeOpacity={0.8}>
      <Image source={{ uri: playlist.coverUrl || 'https://via.placeholder.com/160' }} style={styles.cover} />
      <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>{playlist.name}</Text>
      <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
        {playlist.songCount} songs {playlist.isPublic ? '\u2022 Public' : '\u2022 Private'}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { width: CARD_WIDTH, marginBottom: 16, marginHorizontal: 4 },
  cover: { width: CARD_WIDTH, height: CARD_WIDTH, borderRadius: 8 },
  title: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  subtitle: { fontSize: 11, marginTop: 2 },
});

export default PlaylistCard;
