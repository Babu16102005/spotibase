package com.spotibase.service;

import com.spotibase.dto.request.CreateSongRequest;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.*;
import com.spotibase.exception.BadRequestException;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.jaudiotagger.audio.AudioFile;
import org.jaudiotagger.audio.AudioFileIO;
import org.jaudiotagger.audio.AudioHeader;
import org.jaudiotagger.tag.FieldKey;
import org.jaudiotagger.tag.Tag;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.File;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class SongService {

    private final SongRepository songRepository;
    private final ArtistRepository artistRepository;
    private final AlbumRepository albumRepository;
    private final GenreRepository genreRepository;
    private final LikeRepository likeRepository;
    private final RecentlyPlayedRepository recentlyPlayedRepository;
    private final ListeningHistoryRepository listeningHistoryRepository;
    private final StorageService storageService;
    private final SongContributingArtistRepository contributingArtistRepository;
    private final UserRepository userRepository;

    public SongResponse getSongById(String id, String userId) {
        Song song = songRepository.findByIdWithDetails(id)
                .orElseThrow(() -> new ResourceNotFoundException("Song", id));
        return toSongResponse(song, userId);
    }

    public Song getSongEntityById(String id) {
        return songRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Song", id));
    }

    public PagedResponse<SongResponse> getAllSongs(int page, int size, String userId) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<Song> songPage = songRepository.findAllActive(pageable);
        List<SongResponse> songs = songPage.getContent().stream()
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());
        return toPagedResponse(songPage, songs);
    }

    @Transactional
    @CacheEvict(value = {"home", "recommendations"}, allEntries = true)
    public SongResponse createSong(CreateSongRequest request, MultipartFile audioFile, MultipartFile coverFile) {
        ParsedAudioTags tags = (audioFile != null && !audioFile.isEmpty()) ? parseAudioMetadata(audioFile) : ParsedAudioTags.EMPTY;
        return createSongInternal(request, audioFile, coverFile, tags);
    }

    @Transactional
    @CacheEvict(value = {"home", "recommendations"}, allEntries = true)
    public SongResponse createSongInternal(CreateSongRequest request, MultipartFile audioFile, MultipartFile coverFile, ParsedAudioTags tags) {
        // Resolve primary artist (optional - create "Unknown Artist" if not provided)
        Artist artist;
        if (request.getArtistId() != null && !request.getArtistId().isBlank()) {
            artist = resolveArtist(request.getArtistId());
        } else if (request.getArtistName() != null && !request.getArtistName().isBlank()) {
            artist = resolveArtistByName(request.getArtistName());
        } else {
            artist = resolveArtist(null);
        }

        Song.SongBuilder builder = Song.builder()
                .name(request.getTitle())  // use title field
                .artist(artist)
                .language(request.getLanguage() != null ? request.getLanguage() : tags.language)
                .composer(request.getComposer() != null ? request.getComposer() : tags.composer)
                .lyrics(request.getLyrics() != null ? request.getLyrics() : tags.lyrics)
                .releaseDate(request.getReleaseDate() != null ? request.getReleaseDate() : (tags.releaseDate != null ? tags.releaseDate : LocalDate.now()))
                .trackNumber(request.getTrackNumber() > 0 ? request.getTrackNumber() : tags.trackNumber)
                .discNumber(request.getDiscNumber() > 0 ? request.getDiscNumber() : tags.discNumber)
                .explicit(request.isExplicit())
                .fileFormat(request.getFileFormat() != null ? request.getFileFormat() : tags.format);

        // Album (optional) - by id, else by name (auto-created), else from tags
        Album album = null;
        if (request.getAlbumId() != null && !request.getAlbumId().isBlank()) {
            album = albumRepository.findById(request.getAlbumId())
                    .orElseThrow(() -> new ResourceNotFoundException("Album", request.getAlbumId()));
        } else if (request.getAlbumName() != null && !request.getAlbumName().isBlank()) {
            album = resolveAlbumByName(request.getAlbumName(), artist);
        } else if (tags.album != null && !tags.album.isBlank()) {
            album = resolveAlbumByName(tags.album, artist);
        }
        if (album != null) {
            builder.album(album);
            if (album.getGenre() != null) builder.genre(album.getGenre());
        }

        // Album artist (optional - for compilations)
        if (request.getAlbumArtistId() != null) {
            Artist albumArtist = artistRepository.findById(request.getAlbumArtistId())
                    .orElseThrow(() -> new ResourceNotFoundException("Album Artist", request.getAlbumArtistId()));
            builder.albumArtist(albumArtist);
        }

        // Genre (optional) - by id, else by name (auto-created), else from tags
        Genre genre = null;
        if (request.getGenreId() != null && !request.getGenreId().isBlank()) {
            genre = genreRepository.findById(request.getGenreId())
                    .orElseThrow(() -> new ResourceNotFoundException("Genre", request.getGenreId()));
        } else if (request.getGenreName() != null && !request.getGenreName().isBlank()) {
            genre = resolveGenreByName(request.getGenreName());
        } else if (tags.genre != null && !tags.genre.isBlank()) {
            genre = resolveGenreByName(tags.genre);
        }
        if (genre != null) {
            builder.genre(genre);
        }

        Song song = builder.build();

        // Track any storage objects we upload so we can roll them back if the DB save fails.
        List<String> uploadedStorageKeys = new ArrayList<>();

        try {
            // Upload audio file to storage first, track the key for rollback
            if (audioFile != null && !audioFile.isEmpty()) {
                String fileUrl = storageService.uploadSong(audioFile, artist.getId());
                song.setFileUrl(fileUrl);
                song.setFileFormat(getFileExtension(audioFile.getOriginalFilename()));
                song.setFileSize(audioFile.getSize());
                uploadedStorageKeys.add(fileUrl);
            }

            // Enrich from audio metadata (duration, bitrate, sample rate)
            if (tags.durationMs > 0) {
                song.setDurationMs(tags.durationMs);
                song.setDuration(formatDurationTag(tags.durationMs));
            }
            if (tags.bitrate > 0) song.setBitrate(tags.bitrate);
            if (tags.sampleRate > 0) song.setSampleRate(tags.sampleRate);

            // Upload cover: 1) uploaded coverFile, 2) embedded artwork thumbnail from audio metadata, 3) fallback to album/artist image
            if (coverFile != null && !coverFile.isEmpty()) {
                String coverUrl = storageService.uploadCover(coverFile, artist.getId());
                song.setCoverUrl(coverUrl);
                uploadedStorageKeys.add(coverUrl);
            } else if (tags.coverBytes() != null && tags.coverBytes().length > 0) {
                String coverUrl = storageService.uploadCoverBytes(tags.coverBytes(), tags.coverMimeType(), artist.getId());
                song.setCoverUrl(coverUrl);
                uploadedStorageKeys.add(coverUrl);
            } else if (album != null && album.getCoverUrl() != null && !album.getCoverUrl().isBlank()) {
                song.setCoverUrl(album.getCoverUrl());
            } else if (artist != null && artist.getImageUrl() != null && !artist.getImageUrl().isBlank()) {
                song.setCoverUrl(artist.getImageUrl());
            }

            // Save to DB - if this throws, the catch block will clean up storage
            song = songRepository.save(song);

            // Handle contributing artists AFTER the song is saved so the composite
            // key (songId, artistId, role) is final from the start. Mutating @Id
            // fields on managed entities throws "identifier of an instance was
            // altered" (Hibernate), so never build these with a null songId.
            if (request.getContributingArtists() != null && !request.getContributingArtists().isEmpty()) {
                List<SongContributingArtist> contribArtists = new ArrayList<>();
                for (CreateSongRequest.ContributingArtistRequest caReq : request.getContributingArtists()) {
                    Artist caArtist = artistRepository.findById(caReq.getArtistId())
                            .orElseThrow(() -> new ResourceNotFoundException("Contributing Artist", caReq.getArtistId()));

                    SongContributingArtist ca = SongContributingArtist.builder()
                            .songId(song.getId())
                            .artistId(caArtist.getId())
                            .role(caReq.getRole().name())
                            .position(caReq.getPosition())
                            .song(song)
                            .artist(caArtist)
                            .build();
                    contribArtists.add(ca);
                }
                song.setContributingArtists(contribArtists);
                // NOTE: no explicit saveAll here. Song.contributingArtists is a
                // cascade = ALL association, so assigning the collection to the
                // managed song is enough - Hibernate persists them when the
                // transaction flushes. Adding saveAll alongside the cascade
                // conflicts ("different object with the same identifier value").
            }

        } catch (Exception ex) {
            // DB save or contributing-artist setup failed: delete any storage objects
            // already uploaded for this song so they do not become orphans.
            log.warn("Song DB save failed for '{}'; rolling back {} storage object(s): {}",
                    song.getName(), uploadedStorageKeys.size(), ex.getMessage());
            for (String uploadedUrl : uploadedStorageKeys) {
                try {
                    storageService.deleteFileByUrl(uploadedUrl);
                } catch (Exception deleteEx) {
                    log.error("Failed to delete orphaned storage object '{}': {}", uploadedUrl, deleteEx.getMessage());
                }
            }
            throw ex; // re-throw so the transaction rolls back
        }

        log.info("Song created: {} by {}", song.getName(), artist.getName());

        if (song.getAlbum() != null) {
            updateAlbumStats(song.getAlbum().getId());
        }

        return toSongResponse(song, null);
    }

    /**
     * Bulk upload: creates multiple songs from audio files in one request.
     * Each file's metadata (title, artist, album, genre, duration) is parsed
     * from the audio tags with jaudiotagger; a matching entry in {@code requests}
     * (aligned by index) overrides the parsed values. Artists/albums/genres are
     * resolved by name and auto-created when they do not exist yet. Audio files
     * are stored as-is (FLAC stays FLAC).
     */
    @Transactional
    @CacheEvict(value = {"home", "recommendations"}, allEntries = true)
    public List<SongResponse> createSongsBulk(List<MultipartFile> files, List<CreateSongRequest> requests) {
        if (files == null || files.isEmpty()) {
            throw new BadRequestException("At least one audio file is required for bulk upload");
        }
        if (files.size() > 50) {
            throw new BadRequestException("Maximum 50 files per bulk upload");
        }
        long totalBulkSize = files.stream().mapToLong(MultipartFile::getSize).sum();
        storageService.validateStorageCapacity(totalBulkSize);

        if (requests == null) {
            requests = new ArrayList<>();
        }

        List<SongResponse> created = new ArrayList<>();
        List<String> failedFileNames = new ArrayList<>();

        for (int i = 0; i < files.size(); i++) {
            MultipartFile file = files.get(i);
            CreateSongRequest clientReq = i < requests.size() ? requests.get(i) : null;
            try {
                created.add(createBulkSong(file, clientReq));
            } catch (Exception ex) {
                // Per-song failure: log and skip so the other files still succeed.
                // Storage rollback already happened inside createSongInternal.
                String fname = file.getOriginalFilename() != null ? file.getOriginalFilename() : "file-" + i;
                failedFileNames.add(fname);
                log.error("Bulk upload: skipping '{}' due to error: {}", fname, ex.getMessage());
            }
        }

        if (!failedFileNames.isEmpty()) {
            log.warn("Bulk upload complete: {} succeeded, {} failed: {}",
                    created.size(), failedFileNames.size(), failedFileNames);
        } else {
            log.info("Bulk upload complete: {} songs created", created.size());
        }
        return created;
    }

    private SongResponse createBulkSong(MultipartFile audioFile, CreateSongRequest clientReq) {
        ParsedAudioTags tags = parseAudioMetadata(audioFile);
        CreateSongRequest resolved = clientReq != null ? clientReq : new CreateSongRequest();

        // Title: client override -> tag -> filename
        if (isBlank(resolved.getTitle())) {
            resolved.setTitle(isNotBlank(tags.title) ? tags.title : fallbackTitle(audioFile.getOriginalFilename()));
        }
        // Artist: client artistId -> client artistName -> tag artist
        if (isBlank(resolved.getArtistId()) && isBlank(resolved.getArtistName()) && isNotBlank(tags.artist)) {
            resolved.setArtistName(tags.artist);
        }
        // Album: client albumName -> tag album (only when artist is known so it attaches correctly)
        if (isBlank(resolved.getAlbumName()) && isNotBlank(tags.album)
                && (isNotBlank(resolved.getArtistName()) || isNotBlank(resolved.getArtistId()))) {
            resolved.setAlbumName(tags.album);
        }
        // Genre: client genreName -> tag genre
        if (isBlank(resolved.getGenreName()) && isNotBlank(tags.genre)) {
            resolved.setGenreName(tags.genre);
        }
        if (isBlank(resolved.getLanguage()) && isNotBlank(tags.language)) {
            resolved.setLanguage(tags.language);
        }
        if (resolved.getReleaseDate() == null && tags.releaseDate != null) {
            resolved.setReleaseDate(tags.releaseDate);
        }
        if (resolved.getTrackNumber() <= 0) resolved.setTrackNumber(tags.trackNumber);
        if (resolved.getDiscNumber() <= 0) resolved.setDiscNumber(tags.discNumber);

        return createSongInternal(resolved, audioFile, null, tags);
    }

    /**
     * Records a playback event: upserts the "Recently Played" entry (single row
     * per song, timestamp bumped) and appends a Listening History entry, deduped
     * so rapid stream requests (seek, re-buffer) do not spam the history.
     */
    @Transactional
    public void recordPlayback(String userId, String songId, String source) {
        if (userId == null || userId.isBlank() || songId == null || songId.isBlank()) return;

        User user = userRepository.getReferenceById(userId);

        // Recently played: delete + insert to bump playedAt and keep a single row per song
        recentlyPlayedRepository.deleteByUserIdAndItemTypeAndItemId(userId, "SONG", songId);
        recentlyPlayedRepository.save(RecentlyPlayed.builder()
                .user(user)
                .itemType("SONG")
                .itemId(songId)
                .build());

        // Listening history: skip if the same song was recorded within the last 5 minutes
        Optional<ListeningHistory> last = listeningHistoryRepository
                .findFirstByUserIdAndSongIdOrderByPlayedAtDesc(userId, songId);
        if (last.isPresent() && last.get().getPlayedAt().isAfter(LocalDateTime.now().minusMinutes(5))) {
            return;
        }
        listeningHistoryRepository.save(ListeningHistory.builder()
                .user(user)
                .songId(songId)
                .durationPlayedMs(0)
                .source(source != null ? source : "STREAM")
                .skipped(false)
                .build());
        log.debug("Playback recorded: user={} song={}", userId, songId);
    }

    // ---------- Audio metadata parsing (jaudiotagger) ----------

    private record ParsedAudioTags(String title, String artist, String album, String genre,
                                   String language, String composer, String lyrics,
                                   LocalDate releaseDate, int trackNumber, int discNumber,
                                   long durationMs, int bitrate, int sampleRate, String format,
                                   byte[] coverBytes, String coverMimeType) {
        static final ParsedAudioTags EMPTY = new ParsedAudioTags(null, null, null, null, null, null, null,
                null, 0, 0, 0, 0, 0, null, null, null);
    }

    private ParsedAudioTags parseAudioMetadata(MultipartFile file) {
        if (file == null || file.isEmpty()) return ParsedAudioTags.EMPTY;
        File tmp = null;
        try {
            String ext = getFileExtension(file.getOriginalFilename()).toLowerCase();
            tmp = File.createTempFile("spotibase-upload-", "." + ext);
            try (java.io.InputStream in = file.getInputStream();
                 java.io.OutputStream out = new java.io.FileOutputStream(tmp)) {
                in.transferTo(out);
            }
            AudioFile audioFile = AudioFileIO.read(tmp);
            if (audioFile == null) return ParsedAudioTags.EMPTY;

            AudioHeader header = audioFile.getAudioHeader();
            Tag tag = audioFile.getTag();

            String title = null, artist = null, album = null, genre = null, language = null;
            String composer = null, lyrics = null;
            LocalDate releaseDate = null;
            int trackNumber = 0, discNumber = 0;
            long durationMs = 0;
            int bitrate = 0, sampleRate = 0;
            String format = null;
            byte[] coverBytes = null;
            String coverMimeType = null;

            if (header != null) {
                durationMs = header.getTrackLength() * 1000L;
                bitrate = (int) header.getBitRateAsNumber();
                sampleRate = header.getSampleRateAsNumber();
                format = header.getFormat();
            }

            if (tag != null) {
                title = firstOrNull(tag, FieldKey.TITLE);
                artist = firstOrNull(tag, FieldKey.ARTIST);
                album = firstOrNull(tag, FieldKey.ALBUM);
                genre = firstOrNull(tag, FieldKey.GENRE);
                language = firstOrNull(tag, FieldKey.LANGUAGE);
                composer = firstOrNull(tag, FieldKey.COMPOSER);
                lyrics = firstOrNull(tag, FieldKey.LYRICS);
                trackNumber = parseTrackNumber(firstOrNull(tag, FieldKey.TRACK));
                discNumber = parseTrackNumber(firstOrNull(tag, FieldKey.DISC_NO));
                String year = firstOrNull(tag, FieldKey.YEAR);
                if (year != null && year.matches("\\d{4}")) {
                    releaseDate = LocalDate.of(Integer.parseInt(year), 1, 1);
                }

                try {
                    var artworkList = tag.getArtworkList();
                    if (artworkList != null && !artworkList.isEmpty()) {
                        var artwork = artworkList.get(0);
                        if (artwork != null && artwork.getBinaryData() != null && artwork.getBinaryData().length > 0) {
                            coverBytes = artwork.getBinaryData();
                            coverMimeType = artwork.getMimeType() != null ? artwork.getMimeType() : "image/jpeg";
                            log.info("Extracted embedded audio artwork thumbnail: {} bytes, mime: {}", coverBytes.length, coverMimeType);
                        }
                    }
                } catch (Throwable e) {
                    log.warn("No embedded artwork extracted from audio file: {}", e.getMessage());
                }
            }
            return new ParsedAudioTags(title, artist, album, genre, language, composer, lyrics,
                    releaseDate, trackNumber, discNumber, durationMs, bitrate, sampleRate, format,
                    coverBytes, coverMimeType);
        } catch (Exception e) {
            log.warn("Could not parse audio metadata for {}: {}", file.getOriginalFilename(), e.getMessage());
            return ParsedAudioTags.EMPTY;
        } finally {
            if (tmp != null && tmp.exists() && !tmp.delete()) {
                tmp.deleteOnExit();
            }
        }
    }

    private String firstOrNull(Tag tag, FieldKey key) {
        try {
            String value = tag.getFirst(key);
            return (value == null || value.isBlank()) ? null : value.trim();
        } catch (Exception e) {
            return null;
        }
    }

    private int parseTrackNumber(String value) {
        if (value == null || value.isBlank()) return 0;
        String[] parts = value.trim().split("/")[0].split("-")[0].trim().split("\\s+");
        try {
            return Integer.parseInt(parts[0]);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private String fallbackTitle(String filename) {
        if (filename == null || filename.isBlank()) return "Untitled";
        String name = filename;
        int dot = name.lastIndexOf('.');
        if (dot > 0) name = name.substring(0, dot);
        return name.replace('_', ' ').trim();
    }

    private String formatDurationTag(long durationMs) {
        long totalSeconds = durationMs / 1000;
        return String.format("%d:%02d", totalSeconds / 60, totalSeconds % 60);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private boolean isNotBlank(String value) {
        return value != null && !value.isBlank();
    }

    private Artist resolveArtistByName(String name) {
        String trimmed = name.trim();
        return artistRepository.findByName(trimmed)
                .orElseGet(() -> artistRepository.save(Artist.builder()
                        .name(trimmed)
                        .verified(false)
                        .build()));
    }

    private Album resolveAlbumByName(String name, Artist artist) {
        String trimmed = name.trim();
        return albumRepository.findByArtistId(artist.getId()).stream()
                .filter(a -> trimmed.equalsIgnoreCase(a.getName()))
                .findFirst()
                .orElseGet(() -> albumRepository.save(Album.builder()
                        .name(trimmed)
                        .artist(artist)
                        .releaseDate(LocalDate.now())
                        .type("ALBUM")
                        .build()));
    }

    private Genre resolveGenreByName(String name) {
        String trimmed = name.trim();
        return genreRepository.findByName(trimmed)
                .orElseGet(() -> genreRepository.save(Genre.builder()
                        .name(trimmed)
                        .sortOrder(0)
                        .build()));
    }

    @Transactional
    @CacheEvict(value = {"home", "recommendations"}, allEntries = true)
    public SongResponse updateSong(String id, CreateSongRequest request, MultipartFile audioFile, MultipartFile coverFile) {
        Song song = songRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Song", id));

        if (request.getTitle() != null) song.setName(request.getTitle());
        
        if (request.getArtistId() != null) {
            Artist artist = artistRepository.findById(request.getArtistId())
                    .orElseThrow(() -> new ResourceNotFoundException("Artist", request.getArtistId()));
            song.setArtist(artist);
        }
        
        if (request.getAlbumArtistId() != null) {
            Artist albumArtist = artistRepository.findById(request.getAlbumArtistId())
                    .orElseThrow(() -> new ResourceNotFoundException("Album Artist", request.getAlbumArtistId()));
            song.setAlbumArtist(albumArtist);
        } else if (request.getAlbumArtistId() != null && request.getAlbumArtistId().isEmpty()) {
            // Allow clearing album artist
            song.setAlbumArtist(null);
        }
        
        if (request.getAlbumId() != null) {
            Album album = albumRepository.findById(request.getAlbumId())
                    .orElseThrow(() -> new ResourceNotFoundException("Album", request.getAlbumId()));
            song.setAlbum(album);
        } else if (request.getAlbumId() != null && request.getAlbumId().isEmpty()) {
            song.setAlbum(null);
        }
        
        if (request.getGenreId() != null) {
            Genre genre = genreRepository.findById(request.getGenreId())
                    .orElseThrow(() -> new ResourceNotFoundException("Genre", request.getGenreId()));
            song.setGenre(genre);
        } else if (request.getGenreId() != null && request.getGenreId().isEmpty()) {
            song.setGenre(null);
        }
        
        if (request.getLanguage() != null) song.setLanguage(request.getLanguage());
        if (request.getComposer() != null) song.setComposer(request.getComposer());
        if (request.getLyrics() != null) song.setLyrics(request.getLyrics());
        if (request.getReleaseDate() != null) song.setReleaseDate(request.getReleaseDate());
        song.setTrackNumber(request.getTrackNumber());
        song.setDiscNumber(request.getDiscNumber());
        song.setExplicit(request.isExplicit());

        // Update contributing artists if provided
        if (request.getContributingArtists() != null) {
            // Delete existing
            contributingArtistRepository.deleteBySongId(song.getId());
            
            // Add new
            List<SongContributingArtist> contribArtists = new ArrayList<>();
            for (CreateSongRequest.ContributingArtistRequest caReq : request.getContributingArtists()) {
                Artist caArtist = artistRepository.findById(caReq.getArtistId())
                        .orElseThrow(() -> new ResourceNotFoundException("Contributing Artist", caReq.getArtistId()));
                
                SongContributingArtist ca = SongContributingArtist.builder()
                        .songId(song.getId())
                        .artistId(caArtist.getId())
                        .role(caReq.getRole().name())
                        .position(caReq.getPosition())
                        .song(song)
                        .artist(caArtist)
                        .build();
                contribArtists.add(ca);
            }
            song.setContributingArtists(contribArtists);
            // NOTE: no explicit saveAll here - the cascade = ALL association
            // persists the new children when the transaction flushes (see
            // createSong for the same pattern).
        }

        if (audioFile != null && !audioFile.isEmpty()) {
            String fileUrl = storageService.uploadSong(audioFile, song.getArtist().getId());
            song.setFileUrl(fileUrl);
            song.setFileSize(audioFile.getSize());
        }

        if (coverFile != null && !coverFile.isEmpty()) {
            String coverUrl = storageService.uploadCover(coverFile, song.getArtist().getId());
            song.setCoverUrl(coverUrl);
        }

        song = songRepository.save(song);

        if (song.getAlbum() != null) {
            updateAlbumStats(song.getAlbum().getId());
        }

        return toSongResponse(song, null);
    }

    @Transactional
    @CacheEvict(value = {"home", "recommendations"}, allEntries = true)
    public void deleteSong(String id) {
        Song song = songRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Song", id));
        
        // Remove physical audio and cover files from Cloudflare R2 / storage
        if (storageService != null) {
            if (song.getFileUrl() != null && !song.getFileUrl().isBlank()) {
                try {
                    storageService.deleteFileByUrl(song.getFileUrl());
                } catch (Exception e) {
                    log.warn("Failed to delete song audio file {}: {}", song.getFileUrl(), e.getMessage());
                }
            }
            if (song.getCoverUrl() != null && !song.getCoverUrl().isBlank()) {
                try {
                    storageService.deleteFileByUrl(song.getCoverUrl());
                } catch (Exception e) {
                    log.warn("Failed to delete song cover file {}: {}", song.getCoverUrl(), e.getMessage());
                }
            }
            storageService.invalidateStorageCache();
        }

        song.setArchived(true);
        songRepository.save(song);
        log.info("Song {} deleted and physical files purged from R2 storage", id);
    }

    @Transactional
    public void restoreSong(String id) {
        Song song = songRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Song", id));
        song.setArchived(false);
        songRepository.save(song);
    }

    @Transactional
    public void incrementPlayCount(String id) {
        songRepository.findById(id).ifPresent(song -> {
            song.setPlayCount(song.getPlayCount() + 1);
            songRepository.save(song);
        });
    }

    public List<SongResponse> getTrendingSongs(String userId, int limit) {
        Pageable pageable = PageRequest.of(0, limit);
        return songRepository.findTopSongs(pageable).stream()
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());
    }

    public List<SongResponse> getNewReleases(String userId, int limit) {
        Pageable pageable = PageRequest.of(0, limit);
        return songRepository.findNewReleases(pageable).stream()
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());
    }

    public List<SongResponse> getFeaturedSongs(String userId, int limit) {
        Pageable pageable = PageRequest.of(0, limit);
        return songRepository.findFeaturedSongs(pageable).stream()
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());
    }

    public List<SongResponse> getSongsByArtist(String artistId, String userId, Pageable pageable) {
        return songRepository.findByArtistIdAndArchivedFalseOrderByReleaseDateDesc(artistId, pageable).stream()
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());
    }

    public List<SongResponse> getSongsByAlbum(String albumId, String userId) {
        return songRepository.findByAlbumIdAndArchivedFalseOrderByDiscNumberAscTrackNumberAsc(albumId).stream()
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());
    }

    public List<SongResponse> getSongsByIds(List<String> ids, String userId) {
        return songRepository.findByIdInWithDetails(ids).stream()
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());
    }

    public void updateAlbumStats(String albumId) {
        Album album = albumRepository.findById(albumId).orElse(null);
        if (album != null) {
            List<Song> songs = songRepository.findByAlbumIdAndArchivedFalseOrderByDiscNumberAscTrackNumberAsc(albumId);
            album.setSongCount(songs.size());
            album.setTotalDurationMs(songs.stream().mapToLong(Song::getDurationMs).sum());
            albumRepository.save(album);
        }
    }

    // NEW: Optimized home feed query
    public PagedResponse<SongResponse> getHomeFeed(String userId, Pageable pageable) {
        Page<Song> songPage = songRepository.findHomeFeed(pageable);
        List<SongResponse> songs = songPage.getContent().stream()
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());
        return toPagedResponse(songPage, songs);
    }

    // NEW: Fast search using trigram similarity
    public PagedResponse<SongResponse> searchSongs(String query, String userId, Pageable pageable) {
        Page<Song> songPage = songRepository.searchSongs(query, pageable);
        List<SongResponse> songs = songPage.getContent().stream()
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());
        return toPagedResponse(songPage, songs);
    }

    public SongResponse toSongResponse(Song song, String userId) {
        SongResponse.SongResponseBuilder builder = SongResponse.builder()
                .id(song.getId())
                .title(song.getName())
                .artistId(song.getArtist().getId())
                .artistName(song.getArtist().getName())
                .language(song.getLanguage())
                .composer(song.getComposer())
                .lyrics(song.getLyrics())
                .duration(song.getDuration())
                .durationMs(song.getDurationMs())
                .releaseDate(song.getReleaseDate())
                .trackNumber(song.getTrackNumber())
                .discNumber(song.getDiscNumber())
                .fileUrl(song.getFileUrl())
                .coverUrl(song.getEffectiveCoverUrl())
                .fileFormat(song.getFileFormat())
                .fileSize(song.getFileSize())
                .bitrate(song.getBitrate())
                .sampleRate(song.getSampleRate())
                .explicit(song.isExplicit())
                .archived(song.isArchived())
                .featured(song.isFeatured())
                .playCount(song.getPlayCount())
                .createdAt(song.getCreatedAt());

        // Album info (use denormalized fields for speed)
        if (song.getAlbum() != null) {
            builder.albumId(song.getAlbum().getId());
            builder.albumName(song.getEffectiveAlbumName());
        }
        
        // Album artist info
        if (song.getAlbumArtist() != null) {
            builder.albumArtistId(song.getAlbumArtist().getId());
            builder.albumArtistName(song.getAlbumArtist().getName());
        }

        if (song.getGenre() != null) {
            builder.genreId(song.getGenre().getId());
            builder.genreName(song.getGenre().getName());
        }
        if (userId != null) {
            builder.liked(likeRepository.existsByUserIdAndSongId(userId, song.getId()));
        }

        // Contributing artists
        if (song.getContributingArtists() != null && !song.getContributingArtists().isEmpty()) {
            List<SongResponse.ContributingArtistDto> contribDtos = song.getContributingArtists().stream()
                    .map(ca -> SongResponse.ContributingArtistDto.builder()
                            .artistId(ca.getArtistId())
                            .artistName(ca.getArtist() != null ? ca.getArtist().getName() : null)
                            .role(ContributionRole.valueOf(ca.getRole()))
                            .position(ca.getPosition())
                            .build())
                    .collect(Collectors.toList());
            builder.contributingArtists(contribDtos);
        }

        return builder.build();
    }

    private PagedResponse<SongResponse> toPagedResponse(Page<Song> page, List<SongResponse> songs) {
        return PagedResponse.<SongResponse>builder()
                .content(songs)
                .page(page.getNumber())
                .size(page.getSize())
                .totalElements(page.getTotalElements())
                .totalPages(page.getTotalPages())
                .first(page.isFirst())
                .last(page.isLast())
                .build();
    }

    private String getFileExtension(String filename) {
        if (filename == null || !filename.contains(".")) return "MP3";
        return filename.substring(filename.lastIndexOf(".") + 1).toUpperCase();
    }

    private Artist resolveArtist(String artistId) {
        if (artistId != null && !artistId.isBlank()) {
            return artistRepository.findById(artistId)
                    .orElseThrow(() -> new ResourceNotFoundException("Artist", artistId));
        }
        // Create or get "Unknown Artist"
        return artistRepository.findByName("Unknown Artist")
                .orElseGet(() -> {
                    Artist unknown = Artist.builder()
                            .name("Unknown Artist")
                            .verified(false)
                            .build();
                    return artistRepository.save(unknown);
                });
    }

    public List<SongResponse> getLikedSongs(String userId) {
        List<Object[]> rows = likeRepository.findLikedSongIds(userId);
        List<String> songIds = rows.stream()
                .map(row -> (String) row[0])
                .collect(Collectors.toList());
        return getSongsByIds(songIds, userId);
    }

    public List<SongResponse> getRecentlyPlayed(String userId) {
        List<RecentlyPlayed> recentItems = recentlyPlayedRepository.findByUserIdOrderByPlayedAtDesc(userId);
        List<String> songIds = recentItems.stream()
                .filter(r -> "SONG".equals(r.getItemType()))
                .map(RecentlyPlayed::getItemId)
                .distinct()
                .limit(50)
                .collect(Collectors.toList());
        return getSongsByIds(songIds, userId);
    }

    public PagedResponse<SongResponse> getListeningHistory(String userId, Pageable pageable) {
        Page<ListeningHistory> historyPage = listeningHistoryRepository.findByUserId(userId, pageable);
        List<String> songIds = historyPage.getContent().stream()
                .map(ListeningHistory::getSongId)
                .collect(Collectors.toList());
        Map<String, SongResponse> songMap = songRepository.findByIdInWithDetails(songIds).stream()
                .map(s -> toSongResponse(s, userId))
                .collect(Collectors.toMap(SongResponse::getId, s -> s));

        List<SongResponse> songs = new ArrayList<>();
        for (String songId : songIds) {
            SongResponse song = songMap.get(songId);
            if (song != null) songs.add(song);
        }

        return PagedResponse.<SongResponse>builder()
                .content(songs)
                .page(historyPage.getNumber())
                .size(historyPage.getSize())
                .totalElements(historyPage.getTotalElements())
                .totalPages(historyPage.getTotalPages())
                .first(historyPage.isFirst())
                .last(historyPage.isLast())
                .build();
    }
}