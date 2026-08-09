import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Animated, Easing } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useDownloadStore } from '../store/downloadStore';
import { useThemeStore } from '../store';

interface DownloadButtonProps {
  songId: string;
  size?: number;
  showLabel?: boolean;
  onPress?: () => void;
}

export const DownloadButton = React.memo(({ songId, size = 24, showLabel = false, onPress }: DownloadButtonProps) => {
  const { theme } = useThemeStore();
  const { isDownloaded, isDownloading, getDownload, startDownload, deleteDownload } = useDownloadStore();

  const download = getDownload(songId);
  const downloaded = isDownloaded(songId);
  const downloading = isDownloading(songId);
  const progress = download?.status === 'DOWNLOADING' ? 50 : download?.status === 'COMPLETED' ? 100 : 0;

  const [animValue] = React.useState(() => new Animated.Value(0));
  const [progressAnim] = React.useState(() => new Animated.Value(0));

  React.useEffect(() => {
    if (downloading) {
      Animated.loop(
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: false,
        })
      ).start();
    } else {
      progressAnim.stopAnimation();
      progressAnim.setValue(downloaded ? 1 : 0);
    }
  }, [downloading, downloaded, progressAnim]);

  const handlePress = async () => {
    if (onPress) {
      onPress();
      return;
    }

    if (downloaded) {
      await deleteDownload(songId);
    } else if (!downloading) {
      await startDownload(songId);
    }
  };

  const getIcon = () => {
    if (downloading) {
      return 'download-outline';
    }
    if (downloaded) {
      return 'checkmark-circle-outline';
    }
    return 'cloud-download-outline';
  };

  const getColor = () => {
    if (downloading) return theme.colors.primary;
    if (downloaded) return theme.colors.success;
    return theme.colors.textSecondary;
  };

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { width: size + 16, height: size + 16 },
        downloaded && styles.downloaded,
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
      disabled={downloading}
      accessibilityLabel={downloaded ? 'Remove download' : downloading ? 'Downloading...' : 'Download song'}
      accessibilityRole="button"
    >
      <Animated.View style={[
        styles.iconWrapper,
        { width: size, height: size },
      ]}>
        <Ionicons
          name={getIcon()}
          size={size}
          color={getColor()}
        />
        {downloading && (
          <Animated.View style={[
            styles.progressRing,
            { width: size + 4, height: size + 4 },
          ]}>
            <Animated.View style={[
              styles.progressFill,
              { width: size + 4, height: size + 4 },
              {
                transform: [
                  { rotate: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '360deg'],
                  })},
                ],
              },
            ]} />
          </Animated.View>
        )}
      </Animated.View>
      {showLabel && (
        <Text style={[
          styles.label,
          { color: getColor(), fontSize: size * 0.4 },
        ]}>
          {downloaded ? 'Downloaded' : downloading ? 'Downloading...' : 'Download'}
        </Text>
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    padding: 4,
  },
  downloaded: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  iconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRing: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'transparent',
    borderTopColor: 'currentColor',
    borderRightColor: 'currentColor',
  },
  progressFill: {
    position: 'absolute',
    borderRadius: 999,
  },
  label: {
    marginTop: 2,
    fontWeight: '500',
  },
});

export default DownloadButton;