import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import BulkAddToPlaylistModal from './BulkAddToPlaylistModal';
import { playlistApi } from '../api/client';

jest.mock('../api/client', () => ({
  playlistApi: {
    getAll: jest.fn(),
    addSongs: jest.fn(),
    create: jest.fn(),
  },
}));

describe('BulkAddToPlaylistModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders playlists and adds selected songs on click', async () => {
    (playlistApi.getAll as jest.Mock).mockResolvedValueOnce({
      data: [
        { id: 'p1', name: 'My Workout Mix', songCount: 5 },
        { id: 'p2', name: 'Chill Vibes', songCount: 12 },
      ],
    });
    (playlistApi.addSongs as jest.Mock).mockResolvedValueOnce({});

    const onClose = jest.fn();
    const onSuccess = jest.fn();

    const { getByText } = render(
      <BulkAddToPlaylistModal
        visible={true}
        songIds={['s1', 's2', 's3']}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    await waitFor(() => {
      expect(getByText('Add to Playlist')).toBeTruthy();
      expect(getByText('3 songs selected')).toBeTruthy();
      expect(getByText('My Workout Mix')).toBeTruthy();
      expect(getByText('Chill Vibes')).toBeTruthy();
    });

    fireEvent.press(getByText('My Workout Mix'));

    await waitFor(() => {
      expect(playlistApi.addSongs).toHaveBeenCalledWith('p1', ['s1', 's2', 's3']);
      expect(onSuccess).toHaveBeenCalledWith('My Workout Mix', 3);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('creates a new playlist and adds songs', async () => {
    (playlistApi.getAll as jest.Mock).mockResolvedValueOnce({ data: [] });
    (playlistApi.create as jest.Mock).mockResolvedValueOnce({
      data: { id: 'p-new', name: 'Roadtrip 2026' },
    });
    (playlistApi.addSongs as jest.Mock).mockResolvedValueOnce({});

    const onClose = jest.fn();
    const onSuccess = jest.fn();

    const { getByText, getByPlaceholderText } = render(
      <BulkAddToPlaylistModal
        visible={true}
        songIds={['s1']}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    );

    await waitFor(() => {
      expect(getByText('New Playlist')).toBeTruthy();
    });

    fireEvent.press(getByText('New Playlist'));

    const input = getByPlaceholderText('New Playlist Name...');
    fireEvent.changeText(input, 'Roadtrip 2026');

    fireEvent.press(getByText('Create & Add'));

    await waitFor(() => {
      expect(playlistApi.create).toHaveBeenCalledWith({
        name: 'Roadtrip 2026',
        isPublic: true,
      });
      expect(playlistApi.addSongs).toHaveBeenCalledWith('p-new', ['s1']);
      expect(onSuccess).toHaveBeenCalledWith('Roadtrip 2026', 1);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
