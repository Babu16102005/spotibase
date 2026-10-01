import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  InteractionManager,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useThemeStore, useAuthStore } from '../../store';
import { HomeSection } from '../../types';
import SectionHeader from '../../components/SectionHeader';
import { CardSkeleton, SongSkeleton } from '../../components/SkeletonLoader';
import { getGreeting } from '../../utils';
import GreetingHeader from '../../components/GreetingHeader';
import { getSectionTier } from '../../cache/homeFeedCache';
import { useHomeTiers, type HomeTierParam } from '../../query/useHomeTiers';
import HomeSectionRow from './HomeSectionRow';

/** User-facing tier names for the inline error retry rows. */
const TIER_DISPLAY_NAMES: Record<HomeTierParam, string> = {
  critical: 'Critical',
  secondary: 'Secondary',
  heavy: 'Heavy',
};

const HomeScreen = ({ navigation }: any) => {
  const [refreshing, setRefreshing] = useState(false);
  // Heavy personalization rows mount after interactions so the critical
  // paint is never blocked (cached heavy still shows instantly — see below).
  const [heavyReady, setHeavyReady] = useState(false);
  const { theme } = useThemeStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const {
    data,
    tierSections,
    statusPerTier,
    refetchStale,
    refetchAll,
    refetchTier,
    abortAll,
  } = useHomeTiers({ enabled: isAuthenticated });

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      setHeavyReady(true);
    });
    return () => task.cancel();
  }, []);

  // Cached data paints immediately. Only stale tiers refetch
  // (stale-tier-only refetch); in-flight tier requests cancel on blur.
  // Greeting is refreshed inside the hook on every run so it stays correct
  // even on full cache hits.
  useFocusEffect(
    useCallback(() => {
      void refetchStale();
      return () => abortAll();
    }, [refetchStale, abortAll, isAuthenticated])
  );

  // Pull-to-refresh forces every tier (heavy is fetched, not deferred).
  const onRefresh = useCallback(async () => {
    if (!useAuthStore.getState().isAuthenticated) return;
    setRefreshing(true);
    try {
      await refetchAll();
    } finally {
      setRefreshing(false);
    }
  }, [refetchAll]);

  // Nested Tab -> Root navigation: YouTubeSongs lives on the RootStack, not
  // inside MainTabs, so navigate via the parent (falls back to direct for
  // tests / flat hierarchies).
  const goToYouTubeSongs = useCallback(() => {
    try {
      const parent = navigation?.getParent?.();
      if (parent?.navigate) {
        parent.navigate('YouTubeSongs');
        return;
      }
    } catch {}
    navigation?.navigate('YouTubeSongs');
  }, [navigation]);

  const onPillPress = useCallback(
    (pillLabel: string) => {
      if (pillLabel === 'Songs') {
        navigation?.navigate('Songs');
      } else if (
        pillLabel === 'Liked Songs' ||
        pillLabel === 'Albums' ||
        pillLabel === 'Playlists'
      ) {
        // Library hosts Liked Songs + Liked Albums + Your/Featured Playlists.
        navigation?.navigate('Library');
      } else {
        navigation?.navigate('Songs');
      }
    },
    [navigation]
  );

  // Heavy rows render once interactions settle — unless the heavy tier
  // already resolved from cache, in which case it paints immediately.
  const showHeavy =
    heavyReady || statusPerTier.heavy === 'success';

  // Order guaranteed: the hook merges critical (recently-played →
  // trending) → secondary → heavy; here we only gate heavy visibility.
  const visibleSections = useMemo(
    () =>
      data.sections.filter(
        (s: HomeSection) => showHeavy || getSectionTier(s) !== 'heavy'
      ),
    [data.sections, showHeavy]
  );

  // Per-section skeletons while a tier is pending — never a global spinner.
  // A tier with data renders its rows; only tiers with nothing yet show a
  // placeholder.
  const pendingSkeletonTiers = useMemo(
    () =>
      (['critical', 'secondary', 'heavy'] as HomeTierParam[]).filter(
        (tier) =>
          statusPerTier[tier] === 'pending' &&
          tierSections[tier].length === 0 &&
          (tier !== 'heavy' || showHeavy)
      ),
    [statusPerTier, tierSections, showHeavy]
  );

  // Inline retry rows for tiers that errored with nothing on screen, so
  // error+empty never looks blank (pull-to-refresh is no longer the only
  // recovery). Tiers with data keep their rows; only empty tiers show this.
  const errorRetryTiers = useMemo(
    () =>
      (['critical', 'secondary', 'heavy'] as HomeTierParam[]).filter(
        (tier) =>
          statusPerTier[tier] === 'error' &&
          tierSections[tier].length === 0 &&
          (tier !== 'heavy' || showHeavy)
      ),
    [statusPerTier, tierSections, showHeavy]
  );

  const handleRetryTier = useCallback(
    (tier: HomeTierParam) => {
      void refetchTier(tier);
    },
    [refetchTier]
  );

  const renderSection = useCallback(
    ({ item }: { item: HomeSection }) => (
      <HomeSectionRow
        section={item}
        navigation={navigation}
        onYouTubePress={goToYouTubeSongs}
      />
    ),
    [navigation, goToYouTubeSongs]
  );

  const keyExtractor = useCallback((item: HomeSection) => item.id, []);

  const listHeader = useMemo(
    () => (
      <GreetingHeader
        greetingText={data?.greeting ?? getGreeting()}
        loading={
          statusPerTier.critical === 'pending' &&
          tierSections.critical.length === 0
        }
        onPillPress={onPillPress}
      />
    ),
    [
      data?.greeting,
      onPillPress,
      statusPerTier.critical,
      tierSections.critical.length,
    ]
  );

  const listFooter = useMemo(() => {
    if (pendingSkeletonTiers.length === 0 && errorRetryTiers.length === 0) {
      return <View style={{ height: 100 }} />;
    }
    return (
      <View>
        {pendingSkeletonTiers.map((tier) => (
          <View key={`skeleton-${tier}`}>
            <SectionHeader title="Loading" subtitle=" " />
            {tier === 'critical' ? (
              <>
                <CardSkeleton count={5} />
                <SongSkeleton />
              </>
            ) : (
              <CardSkeleton count={3} />
            )}
          </View>
        ))}
        {errorRetryTiers.map((tier) => (
          <Pressable
            key={`retry-${tier}`}
            testID={`home-retry-${tier}`}
            accessibilityRole="button"
            accessibilityLabel={`Retry loading ${tier} sections`}
            accessibilityHint={`Reloads the ${TIER_DISPLAY_NAMES[tier]} home sections`}
            onPress={() => handleRetryTier(tier)}
            style={({ pressed }) => [
              styles.retryRow,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[styles.retryText, { color: theme.colors.textSecondary }]}
            >
              {`Couldn't load ${TIER_DISPLAY_NAMES[tier]} - Tap to retry`}
            </Text>
          </Pressable>
        ))}
        <View style={{ height: 100 }} />
      </View>
    );
  }, [pendingSkeletonTiers, errorRetryTiers, handleRetryTier, theme]);

  return (
    <FlatList
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      data={visibleSections}
      keyExtractor={keyExtractor}
      renderItem={renderSection}
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.primary}
        />
      }
      windowSize={5}
      maxToRenderPerBatch={4}
      initialNumToRender={4}
      removeClippedSubviews={false}
      accessibilityLabel="Home feed"
    />
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  retryRow: {
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default HomeScreen;
