import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { SongResponse } from '../types';
import { usePlayerStore, useThemeStore } from '../store';
import { formatDuration } from '../utils';

interface SongCardProps {
  song: SongResponse;
  onPress?: () => void;
  showArtist?: boolean;
  showAlbum?: boolean;
  showContributingArtists?: boolean;
  index?: number;
}

const SongCard: React.FC<SongCardProps> = ({ 
  song, 
  onPress, 
  showArtist = true, 
  showAlbum = false, 
  showContributingArtists = false,
  index 
}) => {
  const { play } = usePlayerStore();
  const { theme } = useThemeStore();

  const handlePress = () => {
    if (onPress) onPress();
    else play(song);
  };

  // Get featuring artists for display
  const featuringArtists = song.contributingArtists?.filter(ca => ca.role === 'FEATURING') || [];
  const featuringNames = featuringArtists.map(ca => ca.artistName).join(', ');

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: 'transparent' }]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      {index !== undefined && (
        <Text style={[styles.index, { color: theme.colors.textSecondary }]}>{index + 1}</Text>
      )}
      <Image
        source={{ uri: song.coverUrl || 'https://via.placeholder.com/48' }}
        style={styles.cover}
      />
      <View style={styles.info}>
        <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
          {song.title}
        </Text>
        {showArtist && (
          <Text style={[styles.artist, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {song.artistName}
            {featuringNames ? ` (feat. ${featuringNames})` : ''}
            {showAlbum && song.albumName ? ` \u2022 ${song.albumName}` : ''}
          </Text>
        )}
        {showContributingArtists && song.contributingArtists && song.contributingArtists.length > 0 && (
          <Text style={[styles.contribArtists, { color: theme.colors.textTertiary }]} numberOfLines={1}>
            {song.contributingArtists
              .filter(ca => ca.role !== 'PRIMARY')
              .map(ca => `${ca.role.charAt(0) + ca.role.slice(1).toLowerCase()}: ${ca.artistName}`)
              .join(' • ')}
          </Text>
        )}
      </View>
      <Text style={[styles.duration, { color: theme.colors.textTertiary }]}>
        {formatDuration(song.durationMs)}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  index: {
    width: 24,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: 4,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '500',
  },
  artist: {
    fontSize: 12,
    marginTop: 2,
  },
  contribArtists: {
    fontSize: 11,
    marginTop: 2,
    fontStyle: 'italic',
  },
  duration: {
    fontSize: 12,
  },
});

export default SongCard;