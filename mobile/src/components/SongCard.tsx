import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Platform, Animated, PanResponder } from 'react-native';
import { SongResponse } from '../types';
import { usePlayerStore, useThemeStore, useSelectionStore } from '../store';
import { formatDuration, coverSource } from '../utils';
import Icon from './Icon';
import SongOptionsMenuModal from './SongOptionsMenuModal';

interface SongCardProps {
  song: SongResponse;
  onPress?: () => void;
  showArtist?: boolean;
  showAlbum?: boolean;
  showContributingArtists?: boolean;
  index?: number;
  /** Compact square-card variant for horizontal rails (Spotify home style). */
  compact?: boolean;
  /** Whether this row is the currently loaded track (highlights in primary). */
  isCurrent?: boolean;
  onSongUpdated?: (updatedSong: SongResponse) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onLongPress?: () => void;
}

const SongCard: React.FC<SongCardProps> = ({
  song,
  onPress,
  showArtist = true,
  showAlbum = false,
  showContributingArtists = false,
  index,
  compact = false,
  isCurrent = false,
  onSongUpdated,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
  onLongPress,
}) => {
  const play = usePlayerStore((s) => s.play);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const queue = usePlayerStore((s) => s.queue);
  const isInQueue = queue?.some((item) => item?.id === song.id);
  const { theme } = useThemeStore();

  const isSelectionModeGlobal = useSelectionStore((s) => s.isSelectionMode);
  const isSelectedGlobal = useSelectionStore((s) => s.selectedSongIds.has(song.id));
  const toggleSelectGlobal = useSelectionStore((s) => s.toggleSelect);
  const selectGlobal = useSelectionStore((s) => s.select);

  const activeSelectionMode = selectionMode || isSelectionModeGlobal;
  const activeIsSelected = isSelected || isSelectedGlobal;

  const [hovered, setHovered] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const translateX = useRef(new Animated.Value(0)).current;

  const handlePress = () => {
    if (onPress) onPress();
    else play(song);
  };

  const handleCardPress = () => {
    if (activeSelectionMode) {
      if (onToggleSelect) onToggleSelect();
      else toggleSelectGlobal(song.id);
    } else {
      handlePress();
    }
  };

  const handleCardLongPress = () => {
    if (activeSelectionMode) {
      if (onToggleSelect) onToggleSelect();
      else toggleSelectGlobal(song.id);
    } else {
      if (onLongPress) onLongPress();
      else selectGlobal(song.id);
    }
  };

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

  // Get featuring artists for display
  const featuringArtists = song.contributingArtists?.filter(ca => ca.role === 'FEATURING') || [];
  const featuringNames = featuringArtists.map(ca => ca.artistName).join(', ');

  const onHoverProps = Platform.OS === 'web' ? {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  } : {};

  if (compact) {
    return (
      <>
        <TouchableOpacity
          style={[
            styles.compactContainer,
            {
              backgroundColor: activeIsSelected
                ? 'rgba(29, 185, 84, 0.08)'
                : hovered
                ? theme.colors.surfaceLight
                : 'transparent',
              borderColor: activeIsSelected
                ? 'rgba(29, 185, 84, 0.35)'
                : hovered
                ? theme.colors.border
                : 'transparent',
              borderWidth: activeIsSelected ? 1 : 0,
              transform: hovered ? [{ scale: 1.04 }] : [{ scale: 1 }],
              boxShadow: hovered 
                ? (theme.dark ? '0 10px 25px -5px rgba(0, 0, 0, 0.4)' : '0 10px 25px -5px rgba(0, 0, 0, 0.08)')
                : 'none',
            } as any
          ]}
          onPress={handleCardPress}
          onLongPress={handleCardLongPress}
          delayLongPress={200}
          activeOpacity={0.8}
          {...onHoverProps}
        >
          <View style={styles.compactArt}>
            <Image source={coverSource(song.coverUrl)} style={styles.compactCover} />
            {activeSelectionMode && (
              <View
                style={[
                  styles.compactCheckbox,
                  {
                    borderColor: activeIsSelected ? theme.colors.primary : '#FFFFFF',
                    backgroundColor: activeIsSelected ? theme.colors.primary : 'rgba(0,0,0,0.6)',
                  },
                ]}
              >
                {activeIsSelected && <Icon name="check" size={12} color="#000000" />}
              </View>
            )}
            {!activeSelectionMode && hovered && (
              <View style={[styles.compactPlay, { backgroundColor: theme.colors.primary }]}>
                <Icon name="play" size={14} color="#000000" />
              </View>
            )}
          </View>
          <Text style={[styles.compactTitle, { color: isCurrent ? theme.colors.primary : theme.colors.text }]} numberOfLines={1}>
            {song.title}
          </Text>
          {showArtist && (
            <Text style={[styles.compactArtist, { color: theme.colors.textSecondary }]} numberOfLines={1}>
              {song.artistName}
              {featuringNames ? ` (feat. ${featuringNames})` : ''}
            </Text>
          )}
        </TouchableOpacity>
        <SongOptionsMenuModal
          visible={optionsVisible}
          song={song}
          onClose={() => setOptionsVisible(false)}
          onSongUpdated={onSongUpdated}
        />
      </>
    );
  }

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

      {/* Main Sliding Song Container */}
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
                : hovered
                ? theme.colors.surface
                : 'transparent',
              borderColor: activeIsSelected ? 'rgba(29, 185, 84, 0.35)' : 'transparent',
              borderWidth: activeIsSelected ? 1 : 0,
            },
          ]}
          onPress={handleCardPress}
          onLongPress={handleCardLongPress}
          delayLongPress={200}
          activeOpacity={0.7}
          {...onHoverProps}
        >
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
          ) : index !== undefined ? (
            <Text style={[styles.index, { color: isCurrent ? theme.colors.primary : theme.colors.textSecondary }]}>
              {isCurrent ? '\u25CF' : index + 1}
            </Text>
          ) : null}
          <Image
            source={coverSource(song.coverUrl)}
            style={styles.cover}
          />
          <View style={styles.info}>
            <Text
              style={[styles.title, { color: isCurrent ? theme.colors.primary : theme.colors.text }]}
              numberOfLines={1}
            >
              {song.title}
            </Text>
            {showArtist && (
              <Text style={[styles.artist, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                {song.artistName}
                {featuringNames ? ` (feat. ${featuringNames})` : ''}
                {showAlbum && song.albumName ? ` \u2022 ${song.albumName}` : ''}
              </Text>
            )}
            {showContributingArtists && song.contributingArtists && song.contributingArtists.length > 0 && (
              <Text style={[styles.contribArtists, { color: theme.colors.textTertiary }]} numberOfLines={1}>
                {song.contributingArtists
                  .filter(ca => ca.role !== 'PRIMARY')
                  .map(ca => `${ca.role.charAt(0) + ca.role.slice(1).toLowerCase()}: ${ca.artistName}`)
                  .join(' \u2022 ')}
              </Text>
            )}
          </View>

          {/* Show Queue Icon ONLY if song is in queue */}
          {isInQueue && (
            <View
              style={{ paddingHorizontal: 6, paddingVertical: 4, marginRight: 4 }}
              accessibilityLabel="In queue"
            >
              <Icon name="queue" size={15} color={theme.colors.primary} />
            </View>
          )}

          <Text style={[styles.duration, { color: theme.colors.textTertiary }]}>
            {formatDuration(song.durationMs)}
          </Text>

          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              setOptionsVisible(true);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ paddingLeft: 8, paddingRight: 4, paddingVertical: 4 }}
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
        onSongUpdated={onSongUpdated}
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
    borderRadius: 8,
    zIndex: 1,
    ...(Platform.OS === 'web' ? {
      transition: 'background-color 0.2s ease, transform 0.2s ease',
    } : {}),
  },
  index: {
    width: 24,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: 6,
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
  contribArtists: {
    fontSize: 11,
    marginTop: 2,
    fontStyle: 'italic',
  },
  duration: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
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
  // Compact rail card
  compactContainer: {
    width: 160,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    ...(Platform.OS === 'web' ? {
      transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
    } : {}),
  },
  compactArt: {
    width: 140,
    height: 140,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 8,
  },
  compactCover: {
    width: '100%',
    height: '100%',
  },
  compactCheckbox: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  compactPlay: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  compactTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  compactArtist: {
    fontSize: 12,
    marginTop: 2,
  },
});

export default React.memo(SongCard);