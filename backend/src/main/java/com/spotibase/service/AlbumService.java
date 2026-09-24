package com.spotibase.service;

import com.spotibase.dto.request.CreateAlbumRequest;
import com.spotibase.dto.response.AlbumResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.Album;
import com.spotibase.entity.Artist;
import com.spotibase.entity.Genre;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.AlbumRepository;
import com.spotibase.repository.ArtistRepository;
import com.spotibase.repository.GenreRepository;
import com.spotibase.repository.LikeRepository;
import com.spotibase.repository.SongRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.context.annotation.Lazy;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AlbumService {

    private final AlbumRepository albumRepository;
    private final SongRepository songRepository;
    private final ArtistRepository artistRepository;
    private final GenreRepository genreRepository;
    private final LikeRepository likeRepository;
    private final StorageService storageService;

    // Self-reference for @Cacheable: same-bean calls bypass the cache proxy.
    @Autowired
    @Lazy
    private AlbumService self;

    /**
     * Per-request entry point: cached user-agnostic base + batched liked overlay.
     * Never caches per-user data (previously keyed by userId, which exploded
     * cardinality and risked leaking liked flags across users on copy mistakes).
     */
    public AlbumResponse getAlbumById(String id, String userId) {
        AlbumService cached = self != null ? self : this;
        AlbumResponse copy = copyAlbumResponse(cached.getAlbumBaseById(id));
        if (userId != null) {
            overlayLiked(copy, userId);
        }
        return copy;
    }

    /**
     * Cached album base (no per-user data): liked=false throughout. Evicted with
     * the rest of {@code albums} on every album mutation.
     */
    @Cacheable(value = "albums", key = "'id:' + #id")
    public AlbumResponse getAlbumBaseById(String id) {
        Album album = albumRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Album", id));
        return toAlbumResponse(album, null);
    }

    @Transactional
    @CacheEvict(value = {"albums", "home"}, allEntries = true)
    public AlbumResponse createAlbum(CreateAlbumRequest request, MultipartFile cover) {
        Artist artist = artistRepository.findById(request.getArtistId())
                .orElseThrow(() -> new ResourceNotFoundException("Artist", request.getArtistId()));

        Genre genre = null;
        if (request.getGenreId() != null) {
            genre = genreRepository.findById(request.getGenreId())
                    .orElseThrow(() -> new ResourceNotFoundException("Genre", request.getGenreId()));
        }

        Album album = Album.builder()
                .name(request.getName())
                .description(request.getDescription())
                .artist(artist)
                .genre(genre)
                .releaseDate(request.getReleaseDate())
                .type(request.getType() != null ? request.getType() : "ALBUM")
                .build();

        if (cover != null && !cover.isEmpty()) {
            String coverUrl = storageService.uploadCover(cover, artist.getId());
            album.setCoverUrl(coverUrl);
        }

        album = albumRepository.save(album);
        log.info("Album created: {} by {}", album.getName(), artist.getName());
        return toAlbumResponse(album, null);
    }

    @Transactional
    @CacheEvict(value = {"albums", "home"}, allEntries = true)
    public AlbumResponse updateAlbum(String id, CreateAlbumRequest request, MultipartFile cover) {
        Album album = albumRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Album", id));

        if (request.getName() != null) {
            album.setName(request.getName());
        }
        if (request.getDescription() != null) {
            album.setDescription(request.getDescription());
        }
        if (request.getArtistId() != null) {
            Artist artist = artistRepository.findById(request.getArtistId())
                    .orElseThrow(() -> new ResourceNotFoundException("Artist", request.getArtistId()));
            album.setArtist(artist);
        }
        if (request.getGenreId() != null) {
            Genre genre = genreRepository.findById(request.getGenreId())
                    .orElseThrow(() -> new ResourceNotFoundException("Genre", request.getGenreId()));
            album.setGenre(genre);
        }
        if (request.getReleaseDate() != null) {
            album.setReleaseDate(request.getReleaseDate());
        }
        if (request.getType() != null) {
            album.setType(request.getType());
        }

        if (cover != null && !cover.isEmpty()) {
            String coverUrl = storageService.uploadCover(cover, album.getArtist().getId());
            album.setCoverUrl(coverUrl);
        }

        album = albumRepository.save(album);
        log.info("Album updated: {}", album.getId());
        return toAlbumResponse(album, null);
    }

    @Transactional
    @CacheEvict(value = {"albums", "home"}, allEntries = true)
    public void deleteAlbum(String id) {
        Album album = albumRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Album", id));
        album.setArchived(true);
        albumRepository.save(album);
        log.info("Album archived: {}", id);
    }

    @Transactional
    @CacheEvict(value = {"albums", "home"}, allEntries = true)
    public void restoreAlbum(String id) {
        Album album = albumRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Album", id));
        album.setArchived(false);
        albumRepository.save(album);
        log.info("Album restored: {}", id);
    }

    @Transactional(readOnly = true)
    public List<AlbumResponse> getFeaturedAlbums(String userId, int limit) {
        int safeLimit = Math.max(1, Math.min(limit <= 0 ? 20 : limit, 50));
        AlbumService cached = self != null ? self : this;
        return cached.getFeaturedAlbumsBase(safeLimit).stream()
                .map(this::copyAlbumResponse)
                .peek(copy -> {
                    if (userId != null) overlayLiked(copy, userId);
                })
                .collect(Collectors.toList());
    }

    /** Cached featured base (no per-user data); liked flags overlaid per request. */
    @Transactional(readOnly = true)
    @Cacheable(value = "albums", key = "'featured:' + #limit")
    public List<AlbumResponse> getFeaturedAlbumsBase(int limit) {
        Pageable pageable = PageRequest.of(0, Math.max(1, Math.min(limit, 50)));
        return albumRepository.findFeaturedAlbums(pageable).stream()
                .map(album -> toAlbumResponse(album, null))
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<AlbumResponse> getNewReleases(String userId, int limit) {
        int safeLimit = Math.max(1, Math.min(limit <= 0 ? 20 : limit, 50));
        AlbumService cached = self != null ? self : this;
        return cached.getNewReleasesBase(safeLimit).stream()
                .map(this::copyAlbumResponse)
                .peek(copy -> {
                    if (userId != null) overlayLiked(copy, userId);
                })
                .collect(Collectors.toList());
    }

    /** Cached new-releases base (no per-user data); liked flags overlaid per request. */
    @Transactional(readOnly = true)
    @Cacheable(value = "albums", key = "'newReleases:' + #limit")
    public List<AlbumResponse> getNewReleasesBase(int limit) {
        Pageable pageable = PageRequest.of(0, Math.max(1, Math.min(limit, 50)));
        LocalDate since = LocalDate.now().minusMonths(1);
        return albumRepository.findNewReleases(since, pageable).stream()
                .map(album -> toAlbumResponse(album, null))
                .collect(Collectors.toList());
    }

    /**
     * Overlays per-user liked flags on a defensive copy: one album EXISTS query
     * plus one batched song IN query (no N+1). Never called on a cached instance.
     */
    private void overlayLiked(AlbumResponse copy, String userId) {
        copy.setLiked(likeRepository.existsByUserIdAndAlbumId(userId, copy.getId()));
        if (copy.getSongs() != null && !copy.getSongs().isEmpty()) {
            List<String> songIds = copy.getSongs().stream()
                    .map(SongResponse::getId)
                    .collect(Collectors.toList());
            Set<String> likedSongIds = new HashSet<>(likeRepository.findLikedSongIds(userId, songIds));
            copy.getSongs().forEach(s -> s.setLiked(likedSongIds.contains(s.getId())));
        }
    }

    /**
     * Defensive copy of a cached AlbumResponse (including nested SongResponses)
     * so liked overlays cannot mutate the cached base.
     */
    private AlbumResponse copyAlbumResponse(AlbumResponse src) {
        if (src == null) {
            return null;
        }
        List<SongResponse> songsCopy = null;
        if (src.getSongs() != null) {
            songsCopy = src.getSongs().stream()
                    .map(s -> SongResponse.builder()
                            .id(s.getId())
                            .title(s.getTitle())
                            .artistId(s.getArtistId())
                            .artistName(s.getArtistName())
                            .albumId(s.getAlbumId())
                            .albumName(s.getAlbumName())
                            .genreId(s.getGenreId())
                            .genreName(s.getGenreName())
                            .language(s.getLanguage())
                            .composer(s.getComposer())
                            .lyrics(s.getLyrics())
                            .duration(s.getDuration())
                            .durationMs(s.getDurationMs())
                            .releaseDate(s.getReleaseDate())
                            .trackNumber(s.getTrackNumber())
                            .discNumber(s.getDiscNumber())
                            .fileUrl(s.getFileUrl())
                            .coverUrl(s.getCoverUrl())
                            .fileFormat(s.getFileFormat())
                            .fileSize(s.getFileSize())
                            .bitrate(s.getBitrate())
                            .sampleRate(s.getSampleRate())
                            .explicit(s.isExplicit())
                            .archived(s.isArchived())
                            .featured(s.isFeatured())
                            .playCount(s.getPlayCount())
                            .liked(s.isLiked())
                            .createdAt(s.getCreatedAt())
                            .build())
                    .collect(Collectors.toList());
        }
        return AlbumResponse.builder()
                .id(src.getId())
                .name(src.getName())
                .description(src.getDescription())
                .artistId(src.getArtistId())
                .artistName(src.getArtistName())
                .genreId(src.getGenreId())
                .genreName(src.getGenreName())
                .coverUrl(src.getCoverUrl())
                .releaseDate(src.getReleaseDate())
                .songCount(src.getSongCount())
                .totalDurationMs(src.getTotalDurationMs())
                .type(src.getType())
                .archived(src.isArchived())
                .featured(src.isFeatured())
                .liked(src.isLiked())
                .songs(songsCopy)
                .createdAt(src.getCreatedAt())
                .build();
    }

    public List<AlbumResponse> getAlbumsByArtist(String artistId) {
        return albumRepository.findByArtistId(artistId).stream()
                .map(album -> toAlbumResponse(album, null))
                .collect(Collectors.toList());
    }

    public AlbumResponse toAlbumResponse(Album album, String userId) {
        AlbumResponse.AlbumResponseBuilder builder = AlbumResponse.builder()
                .id(album.getId())
                .name(album.getName())
                .description(album.getDescription())
                .artistId(album.getArtist().getId())
                .artistName(album.getArtist().getName())
                .coverUrl(album.getCoverUrl())
                .releaseDate(album.getReleaseDate())
                .songCount(album.getSongCount())
                .totalDurationMs(album.getTotalDurationMs())
                .type(album.getType())
                .archived(album.isArchived())
                .featured(album.isFeatured())
                .createdAt(album.getCreatedAt());

        if (album.getGenre() != null) {
            builder.genreId(album.getGenre().getId());
            builder.genreName(album.getGenre().getName());
        }

        if (userId != null) {
            builder.liked(likeRepository.existsByUserIdAndAlbumId(userId, album.getId()));
        }

        List<com.spotibase.entity.Song> songs = songRepository.findByAlbumIdOrderByTrackNumber(album.getId());

        // Batch liked check: one IN query instead of N per-song EXISTS queries.
        final Set<String> likedSongIds;
        if (userId != null && !songs.isEmpty()) {
            List<String> songIds = songs.stream()
                    .map(com.spotibase.entity.Song::getId)
                    .collect(Collectors.toList());
            likedSongIds = new HashSet<>(likeRepository.findLikedSongIds(userId, songIds));
        } else {
            likedSongIds = Set.of();
        }

        List<SongResponse> songResponses = songs
                .stream()
                .map(song -> {
                    SongResponse.SongResponseBuilder sb = SongResponse.builder()
                            .id(song.getId())
                            .title(song.getName())
                            .artistId(song.getArtist().getId())
                            .artistName(song.getArtist().getName())
                            .duration(song.getDuration())
                            .durationMs(song.getDurationMs())
                            .trackNumber(song.getTrackNumber())
                            .discNumber(song.getDiscNumber())
                            .fileUrl(song.getFileUrl())
                            .coverUrl(song.getCoverUrl() != null ? song.getCoverUrl() : album.getCoverUrl())
                            .fileFormat(song.getFileFormat())
                            .fileSize(song.getFileSize())
                            .bitrate(song.getBitrate())
                            .sampleRate(song.getSampleRate())
                            .explicit(song.isExplicit())
                            .archived(song.isArchived())
                            .featured(song.isFeatured())
                            .playCount(song.getPlayCount())
                            .language(song.getLanguage())
                            .composer(song.getComposer())
                            .lyrics(song.getLyrics())
                            .releaseDate(song.getReleaseDate())
                            .createdAt(song.getCreatedAt());

                    if (song.getAlbum() != null) {
                        sb.albumId(song.getAlbum().getId());
                        sb.albumName(song.getAlbum().getName());
                    }
                    if (song.getGenre() != null) {
                        sb.genreId(song.getGenre().getId());
                        sb.genreName(song.getGenre().getName());
                    }
                    if (userId != null) {
                        sb.liked(likedSongIds.contains(song.getId()));
                    }

                    return sb.build();
                })
                .collect(Collectors.toList());

        builder.songs(songResponses);

        return builder.build();
    }

    @Transactional(readOnly = true)
    public List<AlbumResponse> getAllAlbums(int page, int size, String userId) {
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        return albumRepository.findAllActive(pageable).stream()
                .map(album -> toAlbumResponse(album, userId))
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<AlbumResponse> getLikedAlbums(String userId) {
        List<String> albumIds = likeRepository.findAllLikedAlbumIds(userId);
        List<AlbumResponse> albums = new ArrayList<>();
        for (String albumId : albumIds) {
            try {
                albums.add(getAlbumById(albumId, userId));
            } catch (Exception e) {
                log.warn("Could not load liked album: {}", albumId);
            }
        }
        return albums;
    }

    @Transactional(readOnly = true)
    public List<AlbumResponse> getAlbumsByIds(List<String> ids, String userId) {
        if (ids == null || ids.isEmpty()) return List.of();
        List<Album> albums = albumRepository.findAllById(ids);
        return albums.stream()
                .map(album -> toAlbumResponse(album, userId))
                .collect(Collectors.toList());
    }
}
