import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Animated,
  Easing,
  PanResponder,
  Platform,
} from 'react-native';
import { SongResponse } from '../types';
import { useThemeStore, usePlayerStore, useSelectionStore } from '../store';
import { formatDuration, coverSource } from '../utils';
import Icon from './Icon';
import SongOptionsMenuModal from './SongOptionsMenuModal';

interface SongRowProps {
  song: SongResponse;
  index: number; // 1-based position in the full list
  isCurrent: boolean; // this row is the currently loaded track
  isPlaying: boolean; // player is actually playing
  onPress: () => void;
  onToggleLike: (song: SongResponse) => void;
  onSongUpdated?: (updatedSong: SongResponse) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onLongPress?: () => void;
}

/**
 * Spotify-style vertical song row:
 * Supports swipe left-to-right to add to queue, equalizer animation, 3-dots options menu, hover action, and long-press multi-select.
 */
const SongRow: React.FC<SongRowProps> = ({
  song,
  index,
  isCurrent,
  isPlaying,
  onPress,
  onToggleLike,
  onSongUpdated,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
  onLongPress,
}) => {
  const { theme } = useThemeStore();
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const queue = usePlayerStore((s) => s.queue);
  const isInQueue = queue?.some((item) => item?.id === song.id);

  const isSelectionModeGlobal = useSelectionStore((s) => s.isSelectionMode);
  const isSelectedGlobal = useSelectionStore((s) => s.selectedSongIds.has(song.id));
  const toggleSelectGlobal = useSelectionStore((s) => s.toggleSelect);
  const selectGlobal = useSelectionStore((s) => s.select);

  const activeSelectionMode = selectionMode || isSelectionModeGlobal;
  const activeIsSelected = isSelected || isSelectedGlobal;

  const handleRowPress = () => {
    if (activeSelectionMode) {
      if (onToggleSelect) onToggleSelect();
      else toggleSelectGlobal(song.id);
    } else {
      onPress();
    }
  };

  const handleRowLongPress = () => {
    if (activeSelectionMode) {
      if (onToggleSelect) onToggleSelect();
      else toggleSelectGlobal(song.id);
    } else {
      if (onLongPress) onLongPress();
      else selectGlobal(song.id);
    }
  };

  const bars = useRef([new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)]).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);

  const translateX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isCurrent && isPlaying) {
      anim.current = Animated.loop(
        Animated.stagger(120, bars.map((b) =>
          Animated.sequence([
            Animated.timing(b, { toValue: 1, duration: 280, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
            Animated.timing(b, { toValue: 0.3, duration: 280, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          ])
        ))
      );
      anim.current.start();
    } else {
      if (anim.current) anim.current.stop();
      bars.forEach((b) => b.setValue(0.3));
    }
    return () => { if (anim.current) anim.current.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrent, isPlaying]);

  const handleSwipeQueue = async () => {
    await addToQueue(song);
    const capacityText = `Queued: ${song.title} (${Math.min(queue.length + 1, 5)}/5 max)`;
    setToastMessage(capacityText);
    setTimeout(() => setToastMessage(null), 1800);
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return gestureState.dx > 12 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx > 0) {
          translateX.setValue(Math.min(gestureState.dx, 110));
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 55) {
          handleSwipeQueue();
        }
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 6,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  const accentColor = isCurrent ? theme.colors.primary : theme.colors.textSecondary;

  const onHoverProps = Platform.OS === 'web' ? {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  } : {};

  return (
    <View style={styles.outerWrapper}>
      {/* Revealed Left-to-Right Swipe Background */}
      <Animated.View
        style={[
          styles.swipeBackground,
          {
            backgroundColor: theme.colors.primary,
            opacity: translateX.interpolate({
              inputRange: [0, 40],
              outputRange: [0, 1],
              extrapolate: 'clamp',
            }),
          },
        ]}
      >
        <View style={styles.swipeContent}>
          <Icon name="queue" size={18} color="#000000" />
          <Text style={styles.swipeText}>Add to Queue</Text>
        </View>
      </Animated.View>

      {/* Main Sliding Song Row */}
      <Animated.View
        {...(!activeSelectionMode ? panResponder.panHandlers : {})}
        style={{ transform: [{ translateX }] }}
      >
        <TouchableOpacity
          style={[
            styles.container,
            {
              backgroundColor: activeIsSelected
                ? 'rgba(29, 185, 84, 0.08)'
                : isCurrent
                ? theme.colors.surface
                : (hovered ? theme.colors.surface : 'transparent'),
              borderColor: activeIsSelected ? 'rgba(29, 185, 84, 0.35)' : 'transparent',
              borderWidth: activeIsSelected ? 1 : 0,
            },
          ]}
          onPress={handleRowPress}
          onLongPress={handleRowLongPress}
          delayLongPress={200}
          activeOpacity={0.6}
          {...onHoverProps}
        >
          <View style={styles.left}>
            {activeSelectionMode ? (
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: activeIsSelected ? theme.colors.primary : theme.colors.textSecondary,
                    backgroundColor: activeIsSelected ? theme.colors.primary : 'transparent',
                  },
                ]}
              >
                {activeIsSelected && <Icon name="check" size={12} color="#000000" />}
              </View>
            ) : isCurrent ? (
              <View style={styles.equalizer}>
                {bars.map((b, i) => (
                  <Animated.View
                    key={i}
                    style={[styles.bar, { backgroundColor: theme.colors.primary, transform: [{ scaleY: b }] }]}
                  />
                ))}
              </View>
            ) : (
              <Text style={[styles.index, { color: theme.colors.textTertiary }]}>{index}</Text>
            )}
          </View>

          <Image source={coverSource(song.coverUrl)} style={styles.cover} />

          <View style={styles.info}>
            <Text
              style={[styles.title, { color: isCurrent ? theme.colors.primary : theme.colors.text }]}
              numberOfLines={1}
            >
              {song.title}
            </Text>
            <Text style={[styles.artist, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {song.artistName}
              {song.albumName ? ` • ${song.albumName}` : ''}
            </Text>
          </View>

          {/* Show Queue Icon ONLY if song is in queue */}
          {isInQueue && (
            <View
              style={styles.quickQueueBtn}
              accessibilityLabel="In queue"
            >
              <Icon name="queue" size={15} color={theme.colors.primary} />
            </View>
          )}

          <TouchableOpacity
            onPress={() => onToggleLike(song)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.likeButton}
            accessibilityLabel={song.liked ? 'Unlike song' : 'Like song'}
          >
            <Icon name={song.liked ? 'heartFilled' : 'heart'} size={16} color={song.liked ? theme.colors.primary : theme.colors.textTertiary} />
          </TouchableOpacity>

          <Text style={[styles.duration, { color: accentColor }]}>{formatDuration(song.durationMs)}</Text>

          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              setOptionsVisible(true);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.moreButton}
            accessibilityLabel="Song options"
          >
            <Icon name="more" size={16} color={theme.colors.textTertiary} />
          </TouchableOpacity>
        </TouchableOpacity>
      </Animated.View>

      {/* Swipe Queue Toast Notification Banner */}
      {toastMessage ? (
        <View style={[styles.toastBanner, { backgroundColor: theme.colors.primary }]}>
          <Icon name="queue" size={14} color="#000000" />
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      ) : null}

      <SongOptionsMenuModal
        visible={optionsVisible}
        song={song}
        onClose={() => setOptionsVisible(false)}
        onSongUpdated={onSongUpdated || ((s) => onToggleLike(s))}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  outerWrapper: {
    position: 'relative',
    overflow: 'hidden',
  },
  swipeBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 130,
    justifyContent: 'center',
    paddingLeft: 16,
    zIndex: 0,
  },
  swipeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  swipeText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: '800',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    zIndex: 1,
  },
  left: {
    width: 32,
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  index: {
    fontSize: 13,
    fontWeight: '500',
  },
  equalizer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 18,
    gap: 2,
  },
  bar: {
    width: 3,
    height: 14,
    borderRadius: 2,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 4,
  },
  info: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  artist: {
    fontSize: 12,
    marginTop: 2,
  },
  quickQueueBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginRight: 4,
  },
  likeButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  duration: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  moreButton: {
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 4,
  },
  toastBanner: {
    position: 'absolute',
    top: 4,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
    zIndex: 10,
    elevation: 5,
    boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
  },
  toastText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '800',
  },
});

export default React.memo(SongRow);
