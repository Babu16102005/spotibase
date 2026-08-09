import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { usePlayerStore, useThemeStore } from '../store';

const MiniPlayer: React.FC = () => {
  const { currentTrack, playbackState, position, duration, togglePlayPause } = usePlayerStore();
  const { theme } = useThemeStore();

  if (!currentTrack) return null;

  const isPlaying = playbackState === 'playing';
  const progress = duration > 0 ? position / duration : 0;

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: theme.colors.playerBackground }]}
      activeOpacity={0.9}
    >
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: theme.colors.primary }]} />
      </View>
      <View style={styles.content}>
        <Image
          source={{ uri: currentTrack.coverUrl || 'https://via.placeholder.com/48' }}
          style={styles.cover}
        />
        <View style={styles.info}>
          <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
            {currentTrack.title}
          </Text>
          <Text style={[styles.artist, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {currentTrack.artistName}
          </Text>
        </View>
        <TouchableOpacity onPress={togglePlayPause} style={styles.playButton}>
          <Text style={[styles.playIcon, { color: theme.colors.text }]}>
            {isPlaying ? '\u23F8' : '\u25B6'}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  progressBar: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  progressFill: {
    height: '100%',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    marginRight: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  artist: {
    fontSize: 12,
    marginTop: 2,
  },
  playButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    fontSize: 24,
  },
});

export default MiniPlayer;
