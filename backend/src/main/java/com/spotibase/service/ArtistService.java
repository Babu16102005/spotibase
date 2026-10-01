package com.spotibase.service;

import com.spotibase.dto.response.ArtistResponse;
import com.spotibase.entity.Artist;
import com.spotibase.entity.User;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.AlbumRepository;
import com.spotibase.repository.ArtistRepository;
import com.spotibase.repository.LikeRepository;
import com.spotibase.repository.SongRepository;
import com.spotibase.repository.UserRepository;
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

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ArtistService {

    private final ArtistRepository artistRepository;
    private final AlbumRepository albumRepository;
    private final SongRepository songRepository;
    private final UserRepository userRepository;
    private final LikeRepository likeRepository;
    private final StorageService storageService;

    @Cacheable(value = "artists", key = "#id + ':' + #userId")
    public ArtistResponse getArtistById(String id, String userId) {
        Artist artist = artistRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Artist", id));
        return toArtistResponse(artist, userId);
    }

    @Cacheable(value = "artists", key = "'name:' + #name")
    public ArtistResponse getArtistByName(String name) {
        Artist artist = artistRepository.findByName(name)
                .orElseThrow(() -> new ResourceNotFoundException("Artist not found with name: " + name));
        return toArtistResponse(artist, null);
    }

    @Transactional
    @CacheEvict(value = {"artists", "home"}, allEntries = true)
    public ArtistResponse createArtist(String name, String bio, MultipartFile image,
                                        MultipartFile cover, String userId) {
        Artist artist = Artist.builder()
                .name(name)
                .bio(bio)
                .userId(userId)
                .build();
        artist = artistRepository.save(artist);

        if (image != null && !image.isEmpty()) {
            String imageUrl = storageService.uploadAvatar(image, artist.getId());
            artist.setImageUrl(imageUrl);
        }
        if (cover != null && !cover.isEmpty()) {
            String coverUrl = storageService.uploadCover(cover, artist.getId());
            artist.setCoverUrl(coverUrl);
        }

        artist = artistRepository.save(artist);
        log.info("Artist created: {} with id {}", artist.getName(), artist.getId());
        return toArtistResponse(artist, userId);
    }

    @Transactional
    @CacheEvict(value = {"artists", "home"}, allEntries = true)
    public ArtistResponse updateArtist(String id, String name, String bio,
                                        MultipartFile image, MultipartFile cover) {
        Artist artist = artistRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Artist", id));

        if (name != null) {
            artist.setName(name);
        }
        if (bio != null) {
            artist.setBio(bio);
        }
        if (image != null && !image.isEmpty()) {
            String imageUrl = storageService.uploadAvatar(image, artist.getId());
            artist.setImageUrl(imageUrl);
        }
        if (cover != null && !cover.isEmpty()) {
            String coverUrl = storageService.uploadCover(cover, artist.getId());
            artist.setCoverUrl(coverUrl);
        }

        artist = artistRepository.save(artist);
        log.info("Artist updated: {}", artist.getId());
        return toArtistResponse(artist, null);
    }

    @Transactional(readOnly = true)
    @Cacheable(value = "artists", key = "'top:' + #limit")
    public List<ArtistResponse> getTopArtists(int limit) {
        int safeLimit = limit <= 0 ? 20 : Math.min(limit, 50);
        Pageable pageable = PageRequest.of(0, safeLimit);
        // Batched counts + no per-row queries (see toArtistResponses).
        return toArtistResponses(artistRepository.findTopArtists(pageable), null);
    }

    @Transactional(readOnly = true)
    @Cacheable(value = "artists", key = "'featured:' + #limit")
    public List<ArtistResponse> getFeaturedArtists(int limit) {
        int safeLimit = limit <= 0 ? 20 : Math.min(limit, 50);
        Pageable pageable = PageRequest.of(0, safeLimit);
        return toArtistResponses(artistRepository.findFeaturedArtists(pageable), null);
    }

    public Map<String, Object> getArtistStats(String id) {
        Artist artist = artistRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Artist", id));

        Map<String, Object> stats = new HashMap<>();
        stats.put("monthlyListeners", artist.getMonthlyListeners());
        stats.put("followerCount", artist.getFollowerCount());
        return stats;
    }

    @Transactional
    @CacheEvict(value = {"artists", "home"}, allEntries = true)
    public void followArtist(String userId, String artistId) {
        Artist artist = artistRepository.findById(artistId)
                .orElseThrow(() -> new ResourceNotFoundException("Artist", artistId));
        if (!userRepository.existsById(userId)) {
            throw new ResourceNotFoundException("User", userId);
        }

        int inserted = artistRepository.insertFollower(artistId, userId);
        if (inserted > 0) {
            artist.setFollowerCount(artist.getFollowerCount() + 1);
            artistRepository.save(artist);
            log.info("User {} followed artist {}", userId, artistId);
        }
    }

    @Transactional
    @CacheEvict(value = {"artists", "home"}, allEntries = true)
    public void unfollowArtist(String userId, String artistId) {
        Artist artist = artistRepository.findById(artistId)
                .orElseThrow(() -> new ResourceNotFoundException("Artist", artistId));

        int deleted = artistRepository.deleteFollower(artistId, userId);
        if (deleted > 0) {
            artist.setFollowerCount(Math.max(0, artist.getFollowerCount() - 1));
            artistRepository.save(artist);
            log.info("User {} unfollowed artist {}", userId, artistId);
        }
    }

    public Page<User> getFollowers(String artistId, Pageable pageable) {
        if (!artistRepository.existsById(artistId)) {
            throw new ResourceNotFoundException("Artist", artistId);
        }
        return artistRepository.findFollowersByArtistId(artistId, pageable);
    }

    @Transactional
    public void incrementMonthlyListeners(String artistId) {
        artistRepository.findById(artistId).ifPresent(artist -> {
            artist.setMonthlyListeners(artist.getMonthlyListeners() + 1);
            artistRepository.save(artist);
        });
    }

    public ArtistResponse toArtistResponse(Artist artist, String userId) {
        // Single-item path (detail pages): per-row counts are fine for 1 row.
        // List paths must use toArtistResponses (GROUP BY batch) instead.
        long albumCount = albumRepository.countByArtistId(artist.getId());
        long songCount = songRepository.countByArtistId(artist.getId());

        ArtistResponse.ArtistResponseBuilder builder = ArtistResponse.builder()
                .id(artist.getId())
                .name(artist.getName())
                .bio(artist.getBio())
                .imageUrl(artist.getImageUrl())
                .coverUrl(artist.getCoverUrl())
                .monthlyListeners(artist.getMonthlyListeners())
                .followerCount(artist.getFollowerCount())
                .verified(artist.isVerified())
                .albumCount((int) albumCount)
                .songCount((int) songCount)
                .createdAt(artist.getCreatedAt());

        if (userId != null) {
            builder.followed(likeRepository.existsByUserIdAndArtistId(userId, artist.getId()));
        }

        return builder.build();
    }

    @Transactional(readOnly = true)
    public List<ArtistResponse> getAllArtists(int page, int size, String userId) {
        int safePage = Math.max(0, page);
        int safeSize = size <= 0 ? 20 : Math.min(size, 50);
        Pageable pageable = PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "monthlyListeners"));
        // Batched: 2 GROUP BY counts + 1 liked IN query per page (no 3N).
        return toArtistResponses(artistRepository.findAll(pageable).getContent(), userId);
    }

    @Transactional(readOnly = true)
    public List<ArtistResponse> getLikedArtists(String userId) {
        List<String> artistIds = likeRepository.findAllLikedArtistIds(userId);
        if (artistIds == null || artistIds.isEmpty()) {
            return List.of();
        }
        // Bounded + batched: avoid per-id getArtistById loop (3 queries each).
        List<String> capped = artistIds.size() > 200 ? artistIds.subList(0, 200) : artistIds;
        return getArtistsByIds(capped, userId);
    }

    @Transactional(readOnly = true)
    public List<ArtistResponse> getArtistsByIds(List<String> ids, String userId) {
        if (ids == null || ids.isEmpty()) return List.of();
        // Cap IN-clause size; preserve caller order for search hydration.
        List<String> capped = ids.size() > 100 ? ids.subList(0, 100) : ids;
        Map<String, Artist> byId = artistRepository.findAllById(capped).stream()
                .collect(Collectors.toMap(Artist::getId, a -> a, (a, b) -> a));
        List<Artist> ordered = capped.stream()
                .map(byId::get)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toList());
        return toArtistResponses(ordered, userId);
    }

    /**
     * Batched list mapping: 2 GROUP BY count queries + 1 liked IN query per
     * call instead of 3N per-row queries (countByArtistId x2 + EXISTS).
     * Same ArtistResponse contract as the single-item path.
     */
    private List<ArtistResponse> toArtistResponses(List<Artist> artists, String userId) {
        if (artists == null || artists.isEmpty()) {
            return List.of();
        }
        List<String> ids = artists.stream().map(Artist::getId).collect(Collectors.toList());
        Map<String, Long> songCounts = artistRepository.countSongsByArtistIds(ids).stream()
                .collect(Collectors.toMap(
                        row -> (String) row[0],
                        row -> ((Number) row[1]).longValue(),
                        (a, b) -> a));
        Map<String, Long> albumCounts = artistRepository.countAlbumsByArtistIds(ids).stream()
                .collect(Collectors.toMap(
                        row -> (String) row[0],
                        row -> ((Number) row[1]).longValue(),
                        (a, b) -> a));
        final Set<String> followedIds;
        if (userId != null) {
            followedIds = new java.util.HashSet<>(likeRepository.findLikedArtistIds(userId, ids));
        } else {
            followedIds = Set.of();
        }
        return artists.stream()
                .map(artist -> ArtistResponse.builder()
                        .id(artist.getId())
                        .name(artist.getName())
                        .bio(artist.getBio())
                        .imageUrl(artist.getImageUrl())
                        .coverUrl(artist.getCoverUrl())
                        .monthlyListeners(artist.getMonthlyListeners())
                        .followerCount(artist.getFollowerCount())
                        .verified(artist.isVerified())
                        .followed(userId != null && followedIds.contains(artist.getId()))
                        .albumCount(albumCounts.getOrDefault(artist.getId(), 0L).intValue())
                        .songCount(songCounts.getOrDefault(artist.getId(), 0L).intValue())
                        .createdAt(artist.getCreatedAt())
                        .build())
                .collect(Collectors.toList());
    }
}
