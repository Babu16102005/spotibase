import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Image,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SongResponse, PlaylistResponse } from '../types';
import { useThemeStore, usePlayerStore } from '../store';
import { playlistApi, songApi } from '../api/client';
import { coverSource, formatDuration } from '../utils';
import Icon from './Icon';
import GlassButton from './GlassButton';

interface SongOptionsMenuModalProps {
  visible: boolean;
  song: SongResponse | null;
  onClose: () => void;
  onSongUpdated?: (updatedSong: SongResponse) => void;
}

export const SongOptionsMenuModal: React.FC<SongOptionsMenuModalProps> = ({
  visible,
  song,
  onClose,
  onSongUpdated,
}) => {
  const { theme } = useThemeStore();
  const { addToQueue, queue } = usePlayerStore();

  const [view, setView] = useState<'options' | 'playlists' | 'create_playlist'>('options');
  const [playlists, setPlaylists] = useState<PlaylistResponse[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setView('options');
      setToastMessage(null);
      setNewPlaylistName('');
      setNewPlaylistDesc('');
    }
  }, [visible, song]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
      onClose();
    }, 1400);
  };

  const handleOpenPlaylists = async () => {
    setView('playlists');
    setLoadingPlaylists(true);
    try {
      const res = await playlistApi.getAll();
      setPlaylists(res.data || []);
    } catch (err) {
      console.error('Failed to load playlists:', err);
    } finally {
      setLoadingPlaylists(false);
    }
  };

  const handleAddToPlaylist = async (playlist: PlaylistResponse) => {
    if (!song) return;
    try {
      await playlistApi.addSongs(playlist.id, [song.id]);
      showToast(`Added to "${playlist.name}"`);
    } catch (err) {
      console.error('Failed adding song by ID to playlist:', err);
      showToast('Failed to add song to playlist');
    }
  };

  const handleCreateAndAdd = async () => {
    if (!song || !newPlaylistName.trim()) return;
    setCreatingPlaylist(true);
    try {
      const res = await playlistApi.create({
        name: newPlaylistName.trim(),
        description: newPlaylistDesc.trim() || undefined,
      });
      const created = res.data;
      await playlistApi.addSongs(created.id, [song.id]);
      showToast(`Created & added to "${created.name}"`);
    } catch (err) {
      console.error('Failed creating playlist:', err);
      showToast('Error creating playlist');
    } finally {
      setCreatingPlaylist(false);
    }
  };

  const handleToggleLike = async () => {
    if (!song) return;
    const nextLiked = !song.liked;
    const updated = { ...song, liked: nextLiked };
    if (onSongUpdated) onSongUpdated(updated);
    try {
      if (nextLiked) {
        await songApi.like(song.id);
        showToast('Added to Liked Songs');
      } else {
        await songApi.unlike(song.id);
        showToast('Removed from Liked Songs');
      }
    } catch (err) {
      console.error('Failed toggle like:', err);
      if (onSongUpdated) onSongUpdated(song);
    }
  };

  const handleAddToQueue = async () => {
    if (!song) return;
    await addToQueue(song);
    const capacityText = `Added to Queue (Capacity: ${Math.min(queue.length + 1, 5)}/5)`;
    showToast(capacityText);
  };

  if (!song) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          style={[
            styles.menuCard,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              boxShadow: theme.dark
                ? '0 20px 40px rgba(0,0,0,0.8)'
                : '0 20px 40px rgba(0,0,0,0.15)',
            } as any,
          ]}
          activeOpacity={1}
        >
          {/* Top Song Summary */}
          <View style={[styles.headerRow, { borderBottomColor: theme.colors.border }]}>
            <Image source={coverSource(song.coverUrl)} style={styles.songCover} />
            <View style={styles.songHeaderInfo}>
              <Text style={[styles.songTitle, { color: theme.colors.text }]} numberOfLines={1}>
                {song.title}
              </Text>
              <Text style={[styles.songArtist, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                {song.artistName} • {formatDuration(song.durationMs)}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="close" size={16} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Toast Notification Bar */}
          {toastMessage ? (
            <View style={[styles.toastBanner, { backgroundColor: theme.colors.primary }]}>
              <Text style={styles.toastText}>{toastMessage}</Text>
            </View>
          ) : null}

          {/* View Mode Switch */}
          {view === 'options' && (
            <ScrollView
              style={styles.optionsScrollView}
              contentContainerStyle={styles.optionsList}
              showsVerticalScrollIndicator={false}
            >
              {/* Option 1: Add to Playlist */}
              <TouchableOpacity
                style={[styles.optionItem, { backgroundColor: theme.colors.glass }]}
                onPress={handleOpenPlaylists}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBubble, { backgroundColor: theme.colors.surfaceLight }]}>
                  <Icon name="plus" size={16} color={theme.colors.primary} />
                </View>
                <View style={styles.optionTextContainer}>
                  <Text style={[styles.optionTitle, { color: theme.colors.text }]} numberOfLines={1}>
                    Add to Playlist
                  </Text>
                  <Text style={[styles.optionSub, { color: theme.colors.textTertiary }]} numberOfLines={2}>
                    Save by song ID to optimize storage
                  </Text>
                </View>
                <Icon name="chevronRight" size={16} color={theme.colors.textTertiary} />
              </TouchableOpacity>

              {/* Option 2: Like / Unlike */}
              <TouchableOpacity
                style={[styles.optionItem, { backgroundColor: theme.colors.glass }]}
                onPress={handleToggleLike}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBubble, { backgroundColor: theme.colors.surfaceLight }]}>
                  <Icon
                    name={song.liked ? 'heartFilled' : 'heart'}
                    size={16}
                    color={song.liked ? theme.colors.primary : theme.colors.textSecondary}
                  />
                </View>
                <View style={styles.optionTextContainer}>
                  <Text style={[styles.optionTitle, { color: theme.colors.text }]} numberOfLines={1}>
                    {song.liked ? 'Remove from Liked Songs' : 'Like Song'}
                  </Text>
                  <Text style={[styles.optionSub, { color: theme.colors.textTertiary }]} numberOfLines={2}>
                    {song.liked ? 'In your Liked Songs library' : 'Save to your Liked Songs'}
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Option 3: Add to Queue */}
              <TouchableOpacity
                style={[styles.optionItem, { backgroundColor: theme.colors.glass }]}
                onPress={handleAddToQueue}
                activeOpacity={0.7}
              >
                <View style={[styles.iconBubble, { backgroundColor: theme.colors.surfaceLight }]}>
                  <Icon name="queue" size={16} color={theme.colors.textSecondary} />
                </View>
                <View style={styles.optionTextContainer}>
                  <Text style={[styles.optionTitle, { color: theme.colors.text }]} numberOfLines={1}>
                    Add to Queue
                  </Text>
                  <Text style={[styles.optionSub, { color: theme.colors.textTertiary }]} numberOfLines={2}>
                    Capacity up to 5 songs in queue cache
                  </Text>
                </View>
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* View Mode: Playlists List */}
          {view === 'playlists' && (
            <View style={styles.subViewContainer}>
              <View style={styles.subViewHeader}>
                <TouchableOpacity onPress={() => setView('options')} style={styles.backBtn}>
                  <Icon name="chevronLeft" size={16} color={theme.colors.text} />
                  <Text style={[styles.backText, { color: theme.colors.text }]}>Back</Text>
                </TouchableOpacity>
                <Text style={[styles.subViewTitle, { color: theme.colors.text }]}>Select Playlist</Text>
              </View>

              <TouchableOpacity
                style={[styles.createCard, { borderColor: theme.colors.primary, backgroundColor: theme.colors.glass }]}
                onPress={() => setView('create_playlist')}
              >
                <Icon name="plus" size={18} color={theme.colors.primary} />
                <Text style={[styles.createCardText, { color: theme.colors.primary }]}>
                  + Create New Playlist
                </Text>
              </TouchableOpacity>

              {loadingPlaylists ? (
                <ActivityIndicator color={theme.colors.primary} style={{ marginVertical: 20 }} />
              ) : (
                <ScrollView style={styles.playlistsScroll} nestedScrollEnabled>
                  {playlists.map((pl) => (
                    <TouchableOpacity
                      key={pl.id}
                      style={[styles.playlistRow, { borderBottomColor: theme.colors.border }]}
                      onPress={() => handleAddToPlaylist(pl)}
                    >
                      <Image source={coverSource(pl.coverUrl)} style={styles.playlistCover} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.playlistName, { color: theme.colors.text }]} numberOfLines={1}>
                          {pl.name}
                        </Text>
                        <Text style={[styles.playlistMeta, { color: theme.colors.textTertiary }]}>
                          {pl.songCount} {pl.songCount === 1 ? 'song' : 'songs'} • Saved by ID
                        </Text>
                      </View>
                      <Icon name="plus" size={14} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                  {playlists.length === 0 && (
                    <Text style={[styles.emptyText, { color: theme.colors.textTertiary }]}>
                      No playlists found. Create one above!
                    </Text>
                  )}
                </ScrollView>
              )}
            </View>
          )}

          {/* View Mode: Create Playlist */}
          {view === 'create_playlist' && (
            <View style={styles.subViewContainer}>
              <View style={styles.subViewHeader}>
                <TouchableOpacity onPress={() => setView('playlists')} style={styles.backBtn}>
                  <Icon name="chevronLeft" size={16} color={theme.colors.text} />
                  <Text style={[styles.backText, { color: theme.colors.text }]}>Back</Text>
                </TouchableOpacity>
                <Text style={[styles.subViewTitle, { color: theme.colors.text }]}>New Playlist</Text>
              </View>

              <Text style={[styles.inputLabel, { color: theme.colors.textSecondary }]}>Playlist Title</Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.background, color: theme.colors.text, borderColor: theme.colors.border }]}
                placeholder="My Awesome Playlist"
                placeholderTextColor={theme.colors.textTertiary}
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
                autoFocus
              />

              <Text style={[styles.inputLabel, { color: theme.colors.textSecondary, marginTop: 8 }]}>
                Description (Optional)
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: theme.colors.background, color: theme.colors.text, borderColor: theme.colors.border }]}
                placeholder="Collection of top tracks"
                placeholderTextColor={theme.colors.textTertiary}
                value={newPlaylistDesc}
                onChangeText={setNewPlaylistDesc}
              />

              <GlassButton
                variant="primary"
                size="lg"
                fullWidth
                title="Create & Add Song by ID"
                disabled={!newPlaylistName.trim() || creatingPlaylist}
                loading={creatingPlaylist}
                onPress={handleCreateAndAdd}
                style={{ marginTop: 12 }}
              />
            </View>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  menuCard: {
    width: '92%',
    maxWidth: 390,
    maxHeight: '85%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 10,
  },
  songCover: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
  songHeaderInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
    minWidth: 0,
  },
  songTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  songArtist: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
  },
  toastBanner: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
    alignItems: 'center',
  },
  toastText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
  optionsScrollView: {
    maxHeight: 380,
  },
  optionsList: {
    gap: 8,
    paddingBottom: 4,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    width: '100%',
    ...(Platform.OS === 'web' ? { transition: 'background-color 0.2s ease' } : {}),
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  optionTextContainer: {
    flex: 1,
    marginLeft: 12,
    marginRight: 6,
    minWidth: 0,
  },
  optionTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  optionSub: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  subViewContainer: {
    paddingTop: 4,
  },
  subViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 10,
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
  subViewTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  createCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 12,
  },
  createCardText: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  playlistsScroll: {
    maxHeight: 200,
  },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 0.5,
  },
  playlistCover: {
    width: 36,
    height: 36,
    borderRadius: 4,
  },
  playlistName: {
    fontSize: 13,
    fontWeight: '600',
  },
  playlistMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  emptyText: {
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    marginBottom: 8,
  },
  submitBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
  },
  submitBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default SongOptionsMenuModal;
