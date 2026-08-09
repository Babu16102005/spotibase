import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { useThemeStore } from '../store';

interface SkeletonProps {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: any;
}

const Skeleton: React.FC<SkeletonProps> = ({ width, height, borderRadius = 4, style }) => {
  const { theme } = useThemeStore();
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  return (
    <Animated.View
      style={[
        { width: width as any, height, borderRadius, backgroundColor: theme.colors.skeleton, opacity },
        style,
      ]}
    />
  );
};

export const SongSkeleton: React.FC = () => {
  const { theme } = useThemeStore();
  return (
    <View style={[styles.songRow, { backgroundColor: theme.colors.background }]}>
      <Skeleton width={48} height={48} borderRadius={4} />
      <View style={styles.songInfo}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="40%" height={12} style={{ marginTop: 6 }} />
      </View>
      <Skeleton width={32} height={12} />
    </View>
  );
};

export const CardSkeleton: React.FC<{ count?: number }> = ({ count = 5 }) => {
  const { theme } = useThemeStore();
  const cardWidth = 140;
  return (
    <View style={styles.cardRow}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.cardItem}>
          <Skeleton width={cardWidth} height={cardWidth} borderRadius={8} />
          <Skeleton width={cardWidth} height={14} style={{ marginTop: 8 }} />
          <Skeleton width={cardWidth * 0.6} height={12} style={{ marginTop: 4 }} />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  songRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  songInfo: { flex: 1, marginLeft: 12 },
  cardRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  cardItem: { marginRight: 12 },
});

export default Skeleton;
