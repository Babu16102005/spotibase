export interface UserResponse {
  id: string;
  email: string;
  username: string;
  avatarUrl?: string;
  coverUrl?: string;
  bio?: string;
  country?: string;
  favoriteGenres?: string[];
  role: 'USER' | 'PREMIUM_USER' | 'ARTIST' | 'ADMIN';
  emailVerified: boolean;
  totalListeningTimeMs: number;
  followerCount: number;
  followingCount: number;
  createdAt: string;
}

export interface SongResponse {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  albumArtistId?: string;
  albumArtistName?: string;
  albumId?: string;
  albumName?: string;
  genreId?: string;
  genreName?: string;
  language?: string;
  composer?: string;
  lyrics?: string;
  duration: string;
  durationMs: number;
  releaseDate: string;
  trackNumber: number;
  discNumber: number;
  fileUrl: string;
  coverUrl?: string;
  fileFormat: string;
  fileSize: number;
  bitrate: number;
  sampleRate: number;
  explicit: boolean;
  playCount: number;
  liked: boolean;
  createdAt: string;
  contributingArtists?: ContributingArtistDto[];
}

export interface ContributingArtistDto {
  artistId: string;
  artistName: string;
  role: 'PRIMARY' | 'FEATURING' | 'REMIXER' | 'PRODUCER' | 'WRITER' | 'VOCALIST' | 'COMPOSER' | 'ARRANGER' | 'MUSICIAN';
  position: number;
}

export interface AlbumResponse {
  id: string;
  name: string;
  description?: string;
  artistId: string;
  artistName: string;
  genreId?: string;
  genreName?: string;
  coverUrl?: string;
  releaseDate: string;
  songCount: number;
  totalDurationMs: number;
  type: string;
  featured: boolean;
  liked: boolean;
  songs?: SongResponse[];
  createdAt: string;
}

export interface ArtistResponse {
  id: string;
  name: string;
  bio?: string;
  imageUrl?: string;
  coverUrl?: string;
  monthlyListeners: number;
  followerCount: number;
  verified: boolean;
  followed: boolean;
  albumCount: number;
  songCount: number;
  createdAt: string;
}

export interface PlaylistResponse {
  id: string;
  name: string;
  description?: string;
  userId: string;
  username: string;
  coverUrl?: string;
  isPublic: boolean;
  isCollaborative: boolean;
  songCount: number;
  totalDurationMs: number;
  type: string;
  likeCount: number;
  liked: boolean;
  songs?: SongResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  user: UserResponse;
}

export interface HomeResponse {
  greeting: string;
  sections: HomeSection[];
}

export interface HomeSection {
  id: string;
  title: string;
  type: 'SONG' | 'ALBUM' | 'ARTIST' | 'PLAYLIST' | 'GENRE';
  subtitle?: string;
  items: SongResponse[] | AlbumResponse[] | ArtistResponse[] | PlaylistResponse[] | GenreItem[];
}

export interface GenreItem {
  id: string;
  name: string;
  imageUrl?: string;
  color?: string;
}

export interface SearchResponse {
  query: string;
  songs: SongResponse[];
  albums: AlbumResponse[];
  artists: ArtistResponse[];
  playlists: PlaylistResponse[];
  totalResults: number;
  page: number;
  size: number;
  hasMore: boolean;
}

export interface QueueResponse {
  songs: SongResponse[];
  currentSong?: SongResponse;
  currentPosition: number;
  totalSongs: number;
  totalDurationMs: number;
}

export interface LibraryResponse {
  playlists: PlaylistResponse[];
  albums: AlbumResponse[];
  artists: ArtistResponse[];
  likedSongs: SongResponse[];
  totalPlaylists: number;
  totalAlbums: number;
  totalArtists: number;
  totalLikedSongs: number;
}

export interface PagedResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}

export interface UserSettingsResponse {
  streamingQuality: string;
  downloadQuality: string;
  crossfadeDuration: number;
  gaplessEnabled: boolean;
  normalizeVolume: boolean;
  explicitFilter: boolean;
  monoAudio: boolean;
  bassBoost: number;
  treble: number;
  theme: 'DARK' | 'AMOLED' | 'LIGHT';
  language: string;
  wifiOnlyDownload: boolean;
  smartDownloads: boolean;
  autoPlay: boolean;
  sleepTimerMinutes: number;
}

export interface AdminDashboardResponse {
  totalUsers: number;
  activeUsers: number;
  totalSongs: number;
  totalAlbums: number;
  totalArtists: number;
  totalPlaylists: number;
  totalListeningHours: number;
  totalDownloads: number;
  topSongs: any[];
  topArtists: any[];
  topGenres: any[];
  userGrowth: any[];
  recentUsers: any[];
}

export interface NotificationResponse {
  id: string;
  type: string;
  title: string;
  body?: string;
  dataJson?: string;
  imageUrl?: string;
  isRead: boolean;
  createdAt: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreatePlaylistRequest {
  name: string;
  description?: string;
  isPublic?: boolean;
  isCollaborative?: boolean;
}

export interface UpdateProfileRequest {
  username?: string;
  bio?: string;
  country?: string;
  favoriteGenres?: string[];
}

export interface UpdateSettingsRequest {
  streamingQuality?: string;
  downloadQuality?: string;
  crossfadeDuration?: number;
  gaplessEnabled?: boolean;
  normalizeVolume?: boolean;
  explicitFilter?: boolean;
  monoAudio?: boolean;
  bassBoost?: number;
  treble?: number;
  theme?: 'DARK' | 'AMOLED' | 'LIGHT';
  language?: string;
  wifiOnlyDownload?: boolean;
  smartDownloads?: boolean;
  autoPlay?: boolean;
  sleepTimerMinutes?: number;
}

export type RepeatMode = 'off' | 'all' | 'one';
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'loading' | 'error';

export interface DownloadResponse {
  id: string;
  songId: string;
  filePath?: string;
  quality: string;
  status: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'FAILED' | 'PAUSED';
  fileSize: number;
  downloadedAt: string;
  lastPlayedAt: string;
}

export interface DownloadStatsResponse {
  count: number;
  totalSizeBytes: number;
}

export interface PlayerState {
  currentTrack: SongResponse | null;
  queue: SongResponse[];
  playbackState: PlaybackState;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  isMiniPlayer: boolean;
}
