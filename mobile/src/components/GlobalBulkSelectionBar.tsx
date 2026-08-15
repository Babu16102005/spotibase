import React, { useState } from 'react';
import { View, Alert } from 'react-native';
import { useSelectionStore, useAuthStore } from '../store';
import { songApi, adminApi } from '../api/client';
import SongBulkActionBar from './SongBulkActionBar';
import BulkAddToPlaylistModal from './BulkAddToPlaylistModal';

export const GlobalBulkSelectionBar: React.FC = () => {
  const isSelectionMode = useSelectionStore((s) => s.isSelectionMode);
  const selectedSongIds = useSelectionStore((s) => s.selectedSongIds);
  const totalVisibleCount = useSelectionStore((s) => s.totalVisibleCount);
  const clear = useSelectionStore((s) => s.clear);
  const user = useAuthStore((s) => s.user);

  const [bulkAddModalVisible, setBulkAddModalVisible] = useState(false);
  const isAdmin = user?.role === 'ADMIN';

  if (!isSelectionMode || selectedSongIds.size === 0) {
    return null;
  }

  const selectedCount = selectedSongIds.size;
  const songIdsArray = Array.from(selectedSongIds);

  const handleBulkDelete = () => {
    Alert.alert(
      'Delete Selected Songs',
      `Are you sure you want to permanently delete or remove ${selectedCount} selected ${selectedCount === 1 ? 'song' : 'songs'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            for (const id of songIdsArray) {
              try {
                if (isAdmin) {
                  await adminApi.forceDeleteSong(id);
                } else {
                  await songApi.delete(id);
                }
              } catch (e) {
                // Ignore individual errors during bulk delete
              }
            }
            clear();
          },
        },
      ]
    );
  };

  return (
    <>
      <SongBulkActionBar
        selectedCount={selectedCount}
        totalCount={totalVisibleCount > 0 ? totalVisibleCount : selectedCount}
        onSelectAll={() => {}}
        onDeselectAll={() => clear()}
        onClose={() => clear()}
        onAddToPlaylist={() => setBulkAddModalVisible(true)}
        onDelete={handleBulkDelete}
        deleteLabel={isAdmin ? 'Delete' : 'Remove'}
      />

      <BulkAddToPlaylistModal
        visible={bulkAddModalVisible}
        songIds={songIdsArray}
        onClose={() => setBulkAddModalVisible(false)}
        onSuccess={() => {
          clear();
        }}
      />
    </>
  );
};

export default GlobalBulkSelectionBar;
