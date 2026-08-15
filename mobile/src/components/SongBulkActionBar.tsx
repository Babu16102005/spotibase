import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useThemeStore } from '../store';
import GlassButton from './GlassButton';

export interface SongBulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onClose: () => void;
  onAddToPlaylist: () => void;
  onDelete: () => void;
  deleteLabel?: string;
}

export const SongBulkActionBar: React.FC<SongBulkActionBarProps> = ({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  onClose,
  onAddToPlaylist,
  onDelete,
  deleteLabel = 'Delete',
}) => {
  const { theme } = useThemeStore();
  const allSelected = selectedCount > 0 && selectedCount === totalCount;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          shadowColor: '#000000',
        },
      ]}
      testID="song-bulk-action-bar"
    >
      <View style={styles.leftSection}>
        <GlassButton
          variant="ghost"
          size="icon"
          icon="close"
          iconSize={14}
          onPress={onClose}
          accessibilityLabel="Exit selection"
          style={{ width: 32, height: 32, borderRadius: 16 }}
        />
        <View style={[styles.countBadge, { backgroundColor: 'rgba(29, 185, 84, 0.2)' }]}>
          <Text style={[styles.countBadgeText, { color: theme.colors.primary }]}>{selectedCount}</Text>
        </View>
        <Text style={[styles.countLabel, { color: theme.colors.textSecondary }]} numberOfLines={1}>
          selected
        </Text>
      </View>

      <View style={styles.rightActions}>
        <GlassButton
          variant="metal"
          size="sm"
          title={allSelected ? 'None' : 'All'}
          onPress={allSelected ? onDeselectAll : onSelectAll}
          accessibilityLabel={allSelected ? 'Deselect all' : 'Select all'}
          style={{ height: 30, paddingHorizontal: 9, borderRadius: 15 }}
          textStyle={{ fontSize: 11 }}
        />

        <GlassButton
          variant="primary"
          size="sm"
          icon="plus"
          iconSize={12}
          title="Playlist"
          onPress={onAddToPlaylist}
          disabled={selectedCount === 0}
          accessibilityLabel="Add selected to playlist"
          style={{ height: 30, paddingHorizontal: 9, borderRadius: 15 }}
          textStyle={{ fontSize: 11 }}
        />

        <GlassButton
          variant="destructive"
          size="sm"
          icon="trash"
          iconSize={12}
          title={deleteLabel}
          onPress={onDelete}
          disabled={selectedCount === 0}
          accessibilityLabel="Delete selected"
          style={{ height: 30, paddingHorizontal: 9, borderRadius: 15 }}
          textStyle={{ fontSize: 11 }}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 84 : 76,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 1000,
    overflow: 'hidden',
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  closeBtn: {
    padding: 3,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  countLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
  },
  actionBtnSecondary: {
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnSecondaryText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actionBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 14,
  },
  actionBtnPrimaryText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actionBtnDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  actionBtnDangerText: {
    fontSize: 11,
    fontWeight: '700',
  },
});

export default SongBulkActionBar;
