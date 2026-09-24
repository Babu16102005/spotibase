import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  Platform,
} from 'react-native';
import type { YouTubeVideo } from '../../types/youtube';
import { useThemeStore } from '../../store/themeStore';
import { useYouTubePlayerStore } from '../../store/youtubePlayerStore';
import { formatCount, formatDuration, formatIso8601Duration, parseIso8601DurationToMs } from '../../utils';
import Icon from '../Icon';

interface YouTubeVideoCardProps {
  video: YouTubeVideo;
  onPress?: (video: YouTubeVideo) => void;
  isActive?: boolean;
  /** 'row' = full-width list row, 'rail' = fixed-width horizontal-rail card. */
  variant?: 'row' | 'rail';
  testID?: string;
}

const durationLabelOf = (video: YouTubeVideo): string | null => {
  // Backend proxies the Data API ISO-8601 duration verbatim (e.g. "PT4M13S"):
  // format it instead of rendering the raw ISO string.
  if (typeof video.duration === 'string' && video.duration.length > 0) {
    if (video.duration.startsWith('PT')) {
      const formatted = formatIso8601Duration(video.duration);
      if (formatted) return formatted;
      const ms = parseIso8601DurationToMs(video.duration);
      if (ms != null && ms > 0) return formatDuration(ms);
      return null;
    }
    return video.duration;
  }
  if (typeof video.durationMs === 'number' && video.durationMs > 0)
    return formatDuration(video.durationMs);
  return null;
};

const YouTubeVideoCard: React.FC<YouTubeVideoCardProps> = ({
  video,
  onPress,
  isActive = false,
  variant = 'row',
  testID,
}) => {
  const { theme } = useThemeStore();
  const playVideo = useYouTubePlayerStore((s) => s.playVideo);
  const [hovered, setHovered] = useState(false);

  const handlePress = () => {
    if (onPress) onPress(video);
    else playVideo(video);
  };

  const onHoverProps =
    Platform.OS === 'web'
      ? {
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
        }
      : {};

  const durationLabel = durationLabelOf(video);
  const metaLine = [
    video.channelTitle,
    typeof video.viewCount === 'number' && video.viewCount >= 0
      ? `${formatCount(video.viewCount)} views`
      : null,
  ]
    .filter(Boolean)
    .join(' • ');

  const thumbnail = (
    <View
      style={[
        variant === 'rail' ? styles.railThumb : styles.thumb,
        { backgroundColor: theme.colors.surfaceLight },
      ]}
    >
      <Image
        source={{ uri: video.thumbnailUrl }}
        style={StyleSheet.absoluteFill as any}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
      <View style={styles.playOverlay} pointerEvents="none">
        <View
          style={[
            styles.playBadge,
            { backgroundColor: isActive ? theme.colors.primary : 'rgba(0,0,0,0.65)' },
          ]}
        >
          <Icon
            name={isActive ? 'pause' : 'play'}
            size={14}
            color={isActive ? '#000000' : '#FFFFFF'}
          />
        </View>
      </View>
      {durationLabel ? (
        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{durationLabel}</Text>
        </View>
      ) : null}
    </View>
  );

  if (variant === 'rail') {
    return (
      <TouchableOpacity
        style={[
          styles.railContainer,
          {
            backgroundColor: isActive
              ? 'rgba(29, 185, 84, 0.10)'
              : hovered
                ? theme.colors.surface
                : 'transparent',
            borderColor: isActive ? 'rgba(29, 185, 84, 0.4)' : 'transparent',
          },
        ]}
        onPress={handlePress}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Play ${video.title}`}
        accessibilityState={{ selected: isActive }}
        testID={testID}
        {...onHoverProps}
      >
        {thumbnail}
        <Text
          style={[styles.railTitle, { color: isActive ? theme.colors.primary : theme.colors.text }]}
          numberOfLines={2}
        >
          {video.title}
        </Text>
        {metaLine ? (
          <Text style={[styles.railMeta, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {metaLine}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[
        styles.container,
        {
          backgroundColor: isActive
            ? 'rgba(29, 185, 84, 0.08)'
            : hovered
              ? theme.colors.surface
              : 'transparent',
          borderColor: isActive ? 'rgba(29, 185, 84, 0.35)' : 'transparent',
        },
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Play ${video.title}`}
      accessibilityState={{ selected: isActive }}
      testID={testID}
      {...onHoverProps}
    >
      {thumbnail}
      <View style={styles.info}>
        <Text
          style={[styles.title, { color: isActive ? theme.colors.primary : theme.colors.text }]}
          numberOfLines={2}
        >
          {video.title}
        </Text>
        {metaLine ? (
          <Text style={[styles.meta, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {metaLine}
          </Text>
        ) : null}
      </View>
      <Icon name="play" size={16} color={theme.colors.textTertiary} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    gap: 12,
  },
  thumb: {
    width: 128,
    height: 72,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
  },
  info: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '600', lineHeight: 18 },
  meta: { fontSize: 12, marginTop: 4 },
  railContainer: {
    width: 200,
    borderRadius: 12,
    padding: 8,
    borderWidth: 1,
    marginRight: 12,
  },
  railThumb: {
    width: '100%',
    height: 112,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  railTitle: { fontSize: 13, fontWeight: '700', marginTop: 8, lineHeight: 17 },
  railMeta: { fontSize: 12, marginTop: 4 },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  durationText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
});

export default React.memo(YouTubeVideoCard);
