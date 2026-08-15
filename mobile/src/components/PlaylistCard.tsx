import React, { useState } from 'react';
import { Text, TouchableOpacity, Image, StyleSheet, Dimensions, Platform } from 'react-native';
import { PlaylistResponse } from '../types';
import { useThemeStore } from '../store';
import { coverSource } from '../utils';
import Icon from './Icon';

const { width } = Dimensions.get('window');
const CARD_WIDTH = Math.min((width - 48) / 2, 200);

interface PlaylistCardProps {
  playlist: PlaylistResponse;
  onPress: () => void;
}

const PlaylistCard: React.FC<PlaylistCardProps> = ({ playlist, onPress }) => {
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
      <Image source={coverSource(playlist.coverUrl)} style={styles.cover} />
      <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>{playlist.name}</Text>
      <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>
        {playlist.songCount} songs {playlist.isPublic ? '\u2022 Public' : '\u2022 Private'}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    marginBottom: 16,
    marginHorizontal: 4,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    ...(Platform.OS === 'web' ? {
      transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
    } : {}),
  },
  cover: { width: CARD_WIDTH - 20, height: CARD_WIDTH - 20, borderRadius: 10 },
  title: { fontSize: 13, fontWeight: '700', marginTop: 8 },
  subtitle: { fontSize: 12, marginTop: 2 },
});

export default PlaylistCard;