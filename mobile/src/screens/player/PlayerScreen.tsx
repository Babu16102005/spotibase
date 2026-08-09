import React from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Dimensions, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import { usePlayerStore, useThemeStore } from '../../store';
import { formatDuration } from '../../utils';

const { width } = Dimensions.get('window');

const PlayerScreen = ({ navigation }: any) => {
  const { currentTrack, playbackState, position, duration, shuffle, repeat,
          togglePlayPause, next, previous, seekTo, setShuffle, setRepeat } = usePlayerStore();
  const { theme } = useThemeStore();
  const isPlaying = playbackState === 'playing';
  const progress = duration > 0 ? position / duration : 0;

  if (!currentTrack) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={[styles.noTrack, { color: theme.colors.textSecondary }]}>No track selected</Text>
      </View>
    );
  }

  // Get contributing artists for display
  const featuringArtists = currentTrack.contributingArtists?.filter(ca => ca.role === 'FEATURING') || [];
  const featuringNames = featuringArtists.map(ca => ca.artistName).join(', ');
  const otherContributors = currentTrack.contributingArtists?.filter(ca => ca.role !== 'PRIMARY' && ca.role !== 'FEATURING') || [];

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <TouchableOpacity style={styles.closeButton} onPress={() => navigation?.goBack()}>
        <Text style={[styles.closeText, { color: theme.colors.text }]}>▼</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content}>
        <Image
          source={{ uri: currentTrack.coverUrl || 'https://via.placeholder.com/300' }}
          style={[styles.cover, { borderColor: theme.colors.border }]}
        />

        <View style={styles.info}>
          <Text style={[styles.title, { color: theme.colors.text }]}>{currentTrack.title}</Text>
          <Text style={[styles.artist, { color: theme.colors.textSecondary }]}>
            {currentTrack.artistName}
            {featuringNames ? ` (feat. ${featuringNames})` : ''}
          </Text>
          {currentTrack.albumName && (
            <Text style={[styles.album, { color: theme.colors.textTertiary }]}>{currentTrack.albumName}</Text>
          )}
          {currentTrack.albumArtistName && currentTrack.albumArtistName !== currentTrack.artistName && (
            <Text style={[styles.albumArtist, { color: theme.colors.textTertiary }]}>
              Album: {currentTrack.albumArtistName}
            </Text>
          )}
          {otherContributors.length > 0 && (
            <Text style={[styles.contribLine, { color: theme.colors.textTertiary }]} numberOfLines={2}>
              {otherContributors.map(ca => `${ca.role.charAt(0) + ca.role.slice(1).toLowerCase()}: ${ca.artistName}`).join(' • ')}
            </Text>
          )}
        </View>

        <View style={styles.progressContainer}>
          <Slider
            style={styles.slider}
            value={position}
            minimumValue={0}
            maximumValue={Math.max(duration, 1)}
            minimumTrackTintColor={theme.colors.primary}
            maximumTrackTintColor={theme.colors.surfaceLight}
            thumbTintColor={theme.colors.primary}
            onSlidingComplete={seekTo}
          />
          <View style={styles.timeRow}>
            <Text style={[styles.time, { color: theme.colors.textTertiary }]}>{formatDuration(position * 1000)}</Text>
            <Text style={[styles.time, { color: theme.colors.textTertiary }]}>{formatDuration(duration * 1000)}</Text>
          </View>
        </View>

        <View style={styles.controls}>
          <View style={styles.secondaryControls}>
            <TouchableOpacity onPress={() => setShuffle(!shuffle)}>
              <Text style={[styles.controlIcon, { color: shuffle ? theme.colors.primary : theme.colors.textSecondary }]}>🔀</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.mainControls}>
            <TouchableOpacity onPress={previous}>
              <Text style={[styles.mainControlIcon, { color: theme.colors.text }]}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.playButton, { backgroundColor: theme.colors.primary }]} onPress={togglePlayPause}>
              <Text style={[styles.playIcon, { color: '#000' }]}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={next}>
              <Text style={[styles.mainControlIcon, { color: theme.colors.text }]}>⏭</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.secondaryControls}>
            <TouchableOpacity onPress={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}>
              <Text style={[styles.controlIcon, { color: repeat !== 'off' ? theme.colors.primary : theme.colors.textSecondary }]}>
                {repeat === 'one' ? '🔂' : '🔁'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {currentTrack.lyrics && (
          <View style={[styles.lyricsContainer, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.lyricsTitle, { color: theme.colors.textSecondary }]}>Lyrics</Text>
            <Text style={[styles.lyrics, { color: theme.colors.text }]}>{currentTrack.lyrics}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  closeButton: { padding: 16, alignSelf: 'flex-start' },
  closeText: { fontSize: 24 },
  noTrack: { fontSize: 16 },
  content: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 48 },
  cover: { width: width - 64, height: width - 64, borderRadius: 16, marginTop: 20, borderWidth: 1 },
  info: { alignItems: 'center', marginTop: 24 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  artist: { fontSize: 16, marginTop: 4 },
  album: { fontSize: 13, marginTop: 2 },
  albumArtist: { fontSize: 12, marginTop: 2, fontStyle: 'italic' },
  contribLine: { fontSize: 12, marginTop: 4, textAlign: 'center', paddingHorizontal: 16 },
  progressContainer: { width: '100%', marginTop: 24 },
  slider: { width: '100%', height: 40 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -8 },
  time: { fontSize: 11 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 16 },
  secondaryControls: { width: 60, alignItems: 'center' },
  mainControls: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  controlIcon: { fontSize: 20 },
  mainControlIcon: { fontSize: 28 },
  playButton: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center' },
  playIcon: { fontSize: 28, marginLeft: 2 },
  lyricsContainer: { width: '100%', borderRadius: 12, padding: 16, marginTop: 24 },
  lyricsTitle: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  lyrics: { fontSize: 14, lineHeight: 22 },
});

export default PlayerScreen;