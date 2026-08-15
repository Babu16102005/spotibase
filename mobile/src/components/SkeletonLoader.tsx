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

export const HeaderSkeleton: React.FC = () => {
  return (
    <View style={styles.headerSkeleton}>
      <Skeleton width={180} height={180} borderRadius={16} />
      <Skeleton width={200} height={22} borderRadius={6} style={{ marginTop: 16 }} />
      <Skeleton width={130} height={14} borderRadius={4} style={{ marginTop: 8 }} />
      <View style={styles.actionRowSkeleton}>
        <Skeleton width={110} height={40} borderRadius={20} />
        <Skeleton width={40} height={40} borderRadius={20} />
      </View>
    </View>
  );
};

export const DetailPageSkeleton: React.FC<{ rows?: number }> = ({ rows = 6 }) => {
  return (
    <View style={styles.pageSkeletonContainer}>
      <HeaderSkeleton />
      <View style={styles.listSkeleton}>
        {Array.from({ length: rows }).map((_, i) => (
          <SongSkeleton key={i} />
        ))}
      </View>
    </View>
  );
};

export const GridSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => {
  const cardWidth = 150;
  return (
    <View style={styles.gridContainer}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.gridItem}>
          <Skeleton width={cardWidth} height={cardWidth} borderRadius={12} />
          <Skeleton width={cardWidth * 0.8} height={14} style={{ marginTop: 8 }} />
          <Skeleton width={cardWidth * 0.5} height={12} style={{ marginTop: 4 }} />
        </View>
      ))}
    </View>
  );
};

export const PageSkeleton: React.FC = () => {
  return (
    <View style={styles.pageSkeletonContainer}>
      <View style={{ paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16 }}>
        <Skeleton width={220} height={28} borderRadius={6} />
        <Skeleton width={150} height={14} borderRadius={4} style={{ marginTop: 8 }} />
      </View>
      <CardSkeleton count={4} />
      <View style={{ marginTop: 16 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <SongSkeleton key={i} />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  songRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 16 },
  songInfo: { flex: 1, marginLeft: 12 },
  cardRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8 },
  cardItem: { marginRight: 12 },
  headerSkeleton: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 },
  actionRowSkeleton: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 20 },
  pageSkeletonContainer: { flex: 1, paddingTop: 16 },
  listSkeleton: { marginTop: 12 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingHorizontal: 16, paddingVertical: 12 },
  gridItem: { marginBottom: 12 },
});

export default Skeleton;
