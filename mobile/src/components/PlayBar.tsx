import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Animated, Easing, Platform } from 'react-native';
import Slider from '@react-native-community/slider';
import { usePlayerStore, useThemeStore } from '../store';
import { formatDuration, coverSource } from '../utils';
import Icon from './Icon';
import GlassButton from './GlassButton';
import TimelineLoadingBeam from './TimelineLoadingBeam';

interface PlayBarProps {
  onOpenPlayer: () => void;
}

/**
 * Spotify-style bottom playback bar for desktop layouts: cover + title/artist
 * on the left, transport controls + progress in the center, like on the right.
 * Includes a live equalizer when the current track is playing.
 */
const PlayBar: React.FC<PlayBarProps> = ({ onOpenPlayer }) => {
  const { currentTrack, playbackState, position, duration, shuffle, repeat,
          togglePlayPause, next, previous, seekTo, setShuffle, setRepeat } = usePlayerStore();
  const { theme } = useThemeStore();

  const isPlaying = playbackState === 'playing';
  const [liked, setLiked] = React.useState(currentTrack?.liked ?? false);
  const [seekingValue, setSeekingValue] = React.useState<number | null>(null);

  useEffect(() => {
    setLiked(currentTrack?.liked ?? false);
  }, [currentTrack?.id, currentTrack?.liked]);

  // Live equalizer bars (only animate while playing)
  const bars = useRef([new Animated.Value(0.3), new Animated.Value(0.6), new Animated.Value(0.3), new Animated.Value(0.8)]).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isPlaying) {
      anim.current = Animated.loop(
        Animated.stagger(110, bars.map((b) =>
          Animated.sequence([
            Animated.timing(b, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.timing(b, { toValue: 0.3, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          ])
        ))
      );
      anim.current.start();
    } else {
      if (anim.current) anim.current.stop();
      bars.forEach((b, i) => b.setValue([0.3, 0.6, 0.3, 0.8][i]));
    }
    return () => { if (anim.current) anim.current.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  if (!currentTrack) return null;

  const progress = duration > 0 ? position / duration : 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.playerBar, borderTopColor: theme.colors.border }]}>
      {/* Left: track info */}
      <View style={styles.left}>
        <TouchableOpacity onPress={onOpenPlayer} style={styles.trackRow} activeOpacity={0.8}>
          <Image source={coverSource(currentTrack.coverUrl)} style={styles.cover} />
          <View style={styles.trackText}>
            <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
              {currentTrack.title}
            </Text>
            <Text style={[styles.artist, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {currentTrack.artistName}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setLiked(!liked)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.likeButton}
          accessibilityLabel={liked ? 'Unlike song' : 'Like song'}
        >
          <Icon name={liked ? 'heartFilled' : 'heart'} size={18} color={liked ? theme.colors.primary : theme.colors.textSecondary} />
        </TouchableOpacity>

        {/* Equalizer */}
        <View style={styles.equalizer} accessibilityLabel={isPlaying ? 'Playing' : 'Paused'}>
          {bars.map((b, i) => (
            <Animated.View
              key={i}
              style={[styles.eqBar, { backgroundColor: theme.colors.primary, transform: [{ scaleY: b }] }]}
            />
          ))}
        </View>
      </View>

      {/* Center: controls + progress */}
      <View style={styles.center}>
        <View style={styles.controlsRow}>
          <TouchableOpacity onPress={() => setShuffle(!shuffle)} hitSlop={8} accessibilityLabel="Shuffle">
            <Icon name="shuffle" size={16} color={shuffle ? theme.colors.primary : theme.colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={previous} hitSlop={8} accessibilityLabel="Previous">
            <Icon name="previous" size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <GlassButton
            variant="primary"
            size="icon"
            icon={isPlaying ? 'pause' : 'play'}
            iconSize={17}
            iconColor="#000000"
            onPress={togglePlayPause}
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            testID="playbar-play-pause"
            style={{ width: 36, height: 36, borderRadius: 18, paddingHorizontal: 0, justifyContent: 'center', alignItems: 'center' }}
          />
          <TouchableOpacity onPress={next} hitSlop={8} accessibilityLabel="Next">
            <Icon name="next" size={22} color={theme.colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}
            hitSlop={8}
            accessibilityLabel="Repeat"
          >
            <Icon name={repeat === 'one' ? 'repeatOne' : 'repeat'} size={16} color={repeat !== 'off' ? theme.colors.primary : theme.colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={styles.progressRow}>
          <Text style={[styles.time, { color: theme.colors.textTertiary }]}>
            {formatDuration((seekingValue ?? position) * 1000)}
          </Text>
          <View style={styles.sliderWrap}>
            {playbackState === 'loading' ? (
              <TimelineLoadingBeam height={4} />
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
              />
            )}
          </View>
          <Text style={[styles.time, { color: theme.colors.textTertiary }]}>{formatDuration(duration * 1000)}</Text>
        </View>
      </View>

      {/* Right: queue / full player affordance */}
      <View style={styles.right}>
        <TouchableOpacity onPress={onOpenPlayer} accessibilityLabel="Now Playing">
          <Icon name="queue" size={18} color={theme.colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 84,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    zIndex: 20,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    ...(Platform.OS === 'web' ? {
      backdropFilter: 'blur(35px)',
      WebkitBackdropFilter: 'blur(35px)',
    } : {}),
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1.2,
    minWidth: 0,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
    } : {}),
  },
  cover: {
    width: 52,
    height: 52,
    borderRadius: 6,
  },
  trackText: {
    marginLeft: 12,
    flexShrink: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  artist: {
    fontSize: 12,
    marginTop: 2,
  },
  likeButton: {
    marginLeft: 14,
    ...(Platform.OS === 'web' ? {
      transition: 'transform 0.2s ease',
      cursor: 'pointer',
    } : {}),
  },
  equalizer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 22,
    gap: 2.5,
    marginLeft: 16,
  },
  eqBar: {
    width: 3,
    height: 20,
    borderRadius: 2,
  },
  center: {
    flex: 2,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 26,
  },
  playButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 4,
    position: 'relative',
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 0 10px rgba(255, 255, 255, 0.3)',
      transition: 'transform 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease',
      cursor: 'pointer',
    } : {}),
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 4,
  },
  time: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    minWidth: 34,
    textAlign: 'center',
  },
  sliderWrap: {
    flex: 1,
    marginHorizontal: 8,
  },
  slider: {
    width: '100%',
    height: 22,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
  },
  right: {
    flex: 1.2,
    alignItems: 'flex-end',
  },
});

export default PlayBar;