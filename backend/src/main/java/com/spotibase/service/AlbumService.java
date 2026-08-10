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
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
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

    @Cacheable(value = "albums", key = "#id + ':' + #userId")
    public AlbumResponse getAlbumById(String id, String userId) {
        Album album = albumRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Album", id));
        return toAlbumResponse(album, userId);
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
    @Cacheable(value = "albums", key = "'featured:' + #userId + ':' + #limit")
    public List<AlbumResponse> getFeaturedAlbums(String userId, int limit) {
        Pageable pageable = PageRequest.of(0, limit);
        return albumRepository.findFeaturedAlbums(pageable).stream()
                .map(album -> toAlbumResponse(album, userId))
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    @Cacheable(value = "albums", key = "'newReleases:' + #userId + ':' + #limit")
    public List<AlbumResponse> getNewReleases(String userId, int limit) {
        Pageable pageable = PageRequest.of(0, limit);
        LocalDate since = LocalDate.now().minusMonths(1);
        return albumRepository.findNewReleases(since, pageable).stream()
                .map(album -> toAlbumResponse(album, userId))
                .collect(Collectors.toList());
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

        List<SongResponse> songResponses = songRepository.findByAlbumIdOrderByTrackNumber(album.getId())
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
                        sb.liked(likeRepository.existsByUserIdAndSongId(userId, song.getId()));
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
        List<Object[]> rows = likeRepository.findLikedAlbumIds(userId);
        List<String> albumIds = rows.stream()
                .map(row -> (String) row[0])
                .collect(Collectors.toList());
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
}
