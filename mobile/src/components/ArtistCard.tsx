import React, { useState } from 'react';
import { Text, TouchableOpacity, Image, StyleSheet, Dimensions, Platform } from 'react-native';
import { ArtistResponse } from '../types';
import { useThemeStore } from '../store';
import { formatCount, coverSource } from '../utils';

const { width } = Dimensions.get('window');
const CARD_WIDTH = Math.min((width - 64) / 2.5, 180);

interface ArtistCardProps {
  artist: ArtistResponse;
  onPress: () => void;
}

const ArtistCard: React.FC<ArtistCardProps> = ({ artist, onPress }) => {
  const { theme } = useThemeStore();
  const [hovered, setHovered] = useState(false);

  const onHover = Platform.OS === 'web' ? {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  } : {};

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          backgroundColor: hovered ? theme.colors.surfaceLight : 'transparent',
          borderColor: hovered ? theme.colors.border : 'transparent',
          transform: hovered ? [{ scale: 1.04 }] : [{ scale: 1 }],
          boxShadow: hovered 
            ? (theme.dark ? '0 10px 25px -5px rgba(0, 0, 0, 0.4)' : '0 10px 25px -5px rgba(0, 0, 0, 0.08)')
            : 'none',
        } as any
      ]}
      onPress={onPress}
      activeOpacity={0.8}
      {...onHover}
    >
      <Image
        source={coverSource(artist.imageUrl)}
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
  container: {
    width: CARD_WIDTH,
    marginRight: 12,
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    ...(Platform.OS === 'web' ? {
      transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
    } : {}),
  },
  image: { width: CARD_WIDTH - 20, height: CARD_WIDTH - 20, borderRadius: (CARD_WIDTH - 20) / 2, borderWidth: 1 },
  name: { fontSize: 13, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  listeners: { fontSize: 11, marginTop: 2, textAlign: 'center' },
});

export default ArtistCard;