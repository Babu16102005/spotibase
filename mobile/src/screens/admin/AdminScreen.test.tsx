import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import AdminScreen from './AdminScreen';
import { adminApi } from '../../api/client';

jest.mock('../../api/client', () => ({
  adminApi: {
    getDashboard: jest.fn(),
    forceDeleteSong: jest.fn(),
    featureSong: jest.fn(),
    forceDeletePlaylist: jest.fn(),
    featurePlaylist: jest.fn(),
  },
  songApi: {
    getAll: jest.fn().mockResolvedValue({ data: { content: [] } }),
    uploadBulk: jest.fn(),
  },
  playlistApi: {
    getFeatured: jest.fn().mockResolvedValue({ data: [] }),
    create: jest.fn(),
  },
}));

describe('AdminScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders skeleton loading then dashboard metrics', async () => {
    (adminApi.getDashboard as jest.Mock).mockResolvedValueOnce({
      data: {
        totalUsers: 100,
        activeUsers: 45,
        totalSongs: 1200,
        totalAlbums: 80,
        totalArtists: 60,
        totalPlaylists: 15,
        totalListeningHours: 450,
        totalDownloads: 300,
        totalStorageUsedBytes: 2147483648, // 2 GB
        maxStorageLimitBytes: 10737418240, // 10 GB
        storageLimitReached: false,
      },
    });

    const { getByText } = render(<AdminScreen />);
    await waitFor(() => {
      expect(getByText('Admin Panel')).toBeTruthy();
      expect(getByText('Cloudflare R2 Live Storage (10 GB Free Tier)')).toBeTruthy();
      expect(getByText('2.00 GB / 10.00 GB')).toBeTruthy();
      expect(getByText('Total Users')).toBeTruthy();
    });
  });

  it('handles 403 access denied gracefully', async () => {
    (adminApi.getDashboard as jest.Mock).mockRejectedValueOnce({
      response: { status: 403 },
    });

    const { getByText } = render(<AdminScreen />);
    await waitFor(() => {
      expect(getByText('Access Denied')).toBeTruthy();
    });
  });
});
