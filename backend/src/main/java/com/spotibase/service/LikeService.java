package com.spotibase.service;

import com.spotibase.dto.response.AlbumResponse;
import com.spotibase.dto.response.ArtistResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.Album;
import com.spotibase.entity.Artist;
import com.spotibase.entity.Playlist;
import com.spotibase.entity.Song;
import com.spotibase.entity.User;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.AlbumRepository;
import com.spotibase.repository.ArtistRepository;
import com.spotibase.repository.PlaylistRepository;
import com.spotibase.repository.SongRepository;
import com.spotibase.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional
public class LikeService {

    private final SongRepository songRepository;
    private final AlbumRepository albumRepository;
    private final ArtistRepository artistRepository;
    private final PlaylistRepository playlistRepository;
    private final UserRepository userRepository;

    @PersistenceContext
    private EntityManager entityManager;

    public void likeSong(String userId, String songId) {
        if (!userRepository.existsById(userId)) {
            throw new ResourceNotFoundException("User", userId);
        }
        if (!songRepository.existsById(songId)) {
            throw new ResourceNotFoundException("Song", songId);
        }
        Query query = entityManager.createNativeQuery(
                "INSERT INTO liked_songs (user_id, song_id) VALUES (:userId, :songId) ON CONFLICT DO NOTHING");
        query.setParameter("userId", userId);
        query.setParameter("songId", songId);
        int affected = query.executeUpdate();
        if (affected > 0) {
            log.info("Song {} liked by user {}", songId, userId);
        }
    }

    public void unlikeSong(String userId, String songId) {
        Query query = entityManager.createNativeQuery(
                "DELETE FROM liked_songs WHERE user_id = :userId AND song_id = :songId");
        query.setParameter("userId", userId);
        query.setParameter("songId", songId);
        int affected = query.executeUpdate();
        if (affected > 0) {
            log.info("Song {} unliked by user {}", songId, userId);
        }
    }

    public void likeAlbum(String userId, String albumId) {
        if (!userRepository.existsById(userId)) {
            throw new ResourceNotFoundException("User", userId);
        }
        if (!albumRepository.existsById(albumId)) {
            throw new ResourceNotFoundException("Album", albumId);
        }
        Query query = entityManager.createNativeQuery(
                "INSERT INTO liked_albums (user_id, album_id) VALUES (:userId, :albumId) ON CONFLICT DO NOTHING");
        query.setParameter("userId", userId);
        query.setParameter("albumId", albumId);
        int affected = query.executeUpdate();
        if (affected > 0) {
            log.info("Album {} liked by user {}", albumId, userId);
        }
    }

    public void unlikeAlbum(String userId, String albumId) {
        Query query = entityManager.createNativeQuery(
                "DELETE FROM liked_albums WHERE user_id = :userId AND album_id = :albumId");
        query.setParameter("userId", userId);
        query.setParameter("albumId", albumId);
        int affected = query.executeUpdate();
        if (affected > 0) {
            log.info("Album {} unliked by user {}", albumId, userId);
        }
    }

    public void likeArtist(String userId, String artistId) {
        if (!userRepository.existsById(userId)) {
            throw new ResourceNotFoundException("User", userId);
        }
        if (!artistRepository.existsById(artistId)) {
            throw new ResourceNotFoundException("Artist", artistId);
        }
        Query query = entityManager.createNativeQuery(
                "INSERT INTO liked_artists (user_id, artist_id) VALUES (:userId, :artistId) ON CONFLICT DO NOTHING");
        query.setParameter("userId", userId);
        query.setParameter("artistId", artistId);
        int affected = query.executeUpdate();
        if (affected > 0) {
            log.info("Artist {} liked by user {}", artistId, userId);
        }
    }

    public void unlikeArtist(String userId, String artistId) {
        Query query = entityManager.createNativeQuery(
                "DELETE FROM liked_artists WHERE user_id = :userId AND artist_id = :artistId");
        query.setParameter("userId", userId);
        query.setParameter("artistId", artistId);
        int affected = query.executeUpdate();
        if (affected > 0) {
            log.info("Artist {} unliked by user {}", artistId, userId);
        }
    }

    public void likePlaylist(String userId, String playlistId) {
        Playlist playlist = playlistRepository.findById(playlistId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", playlistId));
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        if (!playlistRepository.isLikedByUser(playlistId, userId)) {
            playlist.getLikedBy().add(user);
            playlist.setLikeCount(playlist.getLikeCount() + 1);
            playlistRepository.save(playlist);
            log.info("Playlist {} liked by user {}", playlistId, userId);
        }
    }

    public void unlikePlaylist(String userId, String playlistId) {
        Playlist playlist = playlistRepository.findById(playlistId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", playlistId));
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        if (playlistRepository.isLikedByUser(playlistId, userId)) {
            playlist.getLikedBy().remove(user);
            playlist.setLikeCount(Math.max(0, playlist.getLikeCount() - 1));
            playlistRepository.save(playlist);
            log.info("Playlist {} unliked by user {}", playlistId, userId);
        }
    }

    @Transactional(readOnly = true)
    public PagedResponse<SongResponse> getLikedSongs(String userId, Pageable pageable) {
        Query countQuery = entityManager.createNativeQuery(
                "SELECT COUNT(*) FROM liked_songs WHERE user_id = :userId");
        countQuery.setParameter("userId", userId);
        long total = ((Number) countQuery.getSingleResult()).longValue();

        Query listQuery = entityManager.createNativeQuery(
                "SELECT ls.song_id FROM liked_songs ls " +
                "JOIN songs s ON s.id = ls.song_id " +
                "WHERE ls.user_id = :userId ORDER BY s.name");
        listQuery.setParameter("userId", userId);
        listQuery.setFirstResult((int) pageable.getOffset());
        listQuery.setMaxResults(pageable.getPageSize());
        List<String> songIds = listQuery.getResultList();

        List<Song> songs = songRepository.findByIds(songIds);
        List<SongResponse> content = songs.stream()
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());

        int totalPages = (int) Math.ceil((double) total / pageable.getPageSize());

        return PagedResponse.<SongResponse>builder()
                .content(content)
                .page(pageable.getPageNumber())
                .size(pageable.getPageSize())
                .totalElements(total)
                .totalPages(totalPages)
                .first(pageable.getPageNumber() == 0)
                .last(pageable.getPageNumber() >= totalPages - 1)
                .build();
    }

    @Transactional(readOnly = true)
    public List<AlbumResponse> getLikedAlbums(String userId) {
        Query query = entityManager.createNativeQuery(
                "SELECT la.album_id FROM liked_albums la " +
                "JOIN albums a ON a.id = la.album_id " +
                "WHERE la.user_id = :userId ORDER BY a.name");
        query.setParameter("userId", userId);
        List<String> albumIds = query.getResultList();

        List<Album> albums = albumRepository.findAllById(albumIds);
        return albums.stream()
                .map(album -> toAlbumResponse(album, userId))
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<ArtistResponse> getLikedArtists(String userId) {
        Query query = entityManager.createNativeQuery(
                "SELECT la.artist_id FROM liked_artists la " +
                "JOIN artists a ON a.id = la.artist_id " +
                "WHERE la.user_id = :userId ORDER BY a.name");
        query.setParameter("userId", userId);
        List<String> artistIds = query.getResultList();

        List<Artist> artists = artistRepository.findAllById(artistIds);
        return artists.stream()
                .map(artist -> toArtistResponse(artist, userId))
                .collect(Collectors.toList());
    }

    private SongResponse toSongResponse(Song song, String userId) {
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
                .coverUrl(song.getCoverUrl() != null ? song.getCoverUrl() :
                        (song.getAlbum() != null ? song.getAlbum().getCoverUrl() : null))
                .fileFormat(song.getFileFormat())
                .fileSize(song.getFileSize())
                .bitrate(song.getBitrate())
                .sampleRate(song.getSampleRate())
                .explicit(song.isExplicit())
                .archived(song.isArchived())
                .featured(song.isFeatured())
                .playCount(song.getPlayCount())
                .createdAt(song.getCreatedAt());

        if (song.getAlbum() != null) {
            builder.albumId(song.getAlbum().getId());
            builder.albumName(song.getAlbum().getName());
        }
        if (song.getGenre() != null) {
            builder.genreId(song.getGenre().getId());
            builder.genreName(song.getGenre().getName());
        }
        builder.liked(true);

        return builder.build();
    }

    private AlbumResponse toAlbumResponse(Album album, String userId) {
        return AlbumResponse.builder()
                .id(album.getId())
                .name(album.getName())
                .description(album.getDescription())
                .artistId(album.getArtist().getId())
                .artistName(album.getArtist().getName())
                .genreId(album.getGenre() != null ? album.getGenre().getId() : null)
                .genreName(album.getGenre() != null ? album.getGenre().getName() : null)
                .coverUrl(album.getCoverUrl())
                .releaseDate(album.getReleaseDate())
                .songCount(album.getSongCount())
                .totalDurationMs(album.getTotalDurationMs())
                .type(album.getType())
                .archived(album.isArchived())
                .featured(album.isFeatured())
                .liked(true)
                .createdAt(album.getCreatedAt())
                .build();
    }

    private ArtistResponse toArtistResponse(Artist artist, String userId) {
        return ArtistResponse.builder()
                .id(artist.getId())
                .name(artist.getName())
                .bio(artist.getBio())
                .imageUrl(artist.getImageUrl())
                .coverUrl(artist.getCoverUrl())
                .monthlyListeners(artist.getMonthlyListeners())
                .followerCount(artist.getFollowerCount())
                .verified(artist.isVerified())
                .followed(true)
                .albumCount(artist.getAlbums().size())
                .songCount(artist.getSongs().size())
                .createdAt(artist.getCreatedAt())
                .build();
    }
}
