import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Dimensions, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import { usePlayerStore, useThemeStore } from '../../store';
import { songApi } from '../../api/client';
import { formatDuration, coverSource } from '../../utils';
import Icon from '../../components/Icon';
import TimelineLoadingBeam from '../../components/TimelineLoadingBeam';

const { width } = Dimensions.get('window');

const PlayerScreen = ({ navigation }: any) => {
  const { currentTrack, playbackState, position, duration, shuffle, repeat,
          togglePlayPause, next, previous, seekTo, setShuffle, setRepeat } = usePlayerStore();
  const { theme } = useThemeStore();
  const isPlaying = playbackState === 'playing';

  const [liked, setLiked] = useState(currentTrack?.liked ?? false);

  useEffect(() => {
    setLiked(currentTrack?.liked ?? false);
  }, [currentTrack?.id, currentTrack?.liked]);

  const toggleLike = async () => {
    if (!currentTrack) return;
    const nextLiked = !liked;
    setLiked(nextLiked);
    try {
      if (nextLiked) await songApi.like(currentTrack.id);
      else await songApi.unlike(currentTrack.id);
    } catch (err) {
      console.error('Like toggle failed:', err);
      setLiked(!nextLiked);
    }
  };

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

  const artSize = Math.min(width - 64, 420);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation?.goBack()} style={styles.closeButton} accessibilityLabel="Close player">
          <Icon name="chevronDown" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={[styles.topBarLabel, { color: theme.colors.textSecondary }]}>NOW PLAYING</Text>
        </View>
        <View style={styles.closeButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.artWrap, { width: artSize, height: artSize }]}>
          <Image
            source={coverSource(currentTrack.coverUrl)}
            style={[styles.cover, { borderColor: theme.colors.border }]}
          />
        </View>

        <View style={styles.info}>
          <View style={styles.titleRow}>
            <View style={styles.titleGroup}>
              <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
                {currentTrack.title}
              </Text>
              <Text style={[styles.artist, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                {currentTrack.artistName}
                {featuringNames ? ` (feat. ${featuringNames})` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={toggleLike} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityLabel={liked ? 'Unlike song' : 'Like song'}>
              <Icon name={liked ? 'heartFilled' : 'heart'} size={26} color={liked ? theme.colors.primary : theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
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
              {otherContributors.map(ca => `${ca.role.charAt(0) + ca.role.slice(1).toLowerCase()}: ${ca.artistName}`).join(' \u2022 ')}
            </Text>
          )}
        </View>

        <View style={styles.progressContainer}>
          {playbackState === 'loading' ? (
            <View style={styles.loadingSliderWrap}>
              <TimelineLoadingBeam height={4} />
            </View>
          ) : (
            <Slider
              style={styles.slider}
              value={position}
              minimumValue={0}
              maximumValue={Math.max(duration, 1)}
              minimumTrackTintColor="#FFFFFF"
              maximumTrackTintColor="rgba(255, 255, 255, 0.3)"
              thumbTintColor="#FFFFFF"
              onSlidingComplete={seekTo}
              accessibilityLabel="Seek"
            />
          )}
          <View style={styles.timeRow}>
            <Text style={[styles.time, { color: theme.colors.textTertiary }]}>{formatDuration(position * 1000)}</Text>
            <Text style={[styles.time, { color: theme.colors.textTertiary }]}>{formatDuration(duration * 1000)}</Text>
          </View>
        </View>

        <View style={styles.controls}>
          <View style={styles.secondaryControls}>
            <TouchableOpacity onPress={() => setShuffle(!shuffle)} accessibilityLabel="Shuffle">
              <Icon name="shuffle" size={18} color={shuffle ? theme.colors.primary : theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.mainControls}>
            <TouchableOpacity
              onPress={() => previous()}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              activeOpacity={0.6}
              accessibilityLabel="Previous"
              testID="player-previous"
            >
              <Icon name="previous" size={30} color={theme.colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.playButton, { backgroundColor: theme.colors.primary }]}
              onPress={togglePlayPause}
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              testID="player-play-pause"
            >
              <Icon name={isPlaying ? 'pause' : 'play'} size={26} color="#000000" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => next()}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              activeOpacity={0.6}
              accessibilityLabel="Next"
              testID="player-next"
            >
              <Icon name="next" size={30} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.secondaryControls}>
            <TouchableOpacity
              onPress={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}
              accessibilityLabel="Repeat"
            >
              <Icon name={repeat === 'one' ? 'repeatOne' : 'repeat'} size={18} color={repeat !== 'off' ? theme.colors.primary : theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {currentTrack.lyrics && (
          <View style={[styles.lyricsContainer, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.lyricsTitle, { color: theme.colors.textSecondary }]}>LYRICS</Text>
            <Text style={[styles.lyrics, { color: theme.colors.text }]}>{currentTrack.lyrics}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 4,
  },
  closeButton: { padding: 12, width: 48, alignItems: 'center' },
  topBarCenter: { flex: 1, alignItems: 'center' },
  topBarLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  noTrack: { fontSize: 16 },
  content: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 48 },
  artWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  cover: { width: '100%', height: '100%', borderRadius: 12, borderWidth: 1 },
  info: { width: '100%', marginTop: 28 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleGroup: { flex: 1, marginRight: 16 },
  title: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  artist: { fontSize: 15, marginTop: 4, opacity: 0.9 },
  album: { fontSize: 13, marginTop: 6, opacity: 0.8 },
  albumArtist: { fontSize: 12, marginTop: 2, fontStyle: 'italic', opacity: 0.8 },
  contribLine: { fontSize: 12, marginTop: 4, opacity: 0.8 },
  progressContainer: { width: '100%', marginTop: 20 },
  slider: { width: '100%', height: 40 },
  loadingSliderWrap: { width: '100%', height: 40, justifyContent: 'center' },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -8 },
  time: { fontSize: 11, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 12 },
  secondaryControls: { width: 60, alignItems: 'center' },
  mainControls: { flexDirection: 'row', alignItems: 'center', gap: 30 },
  playButton: { width: 68, height: 68, borderRadius: 34, justifyContent: 'center', alignItems: 'center' },
  lyricsContainer: { width: '100%', borderRadius: 12, padding: 16, marginTop: 28 },
  lyricsTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  lyrics: { fontSize: 14, lineHeight: 22 },
});

export default PlayerScreen;