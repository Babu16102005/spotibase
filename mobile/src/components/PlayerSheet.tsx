import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Dimensions,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Slider from '@react-native-community/slider';
import { usePlayerStore, useThemeStore } from '../store';
import { songApi } from '../api/client';
import { formatDuration, coverSource, playerTranslateY, playerScale, playerBorderRadius, playerContentOpacity, playerBackdropOpacity } from '../utils';
import Icon from './Icon';
import GlassButton from './GlassButton';
import TimelineLoadingBeam from './TimelineLoadingBeam';
import SoftAurora from './SoftAurora';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Mini player collapsed position from bottom (tab bar ~60 + mini player ~64 + safe area)
const MINI_PLAYER_BOTTOM_OFFSET = 124;
const COLLAPSED_TRANSLATE_Y = SCREEN_HEIGHT - MINI_PLAYER_BOTTOM_OFFSET;

const EXPAND_SPRING_CONFIG = { damping: 28, stiffness: 220, mass: 0.75 };
const COLLAPSE_SPRING_CONFIG = { damping: 32, stiffness: 260, mass: 0.7 };
const CONTENT_FADE_CONFIG = { duration: 180 };

interface PlayerSheetProps {
  onLayout?: (y: number) => void;
}

const PlayerSheet = ({ onLayout }: PlayerSheetProps) => {
  const {
    currentTrack,
    playbackState,
    position,
    duration,
    shuffle,
    repeat,
    volume,
    isExpanded,
    togglePlayPause,
    next,
    previous,
    seekTo,
    setShuffle,
    setRepeat,
    setVolume,
    collapsePlayer,
    updatePosition,
  } = usePlayerStore();

  const { theme } = useThemeStore();
  const isPlaying = playbackState === 'playing';
  const [liked, setLiked] = React.useState(currentTrack?.liked ?? false);
  const [seekingValue, setSeekingValue] = React.useState<number | null>(null);

  // Local drag offset during collapse swipe
  const dragOffset = useSharedValue(0);
  const sheetRef = useRef<View>(null);

  // Sync shared values with isExpanded state (triggered by store)
  useEffect(() => {
    if (isExpanded) {
      playerTranslateY.value = withSpring(0, EXPAND_SPRING_CONFIG);
      playerScale.value = withSpring(1, EXPAND_SPRING_CONFIG);
      playerBorderRadius.value = withSpring(0, EXPAND_SPRING_CONFIG);
      playerContentOpacity.value = withTiming(1, { duration: 200 });
      playerBackdropOpacity.value = withTiming(0.45, CONTENT_FADE_CONFIG);
    } else {
      playerTranslateY.value = withSpring(SCREEN_HEIGHT, COLLAPSE_SPRING_CONFIG);
      playerScale.value = withSpring(0.95, COLLAPSE_SPRING_CONFIG);
      playerBorderRadius.value = withSpring(20, COLLAPSE_SPRING_CONFIG);
      playerContentOpacity.value = withTiming(0, { duration: 150 });
      playerBackdropOpacity.value = withTiming(0, { duration: 150 });
    }
  }, [isExpanded]);

  // Sync position from store (for mini player progress bar)
  useEffect(() => {
    updatePosition(position, duration);
  }, [position, duration, updatePosition]);

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
    return null;
  }

  // Swipe-down gesture on full player to collapse
  const panGesture = Gesture.Pan()
    .activeOffsetY([0, 8])
    .onUpdate((event) => {
      if (!isExpanded) return;
      dragOffset.value = Math.max(0, event.translationY);
      playerTranslateY.value = dragOffset.value;
      const collapseProgress = Math.min(dragOffset.value / SCREEN_HEIGHT, 1);
      playerContentOpacity.value = 1 - collapseProgress * 0.9;
      playerBackdropOpacity.value = 0.45 * (1 - collapseProgress);
      playerBorderRadius.value = collapseProgress * 20;
      playerScale.value = 1 - collapseProgress * 0.05;
    })
    .onEnd((event) => {
      if (!isExpanded) return;
      const shouldCollapse = dragOffset.value > SCREEN_HEIGHT * 0.28 || event.velocityY > 700;
      if (shouldCollapse) {
        playerTranslateY.value = withSpring(SCREEN_HEIGHT, COLLAPSE_SPRING_CONFIG);
        playerScale.value = withSpring(0.95, COLLAPSE_SPRING_CONFIG);
        playerBorderRadius.value = withSpring(20, COLLAPSE_SPRING_CONFIG);
        playerContentOpacity.value = withTiming(0, { duration: 150 });
        playerBackdropOpacity.value = withTiming(0, { duration: 150 });
        runOnJS(collapsePlayer)();
      } else {
        playerTranslateY.value = withSpring(0, EXPAND_SPRING_CONFIG);
        playerScale.value = withSpring(1, EXPAND_SPRING_CONFIG);
        playerBorderRadius.value = withSpring(0, EXPAND_SPRING_CONFIG);
        playerContentOpacity.value = withTiming(1, { duration: 200 });
        playerBackdropOpacity.value = withTiming(0.45, { duration: 180 });
      }
      dragOffset.value = 0;
    });

  // Dedicated header drag handle gesture (more sensitive)
  const headerPanGesture = Gesture.Pan()
    .activeOffsetY([0, 5])
    .onUpdate((event) => {
      dragOffset.value = Math.max(0, event.translationY);
      playerTranslateY.value = dragOffset.value;
      const collapseProgress = Math.min(dragOffset.value / SCREEN_HEIGHT, 1);
      playerContentOpacity.value = 1 - collapseProgress * 0.9;
      playerBackdropOpacity.value = 0.45 * (1 - collapseProgress);
      playerBorderRadius.value = collapseProgress * 20;
      playerScale.value = 1 - collapseProgress * 0.05;
    })
    .onEnd((event) => {
      const shouldCollapse = dragOffset.value > SCREEN_HEIGHT * 0.22 || event.velocityY > 600;
      if (shouldCollapse) {
        playerTranslateY.value = withSpring(SCREEN_HEIGHT, COLLAPSE_SPRING_CONFIG);
        playerScale.value = withSpring(0.95, COLLAPSE_SPRING_CONFIG);
        playerBorderRadius.value = withSpring(20, COLLAPSE_SPRING_CONFIG);
        playerContentOpacity.value = withTiming(0, { duration: 150 });
        playerBackdropOpacity.value = withTiming(0, { duration: 150 });
        runOnJS(collapsePlayer)();
      } else {
        playerTranslateY.value = withSpring(0, EXPAND_SPRING_CONFIG);
        playerScale.value = withSpring(1, EXPAND_SPRING_CONFIG);
        playerBorderRadius.value = withSpring(0, EXPAND_SPRING_CONFIG);
        playerContentOpacity.value = withTiming(1, { duration: 200 });
        playerBackdropOpacity.value = withTiming(0.45, { duration: 180 });
      }
      dragOffset.value = 0;
    });

  // Animated styles using global mutables
  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: playerTranslateY.value },
      { scale: playerScale.value },
    ],
    borderTopLeftRadius: playerBorderRadius.value,
    borderTopRightRadius: playerBorderRadius.value,
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: playerBackdropOpacity.value,
  }));

  const fullContentStyle = useAnimatedStyle(() => ({
    opacity: playerContentOpacity.value,
  }));

  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = queue.findIndex((t) => t.id === currentTrack.id);
  const nextTrack = currentIndex >= 0 && currentIndex < queue.length - 1 ? queue[currentIndex + 1] : queue.length > 1 ? queue[0] : null;

  const featuringArtists = currentTrack.contributingArtists?.filter(ca => ca.role === 'FEATURING') || [];
  const featuringNames = featuringArtists.map(ca => ca.artistName).join(', ');
  const otherContributors = currentTrack.contributingArtists?.filter(ca => ca.role !== 'PRIMARY' && ca.role !== 'FEATURING') || [];

  const artSize = Math.min(SCREEN_WIDTH - 64, 420);
  const hasCustomThumbnail = Boolean(
    currentTrack.coverUrl &&
    currentTrack.coverUrl.trim() !== '' &&
    !currentTrack.coverUrl.includes('placeholder') &&
    !currentTrack.coverUrl.includes('default')
  );

  // Full player content (expanded state)
  const renderFullContent = () => (
    <Animated.View
      style={[styles.fullContent, fullContentStyle]}
      pointerEvents={isExpanded ? 'auto' : 'none'}
    >
      <SafeAreaView style={styles.safeFullContent}>
        {/* Draggable header area */}
        <GestureDetector gesture={headerPanGesture}>
          <View style={styles.headerDragger}>
            <View style={styles.dragHandleContainer}>
              <View style={[styles.dragHandle, { backgroundColor: theme.colors.textTertiary }]} />
            </View>
            <View style={styles.topBar}>
              <TouchableOpacity onPress={collapsePlayer} style={styles.closeButton} accessibilityLabel="Minimize player">
                <Icon name="chevronDown" size={24} color={theme.colors.text} />
              </TouchableOpacity>
              <View style={styles.topBarCenter}>
                <Text style={[styles.topBarLabel, { color: theme.colors.textSecondary }]}>NOW PLAYING</Text>
              </View>
              <View style={styles.closeButton} />
            </View>
          </View>
        </GestureDetector>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Album art with subtle shadow / Aurora fallback */}
          <View style={[styles.artWrap, { width: artSize, height: artSize }]}>
            {hasCustomThumbnail ? (
              <Image
                source={coverSource(currentTrack.coverUrl)}
                style={[styles.cover, { borderColor: theme.colors.border }]}
              />
            ) : (
              <View style={[styles.cover, styles.auroraThumbnailWrap, { borderColor: theme.colors.border }]}>
                <SoftAurora
                  speed={0.6}
                  scale={1.3}
                  brightness={1.05}
                  color1={theme.colors.primary}
                  color2="#00E5FF"
                  style={StyleSheet.absoluteFill}
                />
                <View style={styles.auroraCenterBadge}>
                  <Icon name="music" size={44} color="rgba(255, 255, 255, 0.95)" />
                </View>
              </View>
            )}
          </View>

          {/* Track info */}
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

          {/* Progress slider */}
          <View style={styles.progressContainer}>
            {playbackState === 'loading' ? (
              <View style={styles.loadingSliderWrap}>
                <TimelineLoadingBeam height={4} />
              </View>
            ) : (
              <Slider
                style={styles.slider}
                value={seekingValue ?? position}
                minimumValue={0}
                maximumValue={Math.max(duration, 1)}
                minimumTrackTintColor="#FFFFFF"
                maximumTrackTintColor="rgba(255, 255, 255, 0.3)"
                thumbTintColor="#FFFFFF"
                onSlidingStart={() => setSeekingValue(position)}
                onValueChange={(val) => setSeekingValue(val)}
                onSlidingComplete={async (val) => {
                  await seekTo(val);
                  setSeekingValue(null);
                }}
                accessibilityLabel="Seek"
              />
            )}
            <View style={styles.timeRow}>
              <Text style={[styles.time, { color: theme.colors.textTertiary }]}>
                {formatDuration((seekingValue ?? position) * 1000)}
              </Text>
              <Text style={[styles.time, { color: theme.colors.textTertiary }]}>
                {formatDuration(duration * 1000)}
              </Text>
            </View>
          </View>

          {/* Main controls */}
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
              <GlassButton
                variant="primary"
                size="xxl"
                icon={isPlaying ? 'pause' : 'play'}
                iconSize={28}
                iconColor="#000000"
                onPress={togglePlayPause}
                accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
                testID="player-play-pause"
                style={{ width: 68, height: 68, borderRadius: 34, paddingHorizontal: 0, justifyContent: 'center', alignItems: 'center' }}
              />
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

          {/* Up Next Banner */}
          {nextTrack && (
            <TouchableOpacity
              style={[styles.nextTrackBanner, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
              onPress={next}
              activeOpacity={0.7}
              accessibilityLabel={`Up next: ${nextTrack.title}`}
            >
              <View style={styles.nextTrackLeft}>
                <Text style={[styles.nextTrackLabel, { color: theme.colors.primary }]}>UP NEXT</Text>
                <Text style={[styles.nextTrackTitle, { color: theme.colors.text }]} numberOfLines={1}>
                  {nextTrack.title} • {nextTrack.artistName}
                </Text>
              </View>
              <Icon name="next" size={16} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          )}

          {/* Volume slider */}
          <View style={styles.volumeContainer}>
            <Icon
              name={volume === 0 ? 'volumeMute' : 'volume'}
              size={20}
              color={theme.colors.textSecondary}
              style={styles.volumeIcon}
            />
            <Slider
              style={styles.volumeSlider}
              value={volume}
              minimumValue={0}
              maximumValue={1}
              step={0.05}
              minimumTrackTintColor={theme.colors.primary}
              maximumTrackTintColor={theme.colors.surfaceLight}
              thumbTintColor={theme.colors.primary}
              onValueChange={setVolume}
              onSlidingComplete={(v) => setVolume(v)}
              accessibilityLabel="Volume"
            />
          </View>

          {/* Lyrics */}
          {currentTrack.lyrics && (
            <View style={[styles.lyricsContainer, { backgroundColor: theme.colors.surface }]}>
              <Text style={[styles.lyricsTitle, { color: theme.colors.textSecondary }]}>LYRICS</Text>
              <Text style={[styles.lyrics, { color: theme.colors.text }]}>{currentTrack.lyrics}</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  );

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        ref={sheetRef}
        style={[
          styles.sheetContainer,
          { backgroundColor: theme.colors.playerBackground },
          containerStyle,
        ]}
        pointerEvents="box-none"
      >
        {/* Artwork-derived backdrop (blurred cover) or ambient Aurora */}
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          {hasCustomThumbnail ? (
            <Image
              source={coverSource(currentTrack.coverUrl)}
              style={styles.backdropImage}
              blurRadius={Platform.OS === 'web' ? undefined : 60}
              resizeMode="cover"
            />
          ) : (
            <SoftAurora
              speed={0.35}
              scale={1.6}
              brightness={0.75}
              color1={theme.colors.primary}
              color2="#00E5FF"
              style={StyleSheet.absoluteFill}
            />
          )}
          {Platform.OS === 'web' && (
            <View style={styles.webBlurOverlay} />
          )}
        </Animated.View>

        {/* Full player content (visible when expanded) */}
        {renderFullContent()}
      </Animated.View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  sheetContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT,
    overflow: 'hidden',
    zIndex: 1000,
  },
  headerDragger: {
    width: '100%',
    paddingBottom: 4,
  },
  dragHandleContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.35,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  backdropImage: {
    ...StyleSheet.absoluteFill,
    opacity: 0.4,
  },
  webBlurOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  miniContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 16,
    paddingHorizontal: 12,
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  miniArtWrap: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
  },
  miniCover: {
    width: '100%',
    height: '100%',
  },
  miniInfo: {
    flex: 1,
    minWidth: 0,
  },
  miniTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  miniArtist: {
    fontSize: 12,
    marginTop: 1,
  },
  miniControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniPlayBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1DB954',
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniExpandIcon: {
    marginLeft: 4,
  },
  miniProgressTrack: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginTop: 8,
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: '#1DB954',
    borderRadius: 1.5,
  },
  fullContent: {
    flex: 1,
    paddingBottom: 48,
  },
  safeFullContent: {
    flex: 1,
  },
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
  auroraThumbnailWrap: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000000',
  },
  auroraCenterBadge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    ...(Platform.OS === 'web' ? {
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    } as any : {}),
  },
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
  playButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  volumeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 16,
    gap: 12,
  },
  volumeIcon: { width: 24 },
  volumeSlider: { flex: 1, height: 40 },
  nextTrackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 16,
  },
  nextTrackLeft: { flex: 1, marginRight: 12 },
  nextTrackLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 2 },
  nextTrackTitle: { fontSize: 13, fontWeight: '700' },
  lyricsContainer: { width: '100%', borderRadius: 12, padding: 16, marginTop: 28 },
  lyricsTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 10 },
  lyrics: { fontSize: 14, lineHeight: 22 },
});

export default PlayerSheet;