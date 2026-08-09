import React, { useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  Modal,
  ActivityIndicator,
  Image,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useDownloadStore } from '../../store/downloadStore';
import { usePlayerStore } from '../../store/playerStore';
import { useAuthStore } from '../../store/authStore';
import { useThemeStore } from '../../store';
import { formatFileSize } from '../../utils';
import SongCard from '../../components/SongCard';

interface DownloadsScreenProps {
  navigation: any;
}

const DownloadsScreen = ({ navigation }: DownloadsScreenProps) => {
  const { theme } = useThemeStore();
  const { downloads, stats, isLoading, fetchDownloads, deleteDownload, clearCompleted, isDownloaded, isDownloading } = useDownloadStore();
  const { play, playMultiple } = usePlayerStore();
  const { user } = useAuthStore();
  const [refreshing, setRefreshing] = React.useState(false);
  const [showClearModal, setShowClearModal] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  useEffect(() => {
    fetchDownloads();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDownloads();
    setRefreshing(false);
  };

  const handlePlayDownload = (song: any) => {
    const download = downloads.find(d => d.songId === song.id);
    if (download?.filePath) {
      // Play from local file
      play({ ...song, fileUrl: download.filePath });
    } else {
      // Fallback to streaming
      play(song);
    }
  };

  const handlePlayAll = () => {
    const completedDownloads = downloads.filter(d => d.status === 'COMPLETED');
    if (completedDownloads.length > 0) {
      // We'd need to fetch full song data for these
      // For now, just navigate to player with first song
      const firstSong = completedDownloads[0];
      // This would need the full song object
    }
  };

  const handleDeleteDownload = async (songId: string) => {
    setDeletingId(songId);
    try {
      await deleteDownload(songId);
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearCompleted = async () => {
    await clearCompleted();
    setShowClearModal(false);
  };

  if (!user) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
          Please log in to view downloads
        </Text>
      </View>
    );
  }

  const completedDownloads = downloads.filter(d => d.status === 'COMPLETED');
  const pendingDownloads = downloads.filter(d => d.status === 'DOWNLOADING' || d.status === 'PENDING');
  const failedDownloads = downloads.filter(d => d.status === 'FAILED');

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Stats Header */}
      <View style={styles.statsContainer}>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: theme.colors.text }]}>
            {stats?.count || completedDownloads.length}
          </Text>
          <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Songs</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: theme.colors.text }]}>
            {stats ? formatFileSize(stats.totalSizeBytes) : '0 B'}
          </Text>
          <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Storage</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: theme.colors.text }]}>
            {pendingDownloads.length}
          </Text>
          <Text style={[styles.statLabel, { color: theme.colors.textSecondary }]}>Pending</Text>
        </View>
      </View>

      {/* Pending Downloads */}
      {pendingDownloads.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Downloading</Text>
          <FlatList
            data={pendingDownloads}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <DownloadListItem
                download={item}
                theme={theme}
                onPress={() => {}}
                onDelete={handleDeleteDownload}
                deleting={deletingId === item.songId}
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </View>
      )}

      {/* Completed Downloads */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
            Downloads ({completedDownloads.length})
          </Text>
          {completedDownloads.length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => setShowClearModal(true)}
            >
              <Text style={[styles.clearButtonText, { color: theme.colors.error }]}>Clear All</Text>
            </TouchableOpacity>
          )}
        </View>

        {completedDownloads.length === 0 ? (
          <View style={[styles.emptyState, { borderColor: theme.colors.border }]}>
            <Ionicons name="cloud-download-outline" size={64} color={theme.colors.textTertiary} />
            <Text style={[styles.emptyText, { color: theme.colors.textSecondary, marginTop: 16 }]}>
              No downloads yet
            </Text>
            <Text style={[styles.emptySubtext, { color: theme.colors.textTertiary, marginTop: 8 }]}>
              Download songs for offline listening
            </Text>
          </View>
        ) : (
          <FlatList
            data={completedDownloads}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <DownloadListItem
                download={item}
                theme={theme}
                onPress={() => {
                  // Navigate to song or play
                }}
                onDelete={handleDeleteDownload}
                deleting={deletingId === item.songId}
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[theme.colors.primary]}
                progressBackgroundColor={theme.colors.surface}
              />
            }
          />
        )}
      </View>

      {/* Failed Downloads */}
      {failedDownloads.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.colors.error }]}>Failed</Text>
          <FlatList
            data={failedDownloads}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <DownloadListItem
                download={item}
                theme={theme}
                onPress={() => {
                  // Retry download - would need to re-fetch song and start download
                }}
                onDelete={handleDeleteDownload}
                deleting={deletingId === item.songId}
                isFailed
              />
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </View>
      )}

      {/* Clear Modal */}
      <Modal visible={showClearModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Clear All Downloads?</Text>
            <Text style={[styles.modalText, { color: theme.colors.textSecondary, marginBottom: 24 }]}>
              This will remove all {completedDownloads.length} downloaded songs and free up {stats ? formatFileSize(stats.totalSizeBytes) : 'storage space'}. This action cannot be undone.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalButtonCancel}
                onPress={() => setShowClearModal(false)}
              >
                <Text style={[styles.modalButtonText, { color: theme.colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButtonConfirm, { backgroundColor: theme.colors.error }]}
                onPress={handleClearCompleted}
              >
                <Text style={styles.modalButtonTextConfirm}>Clear All</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

interface DownloadListItemProps {
  download: any;
  theme: any;
  onPress: () => void;
  onDelete: (songId: string) => void;
  deleting?: boolean;
  isFailed?: boolean;
}

const DownloadListItem = React.memo(({
  download,
  theme,
  onPress,
  onDelete,
  deleting,
  isFailed,
}: DownloadListItemProps) => (
  <TouchableOpacity
    style={[
      styles.listItem,
      { backgroundColor: theme.colors.surface },
    ]}
    onPress={onPress}
    activeOpacity={0.8}
  >
    <View style={styles.songInfo}>
      <View style={[styles.cover, { backgroundColor: theme.colors.surfaceLight }]}>
        {download.coverUrl ? (
          <Image source={{ uri: download.coverUrl }} style={styles.coverImage} />
        ) : (
          <Ionicons name="musical-notes-outline" size={24} color={theme.colors.textTertiary} />
        )}
        {deleting && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
          </View>
        )}
      </View>
      <View style={styles.textContainer}>
        <Text
          numberOfLines={1}
          style={[styles.songTitle, { color: theme.colors.text }]}
        >
          {download.songTitle || 'Unknown Song'}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.songArtist, { color: theme.colors.textSecondary }]}
        >
          {download.artistName || 'Unknown Artist'}
        </Text>
        <View style={styles.statusRow}>
          {isFailed && (
            <View style={styles.failedBadge}>
              <Ionicons name="alert-circle-outline" size={12} color={theme.colors.error} />
              <Text style={[styles.badgeText, { color: theme.colors.error }]}>Failed</Text>
            </View>
          )}
          <Text style={[styles.fileSize, { color: theme.colors.textTertiary }]}>
            {formatFileSize(download.fileSize)}
          </Text>
          <Text style={[styles.quality, { color: theme.colors.primary }]}>
            {download.quality}
          </Text>
        </View>
      </View>
    </View>
    <TouchableOpacity
      style={styles.deleteButton}
      onPress={() => onDelete(download.songId)}
      disabled={deleting}
      activeOpacity={0.7}
    >
      <Ionicons
        name={deleting ? 'time-outline' : 'trash-outline'}
        size={22}
        color={theme.colors.textTertiary}
      />
    </TouchableOpacity>
  </TouchableOpacity>
));

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 16,
    borderBottomWidth: 0.5,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 0.5,
    height: 40,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  section: {
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  clearButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  songInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cover: {
    width: 56,
    height: 56,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
    justifyContent: 'center',
  },
  songTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  songArtist: {
    fontSize: 14,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 12,
  },
  failedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  fileSize: {
    fontSize: 12,
  },
  quality: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  deleteButton: {
    padding: 8,
  },
  emptyState: {
    alignItems: 'center',
    padding: 48,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 16,
    marginVertical: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
  },
  separator: {
    height: 0.5,
    marginLeft: 76,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    borderRadius: 16,
    padding: 24,
    maxWidth: 400,
    width: '100%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
  modalText: {
    fontSize: 16,
    lineHeight: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButtonCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalButtonConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextConfirm: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

export default DownloadsScreen;