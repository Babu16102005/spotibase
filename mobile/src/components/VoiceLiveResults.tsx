import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import type { SongResponse } from '../types';
import type { Theme } from '../theme';

export interface VoiceLiveResultsProps {
  theme: Theme;
  loading: boolean;
  songs: SongResponse[];
  error: string | null;
  query: string;
  onSelect: (songs: SongResponse[], index: number) => void;
  onRetry: () => void;
  onTypeInstead: () => void;
}

const SKELETON_ROWS = 3;

/**
 * Live voice-search results: skeleton while the debounced partial fetch is
 * in flight, top-5 song chips when it resolves, and a Retry + Type-instead
 * row when it fails. Rendered only while listening/thinking (parent gates).
 */
export const VoiceLiveResults: React.FC<VoiceLiveResultsProps> = ({
  theme,
  loading,
  songs,
  error,
  query,
  onSelect,
  onRetry,
  onTypeInstead,
}) => {
  if (!loading && songs.length === 0 && !error) return null;

  const liveLabel = query
    ? `Live voice results for ${query}`
    : 'Live voice results';
  const statusLabel = loading
    ? `${liveLabel}. Searching as you speak.`
    : error && songs.length === 0
      ? `${liveLabel}. ${error}`
      : `${liveLabel}. ${songs.length} song${songs.length === 1 ? '' : 's'} found.`;

  return (
    <View
      testID="voice-live-results"
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={statusLabel}
      style={[
        styles.wrap,
        {
          backgroundColor: theme.colors.background,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <Text
          style={[styles.title, { color: theme.colors.textSecondary }]}
          numberOfLines={1}
        >
          Live{query ? ` · “${query}”` : ''}
        </Text>
        {loading && (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        )}
      </View>

      {loading && songs.length === 0 && (
        <View
          accessible
          accessibilityLabel="Finding songs as you speak"
          accessibilityRole="progressbar"
          style={styles.skeletonList}
        >
          {[...Array(SKELETON_ROWS)].map((_, i) => (
            <View
              key={`live-skeleton-${i}`}
              importantForAccessibility="no-hide-descendants"
              style={[styles.skeletonRow, { borderColor: theme.colors.border }]}
            >
              <View
                style={[
                  styles.skeletonCover,
                  { backgroundColor: theme.colors.skeleton },
                ]}
              />
              <View style={styles.skeletonLines}>
                <View
                  style={[
                    styles.skeletonLine,
                    { backgroundColor: theme.colors.skeleton },
                  ]}
                />
                <View
                  style={[
                    styles.skeletonLineShort,
                    { backgroundColor: theme.colors.skeleton },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {songs.map((song, idx) => (
        <TouchableOpacity
          key={song.id}
          testID={`voice-live-chip-${song.id}`}
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Play ${song.title} by ${song.artistName}`}
          accessibilityHint="Stops listening and plays this song immediately"
          activeOpacity={0.7}
          onPress={() => onSelect(songs, idx)}
          style={[styles.chip, { borderColor: theme.colors.border }]}
        >
          <Text
            style={[styles.chipPlay, { color: theme.colors.primary }]}
            accessibilityElementsHidden
          >
            ▶
          </Text>
          <Text
            style={[styles.chipText, { color: theme.colors.text }]}
            numberOfLines={1}
          >
            {song.title}
            <Text style={{ color: theme.colors.textSecondary }}>
              {' '}
              · {song.artistName}
            </Text>
          </Text>
        </TouchableOpacity>
      ))}

      {!!error && songs.length === 0 && (
        <View style={styles.errorRow}>
          <Text
            style={[styles.errorText, { color: theme.colors.error }]}
            accessibilityLiveRegion="polite"
          >
            {error}
          </Text>
          <View style={styles.errorActions}>
            <TouchableOpacity
              testID="voice-live-retry"
              accessible
              accessibilityRole="button"
              accessibilityLabel="Retry live results"
              onPress={onRetry}
              style={[
                styles.actionBtn,
                { backgroundColor: theme.colors.primary },
              ]}
            >
              <Text style={styles.actionBtnText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="voice-live-type-instead"
              accessible
              accessibilityRole="button"
              accessibilityLabel="Type your command instead"
              onPress={onTypeInstead}
              style={[
                styles.actionBtn,
                styles.ghostBtn,
                { borderColor: theme.colors.border },
              ]}
            >
              <Text
                style={[styles.ghostBtnText, { color: theme.colors.text }]}
              >
                Type instead
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!!error && songs.length > 0 && (
        <TouchableOpacity
          testID="voice-live-retry-inline"
          accessible
          accessibilityRole="button"
          accessibilityLabel={`Live update failed. Tap to retry results for ${query}`}
          onPress={onRetry}
          style={styles.inlineRetry}
        >
          <Text
            style={[styles.inlineRetryText, { color: theme.colors.warning }]}
          >
            Live update failed — tap to retry
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginTop: 12,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    flex: 1,
  },
  skeletonList: {
    gap: 8,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 8,
    opacity: 0.75,
  },
  skeletonCover: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  skeletonLines: {
    flex: 1,
    gap: 6,
  },
  skeletonLine: {
    height: 10,
    borderRadius: 5,
    width: '70%',
  },
  skeletonLineShort: {
    height: 10,
    borderRadius: 5,
    width: '45%',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 44,
  },
  chipPlay: {
    fontSize: 11,
    fontWeight: '800',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  errorRow: {
    gap: 10,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  errorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 18,
    minHeight: 44,
    justifyContent: 'center',
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  ghostBtn: {
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  ghostBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  inlineRetry: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 4,
    minHeight: 32,
    justifyContent: 'center',
  },
  inlineRetryText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

export default VoiceLiveResults;
