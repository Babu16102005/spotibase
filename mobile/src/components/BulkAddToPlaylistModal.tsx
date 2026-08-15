import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { playlistApi } from '../api/client';
import { useThemeStore } from '../store';
import { PlaylistResponse } from '../types';
import Icon from './Icon';
import GlassButton from './GlassButton';

interface BulkAddToPlaylistModalProps {
  visible: boolean;
  songIds: string[];
  onClose: () => void;
  onSuccess: (playlistName: string, count: number) => void;
}

export const BulkAddToPlaylistModal: React.FC<BulkAddToPlaylistModalProps> = ({
  visible,
  songIds,
  onClose,
  onSuccess,
}) => {
  const { theme } = useThemeStore();
  const [playlists, setPlaylists] = useState<PlaylistResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingToId, setAddingToId] = useState<string | null>(null);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (visible) {
      fetchPlaylists();
      setShowCreateInput(false);
      setNewPlaylistName('');
      setAddingToId(null);
    }
  }, [visible]);

  const fetchPlaylists = async () => {
    setLoading(true);
    try {
      const res = await playlistApi.getAll();
      setPlaylists(res.data || []);
    } catch (e) {
      console.error('Failed to load playlists:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPlaylist = async (playlist: PlaylistResponse) => {
    if (addingToId || songIds.length === 0) return;
    setAddingToId(playlist.id);
    try {
      await playlistApi.addSongs(playlist.id, songIds);
      onSuccess(playlist.name, songIds.length);
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to add songs to playlist');
    } finally {
      setAddingToId(null);
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newPlaylistName.trim() || creating || songIds.length === 0) return;
    setCreating(true);
    try {
      const createRes = await playlistApi.create({
        name: newPlaylistName.trim(),
        isPublic: true,
      });
      const newPlaylist = createRes.data;
      if (newPlaylist?.id) {
        await playlistApi.addSongs(newPlaylist.id, songIds);
        onSuccess(newPlaylist.name, songIds.length);
        onClose();
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to create playlist');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
        testID="bulk-add-modal-backdrop"
      >
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.modalCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: theme.colors.text }]}>Add to Playlist</Text>
              <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                {songIds.length} {songIds.length === 1 ? 'song' : 'songs'} selected
              </Text>
            </View>
            <GlassButton
              variant="ghost"
              size="icon"
              icon="close"
              iconSize={16}
              onPress={onClose}
              style={{ width: 32, height: 32, borderRadius: 16 }}
            />
          </View>

          {/* New Playlist Row / Form */}
          {showCreateInput ? (
            <View style={styles.createForm}>
              <TextInput
                style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.background }]}
                placeholder="New Playlist Name..."
                placeholderTextColor={theme.colors.textSecondary}
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
                autoFocus
              />
              <View style={styles.createActions}>
                <GlassButton
                  variant="metal"
                  size="sm"
                  title="Cancel"
                  onPress={() => setShowCreateInput(false)}
                />
                <GlassButton
                  variant="primary"
                  size="sm"
                  title="Create & Add"
                  onPress={handleCreateAndAdd}
                  loading={creating}
                  disabled={creating || !newPlaylistName.trim()}
                />
              </View>
            </View>
          ) : (
            <GlassButton
              variant="metal"
              size="md"
              fullWidth
              icon="plus"
              iconSize={16}
              title="New Playlist"
              onPress={() => setShowCreateInput(true)}
              style={{ marginBottom: 12 }}
            />
          )}

          {/* List of existing playlists */}
          {loading ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </View>
          ) : (
            <FlatList
              data={playlists}
              keyExtractor={(item) => item.id}
              style={styles.list}
              renderItem={({ item }) => {
                const isAdding = addingToId === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.playlistRow, { borderBottomColor: theme.colors.border }]}
                    onPress={() => handleSelectPlaylist(item)}
                    disabled={Boolean(addingToId)}
                  >
                    <View style={styles.playlistIconWrap}>
                      <Icon name="music" size={18} color={theme.colors.textSecondary} />
                    </View>
                    <View style={styles.playlistInfo}>
                      <Text style={[styles.playlistName, { color: theme.colors.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[styles.playlistCount, { color: theme.colors.textTertiary }]}>
                        {item.songCount ?? 0} {item.songCount === 1 ? 'song' : 'songs'}
                      </Text>
                    </View>
                    {isAdding ? (
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                    ) : (
                      <Icon name="chevronRight" size={16} color={theme.colors.textSecondary} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                !loading ? (
                  <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                    No playlists found. Create one above!
                  </Text>
                ) : null
              }
            />
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    maxHeight: 520,
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  newPlaylistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  newPlaylistText: {
    fontSize: 14,
    fontWeight: '700',
  },
  createForm: {
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 8,
  },
  createActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  confirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  btnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  list: {
    maxHeight: 300,
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  playlistIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  playlistInfo: {
    flex: 1,
  },
  playlistName: {
    fontSize: 14,
    fontWeight: '600',
  },
  playlistCount: {
    fontSize: 12,
    marginTop: 2,
  },
  centerLoading: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 24,
    fontSize: 13,
  },
});

export default BulkAddToPlaylistModal;
