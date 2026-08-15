import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { songApi } from '../api/client';
import { useThemeStore } from '../store';
import { PickedSongFile } from '../types';
import { formatFileSize } from '../utils';
import GlassButton from './GlassButton';

/**
 * Admin-only bulk song uploader (used on the Profile screen).
 * Opens the device's document/file picker with multi-select, so admins can
 * choose one or many audio files "like sending a message from a mobile device".
 * Files are uploaded unchanged (FLAC stays FLAC); metadata is parsed from the
 * audio tags server-side.
 */
const SongUploader = ({ onUploaded }: { onUploaded?: (count: number) => void }) => {
  const { theme } = useThemeStore();
  const [picked, setPicked] = useState<PickedSongFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const pickFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const files = result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        size: a.size ?? 0,
        mimeType: a.mimeType || 'audio/flac',
      }));
      setPicked((prev) => [...prev, ...files]);
      setStatus(null);
    } catch (err) {
      console.error('File pick failed:', err);
      setStatus({ type: 'error', text: 'Could not open the file picker' });
    }
  };

  const removeFile = (uri: string) => setPicked((prev) => prev.filter((f) => f.uri !== uri));

  const upload = async () => {
    if (picked.length === 0 || uploading) return;
    setUploading(true);
    setProgress(0);
    setStatus(null);
    try {
      const requests = picked.map((f) => ({ title: f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ') }));
      await songApi.uploadBulk(picked, requests, (loaded, total) => {
        setProgress(total > 0 ? Math.min(loaded / total, 1) : 0);
      });
      setStatus({ type: 'success', text: `${picked.length} song${picked.length > 1 ? 's' : ''} uploaded successfully` });
      setPicked([]);
      setProgress(0);
      onUploaded?.(picked.length);
    } catch (err: any) {
      console.error('Upload failed:', err);
      setStatus({
        type: 'error',
        text: err?.response?.data?.message || 'Upload failed. Check the file types and try again.',
      });
    } finally {
      setUploading(false);
    }
  };

  const totalSize = picked.reduce((sum, f) => sum + (f.size || 0), 0);

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Upload Songs</Text>
      <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>
        Pick one or multiple audio files (FLAC, MP3, WAV...) from your device. Titles, artists and
        durations are read automatically from the audio tags. Storage is managed under the 10 GB free tier
        with an automated 9.5 GB safety cap.
      </Text>

      <GlassButton
        variant="primary"
        size="lg"
        fullWidth
        icon="folder"
        iconSize={18}
        title={Platform.OS === 'web' ? 'Select Audio Files' : 'Choose from Device'}
        onPress={pickFiles}
        disabled={uploading}
      />

      {picked.length > 0 && (
        <>
          <View style={styles.fileList}>
            {picked.map((f, i) => (
              <View key={f.uri + i} style={[styles.fileRow, { borderBottomColor: theme.colors.border }]}>
                <View style={styles.fileInfo}>
                  <Text style={[styles.fileName, { color: theme.colors.text }]} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={[styles.fileSize, { color: theme.colors.textTertiary }]}>
                    {formatFileSize(f.size || 0)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => removeFile(f.uri)} disabled={uploading} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[styles.removeText, { color: theme.colors.error }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={styles.uploadRow}>
            <Text style={[styles.totalText, { color: theme.colors.textSecondary }]}>
              {picked.length} file{picked.length > 1 ? 's' : ''} • {formatFileSize(totalSize)}
            </Text>
            <GlassButton
              variant="primary"
              size="md"
              icon="upload"
              iconSize={16}
              title={uploading ? 'Uploading...' : 'Upload'}
              onPress={upload}
              loading={uploading}
              disabled={uploading}
            />
          </View>
        </>
      )}

      {uploading && (
        <View style={[styles.progressTrack, { backgroundColor: theme.colors.surfaceLight }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: theme.colors.primary }]} />
        </View>
      )}

      {status && (
        <Text
          style={[
            styles.status,
            { color: status.type === 'success' ? theme.colors.success : theme.colors.error },
          ]}
        >
          {status.text}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { paddingHorizontal: 24, paddingVertical: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 6 },
  hint: { fontSize: 12, lineHeight: 18, marginBottom: 12 },
  fileList: { marginTop: 12 },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 0.5,
  },
  info: { flex: 1, marginRight: 8 },
  fileInfo: { flex: 1, marginRight: 8 },
  fileName: { fontSize: 13, fontWeight: '500' },
  fileSize: { fontSize: 11, marginTop: 2 },
  removeText: { fontSize: 12, fontWeight: '600' },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  totalText: { fontSize: 12 },
  progressTrack: { height: 4, borderRadius: 2, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  status: { fontSize: 13, marginTop: 10, fontWeight: '600' },
});

export default SongUploader;
