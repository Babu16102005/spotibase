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
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
        // Resolve primary artist (optional - create "Unknown Artist" if not provided)
        Artist artist = resolveArtist(request.getArtistId());

        Song.SongBuilder builder = Song.builder()
                .name(request.getTitle())  // use title field
                .artist(artist)
                .language(request.getLanguage())
                .composer(request.getComposer())
                .lyrics(request.getLyrics())
                .releaseDate(request.getReleaseDate() != null ? request.getReleaseDate() : LocalDate.now())
                .trackNumber(request.getTrackNumber())
                .discNumber(request.getDiscNumber())
                .explicit(request.isExplicit())
                .fileFormat(request.getFileFormat());

        // Album (optional)
        if (request.getAlbumId() != null) {
            Album album = albumRepository.findById(request.getAlbumId())
                    .orElseThrow(() -> new ResourceNotFoundException("Album", request.getAlbumId()));
            builder.album(album);
        }

        // Album artist (optional - for compilations)
        if (request.getAlbumArtistId() != null) {
            Artist albumArtist = artistRepository.findById(request.getAlbumArtistId())
                    .orElseThrow(() -> new ResourceNotFoundException("Album Artist", request.getAlbumArtistId()));
            builder.albumArtist(albumArtist);
        }

        // Genre (optional)
        if (request.getGenreId() != null) {
            Genre genre = genreRepository.findById(request.getGenreId())
                    .orElseThrow(() -> new ResourceNotFoundException("Genre", request.getGenreId()));
            builder.genre(genre);
        }

        Song song = builder.build();

        // Handle contributing artists
        if (request.getContributingArtists() != null && !request.getContributingArtists().isEmpty()) {
            List<SongContributingArtist> contribArtists = new ArrayList<>();
            for (CreateSongRequest.ContributingArtistRequest caReq : request.getContributingArtists()) {
                Artist caArtist = artistRepository.findById(caReq.getArtistId())
                        .orElseThrow(() -> new ResourceNotFoundException("Contributing Artist", caReq.getArtistId()));
                
                SongContributingArtist ca = SongContributingArtist.builder()
                        .songId(song.getId())  // will be set after save
                        .artistId(caArtist.getId())
                        .role(caReq.getRole().name())
                        .position(caReq.getPosition())
                        .song(song)
                        .artist(caArtist)
                        .build();
                contribArtists.add(ca);
            }
            song.setContributingArtists(contribArtists);
        }

        // Upload audio file
        if (audioFile != null && !audioFile.isEmpty()) {
            String fileUrl = storageService.uploadSong(audioFile, artist.getId());
            song.setFileUrl(fileUrl);
            song.setFileFormat(getFileExtension(audioFile.getOriginalFilename()));
            song.setFileSize(audioFile.getSize());
        }

        // Upload cover
        if (coverFile != null && !coverFile.isEmpty()) {
            String coverUrl = storageService.uploadCover(coverFile, artist.getId());
            song.setCoverUrl(coverUrl);
        }

        // First save to get ID
        song = songRepository.save(song);

        // Update contributing artists with actual song ID
        if (song.getContributingArtists() != null) {
            for (SongContributingArtist ca : song.getContributingArtists()) {
                ca.setSongId(song.getId());
            }
            contributingArtistRepository.saveAll(song.getContributingArtists());
        }

        log.info("Song created: {} by {}", song.getName(), artist.getName());

        if (song.getAlbum() != null) {
            updateAlbumStats(song.getAlbum().getId());
        }

        return toSongResponse(song, null);
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
            contributingArtistRepository.saveAll(contribArtists);
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
        song.setArchived(true);
        songRepository.save(song);
        log.info("Song archived: {}", id);
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
        LocalDate since = LocalDate.now().minusMonths(1);
        return songRepository.findNewReleases(since, pageable).stream()
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