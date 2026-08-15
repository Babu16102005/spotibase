import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet, Platform, Dimensions
} from 'react-native';
import Animated, { useAnimatedStyle, interpolate, Extrapolation } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, withSpring, withTiming } from 'react-native-reanimated';
import { usePlayerStore, useThemeStore } from '../store';
import { songApi } from '../api/client';
import {
  coverSource,
  playerTranslateY,
  playerScale,
  playerBorderRadius,
  playerContentOpacity,
  playerBackdropOpacity,
} from '../utils';
import Icon from './Icon';
import GlassButton from './GlassButton';
import TimelineLoadingBeam from './TimelineLoadingBeam';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// Tuned spring: fast attack, no overshoot, feels native
const EXPAND_SPRING = { damping: 28, stiffness: 220, mass: 0.75 };
const COLLAPSE_SPRING = { damping: 32, stiffness: 260, mass: 0.7 };

interface MiniPlayerProps {
  testID?: string;
}

const MiniPlayer: React.FC<MiniPlayerProps> = ({ testID }) => {
  const { currentTrack, playbackState, position, duration, togglePlayPause, next, expandPlayer } = usePlayerStore();
  const { theme } = useThemeStore();
  const [liked, setLiked] = useState(currentTrack?.liked ?? false);

  const isPlaying = playbackState === 'playing';
  const progress = duration > 0 ? Math.min(Math.max(position / duration, 0), 1) : 0;

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
    } catch {
      setLiked(!nextLiked);
    }
  };

  if (!currentTrack) return null;

  // Animate MiniPlayer opacity/translateY as PlayerSheet opens
  const miniStyle = useAnimatedStyle(() => {
    // When playerTranslateY approaches 0 (fully open), fade mini player out
    const prog = interpolate(
      playerTranslateY.value,
      [0, SCREEN_HEIGHT],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: prog,
      transform: [{ translateY: interpolate(prog, [0, 1], [20, 0], Extrapolation.CLAMP) }],
    };
  });

  // Swipe-up gesture: drives the PlayerSheet in real time
  const panGesture = Gesture.Pan()
    .activeOffsetY([-8, 8]) // activate fast on vertical intent
    .failOffsetX([-12, 12]) // bail if horizontal
    .onBegin(() => {
      // Ensure sheet starts from bottom
      if (playerTranslateY.value > SCREEN_HEIGHT - 10) {
        playerTranslateY.value = SCREEN_HEIGHT;
      }
    })
    .onUpdate((event) => {
      if (event.translationY >= 0) return; // only upward swipes
      const dragY = SCREEN_HEIGHT + event.translationY; // starts at SCREEN_HEIGHT, goes toward 0
      playerTranslateY.value = Math.max(0, dragY);

      const openProgress = 1 - playerTranslateY.value / SCREEN_HEIGHT;
      playerScale.value = 0.95 + openProgress * 0.05;
      playerBorderRadius.value = 20 * (1 - openProgress);
      playerContentOpacity.value = openProgress;
      playerBackdropOpacity.value = openProgress * 0.45;
    })
    .onEnd((event) => {
      const openProgress = 1 - playerTranslateY.value / SCREEN_HEIGHT;
      const shouldExpand = openProgress > 0.35 || event.velocityY < -500;
      if (shouldExpand) {
        playerTranslateY.value = withSpring(0, EXPAND_SPRING);
        playerScale.value = withSpring(1, EXPAND_SPRING);
        playerBorderRadius.value = withSpring(0, EXPAND_SPRING);
        playerContentOpacity.value = withTiming(1, { duration: 200 });
        playerBackdropOpacity.value = withTiming(0.45, { duration: 180 });
        runOnJS(expandPlayer)();
      } else {
        playerTranslateY.value = withSpring(SCREEN_HEIGHT, COLLAPSE_SPRING);
        playerScale.value = withSpring(0.95, COLLAPSE_SPRING);
        playerBorderRadius.value = withSpring(20, COLLAPSE_SPRING);
        playerContentOpacity.value = withTiming(0, { duration: 150 });
        playerBackdropOpacity.value = withTiming(0, { duration: 150 });
      }
    });

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        style={[styles.outerWrap, miniStyle]}
        testID={testID}
        accessibilityLabel="Mini player – swipe up to expand"
      >
        {/* Progress line */}
        {playbackState === 'loading' ? (
          <TimelineLoadingBeam height={2.5} />
        ) : (
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: '#FFFFFF' }]} />
          </View>
        )}

        <View style={[styles.container, { backgroundColor: theme.colors.playerBackground }]}>
          <Image source={coverSource(currentTrack.coverUrl)} style={styles.cover} />

          <TouchableOpacity
            style={styles.info}
            onPress={expandPlayer}
            accessibilityLabel="Expand player"
          >
            <Text style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
              {currentTrack.title}
            </Text>
            <Text style={[styles.artist, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {currentTrack.artistName}
            </Text>
          </TouchableOpacity>

          <View style={styles.controls}>
            <TouchableOpacity
              onPress={toggleLike}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel={liked ? 'Unlike song' : 'Like song'}
            >
              <Icon name={liked ? 'heartFilled' : 'heart'} size={20} color={liked ? theme.colors.primary : theme.colors.text} />
            </TouchableOpacity>
            <GlassButton
              variant="primary"
              size="icon"
              icon={isPlaying ? 'pause' : 'play'}
              iconSize={16}
              iconColor="#000000"
              onPress={togglePlayPause}
              accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
              testID="miniplayer-play-pause"
              style={{ width: 34, height: 34, borderRadius: 17, paddingHorizontal: 0, justifyContent: 'center', alignItems: 'center' }}
            />
            <TouchableOpacity
              onPress={next}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Next"
            >
              <Icon name="next" size={20} color={theme.colors.text} />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  outerWrap: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    ...(Platform.OS === 'web' ? {
      backdropFilter: 'blur(25px)',
      WebkitBackdropFilter: 'blur(25px)',
    } as any : {}),
  },
  progressBar: {
    height: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  progressFill: {
    height: '100%',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    paddingBottom: 14,
  },
  cover: {
    width: 46,
    height: 46,
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
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});

export default MiniPlayer;