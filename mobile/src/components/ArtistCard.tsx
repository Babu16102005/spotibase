import React from 'react';
import { Text, TouchableOpacity, Image, StyleSheet, Dimensions } from 'react-native';
import { ArtistResponse } from '../types';
import { useThemeStore } from '../store';
import { formatCount } from '../utils';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 64) / 2.5;

interface ArtistCardProps {
  artist: ArtistResponse;
  onPress: () => void;
}

const ArtistCard: React.FC<ArtistCardProps> = ({ artist, onPress }) => {
  const { theme } = useThemeStore();

  return (
    <TouchableOpacity style={[styles.container]} onPress={onPress} activeOpacity={0.8}>
      <Image
        source={{ uri: artist.imageUrl || 'https://via.placeholder.com/120' }}
        style={[styles.image, { borderColor: theme.colors.border }]}
      />
      <Text style={[styles.name, { color: theme.colors.text }]} numberOfLines={1}>{artist.name}</Text>
      <Text style={[styles.listeners, { color: theme.colors.textSecondary }]}>
        {formatCount(artist.monthlyListeners)} monthly listeners
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { width: CARD_WIDTH, marginRight: 12, alignItems: 'center' },
  image: { width: CARD_WIDTH, height: CARD_WIDTH, borderRadius: CARD_WIDTH / 2, borderWidth: 1 },
  name: { fontSize: 13, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  listeners: { fontSize: 11, marginTop: 2, textAlign: 'center' },
});

export default ArtistCard;
