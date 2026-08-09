/**
 * Shared test fixtures. Test-only module — never imported by production code.
 */
import { SongResponse, UserResponse, AuthResponse } from '../types';

export const makeSong = (overrides: Partial<SongResponse> = {}): SongResponse => ({
  id: 'song-1',
  title: 'Test Song',
  artistId: 'artist-1',
  artistName: 'Test Artist',
  albumId: 'album-1',
  albumName: 'Test Album',
  genreId: 'genre-1',
  genreName: 'Rock',
  language: 'en',
  duration: '3:34',
  durationMs: 214000,
  releaseDate: '2024-01-15',
  trackNumber: 1,
  discNumber: 1,
  fileUrl: 'https://cdn.example.com/audio/song-1.mp3',
  coverUrl: 'https://cdn.example.com/art/song-1.jpg',
  fileFormat: 'MP3',
  fileSize: 8_500_000,
  bitrate: 320,
  sampleRate: 44100,
  explicit: false,
  playCount: 1200,
  liked: false,
  createdAt: '2024-01-10T00:00:00.000Z',
  ...overrides,
});

export const makeUser = (overrides: Partial<UserResponse> = {}): UserResponse => ({
  id: 'user-1',
  email: 'alice@example.com',
  username: 'alice',
  avatarUrl: 'https://cdn.example.com/avatars/alice.jpg',
  role: 'USER',
  emailVerified: true,
  totalListeningTimeMs: 0,
  followerCount: 0,
  followingCount: 0,
  createdAt: '2024-01-10T00:00:00.000Z',
  ...overrides,
});

export const makeAuthResponse = (overrides: Partial<AuthResponse> = {}): AuthResponse => ({
  accessToken: 'access-token-123',
  refreshToken: 'refresh-token-123',
  tokenType: 'Bearer',
  user: makeUser(),
  ...overrides,
});
