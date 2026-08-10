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
        Pageable pageable = PageRequest.of(0, limit);
        return artistRepository.findTopArtists(pageable).stream()
                .map(artist -> toArtistResponse(artist, null))
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    @Cacheable(value = "artists", key = "'featured:' + #limit")
    public List<ArtistResponse> getFeaturedArtists(int limit) {
        Pageable pageable = PageRequest.of(0, limit);
        return artistRepository.findFeaturedArtists(pageable).stream()
                .map(artist -> toArtistResponse(artist, null))
                .collect(Collectors.toList());
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
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "monthlyListeners"));
        return artistRepository.findAll(pageable).stream()
                .map(artist -> toArtistResponse(artist, userId))
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<ArtistResponse> getLikedArtists(String userId) {
        List<Object[]> rows = likeRepository.findLikedArtistIds(userId);
        List<String> artistIds = rows.stream()
                .map(row -> (String) row[0])
                .collect(Collectors.toList());
        List<ArtistResponse> artists = new ArrayList<>();
        for (String artistId : artistIds) {
            try {
                artists.add(getArtistById(artistId, userId));
            } catch (Exception e) {
                log.warn("Could not load liked artist: {}", artistId);
            }
        }
        return artists;
    }
}
