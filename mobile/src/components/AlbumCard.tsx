import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Dimensions, Platform } from 'react-native';
import { AlbumResponse } from '../types';
import { useThemeStore } from '../store';
import { coverSource } from '../utils';
import Icon from './Icon';

interface AlbumCardProps {
  album: AlbumResponse;
  onPress: () => void;
  variant?: 'grid' | 'list';
}

const { width } = Dimensions.get('window');
const CARD_WIDTH = Math.min((width - 48) / 2, 200);

const AlbumCard: React.FC<AlbumCardProps> = ({ album, onPress, variant = 'grid' }) => {
  const { theme } = useThemeStore();
  const [hovered, setHovered] = useState(false);

  const onHover = Platform.OS === 'web' ? {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  } : {};

  if (variant === 'list') {
    return (
      <TouchableOpacity style={[styles.listContainer, { backgroundColor: 'transparent' }]} onPress={onPress} activeOpacity={0.7}>
        <Image source={coverSource(album.coverUrl)} style={styles.listCover} />
        <View style={styles.listInfo}>
          <Text style={[styles.listTitle, { color: theme.colors.text }]} numberOfLines={1}>{album.name}</Text>
          <Text style={[styles.listSubtitle, { color: theme.colors.textSecondary }]}>{album.artistName} \u2022 {album.songCount} songs</Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[
        styles.gridContainer,
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
      <View style={styles.artWrap}>
        <Image source={coverSource(album.coverUrl)} style={styles.gridCover} />
        {hovered && (
          <View style={[styles.playOverlay, { backgroundColor: theme.colors.primary }]}>
            <Icon name="play" size={16} color="#000000" />
          </View>
        )}
      </View>
      <Text style={[styles.gridTitle, { color: theme.colors.text }]} numberOfLines={1}>{album.name}</Text>
      <Text style={[styles.gridSubtitle, { color: theme.colors.textSecondary }]} numberOfLines={1}>{album.artistName}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  gridContainer: {
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
  artWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 8,
  },
  gridCover: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  playOverlay: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  gridTitle: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  gridSubtitle: { fontSize: 12, marginTop: 2 },
  listContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  listCover: { width: 56, height: 56, borderRadius: 4 },
  listInfo: { flex: 1, marginLeft: 12 },
  listTitle: { fontSize: 14, fontWeight: '500' },
  listSubtitle: { fontSize: 12, marginTop: 2 },
});

export default AlbumCard;