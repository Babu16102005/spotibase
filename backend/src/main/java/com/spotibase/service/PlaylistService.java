package com.spotibase.service;

import com.spotibase.dto.request.AddSongsToPlaylistRequest;
import com.spotibase.dto.request.CreatePlaylistRequest;
import com.spotibase.dto.request.ReorderItem;
import com.spotibase.dto.request.UpdatePlaylistRequest;
import com.spotibase.dto.response.PlaylistResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.*;
import com.spotibase.exception.BadRequestException;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.exception.UnauthorizedException;
import com.spotibase.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional
public class PlaylistService {

    private final PlaylistRepository playlistRepository;
    private final PlaylistSongRepository playlistSongRepository;
    private final PlaylistCollaboratorRepository playlistCollaboratorRepository;
    private final SongRepository songRepository;
    private final LikeRepository likeRepository;
    private final UserRepository userRepository;
    private final StorageService storageService;

    @Transactional(readOnly = true)
    public PlaylistResponse getPlaylistById(String id, String userId) {
        Playlist playlist = playlistRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", id));
        return toPlaylistResponse(playlist, userId);
    }

    // NOTE: "playlists" cache holds getFeaturedPlaylists (public playlists ordered
    // by likeCount, TTL 2 min in RedisCacheConfig). Every mutation that can change
    // featured ordering/visibility (create/update/delete/add/remove/reorder/toggles/
    // collaborators/likes) evicts all entries so the next featured read is fresh.
    // allEntries=true is used because keys are "'featured:' + limit" and vary by limit.
    @CacheEvict(value = "playlists", allEntries = true)
    public PlaylistResponse createPlaylist(CreatePlaylistRequest request, String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        Playlist playlist = Playlist.builder()
                .name(request.getName())
                .description(request.getDescription())
                .user(user)
                .isPublic(request.isPublic())
                .isCollaborative(request.isCollaborative())
                .type("USER")
                .build();

        playlist = playlistRepository.save(playlist);
        log.info("Playlist created: {} by user {}", playlist.getName(), userId);
        return toPlaylistResponse(playlist, userId);
    }

    @CacheEvict(value = "playlists", allEntries = true)
    public PlaylistResponse updatePlaylist(String id, UpdatePlaylistRequest request, String userId) {
        Playlist playlist = playlistRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", id));
        validateOwnership(playlist, userId);

        if (request.getName() != null) playlist.setName(request.getName());
        if (request.getDescription() != null) playlist.setDescription(request.getDescription());
        if (request.getCoverUrl() != null) playlist.setCoverUrl(request.getCoverUrl());
        if (request.getIsPublic() != null) playlist.setPublic(request.getIsPublic());
        if (request.getIsCollaborative() != null) playlist.setCollaborative(request.getIsCollaborative());
        if (request.getArchived() != null) playlist.setArchived(request.getArchived());
        if (request.getType() != null) playlist.setType(request.getType());

        playlist = playlistRepository.save(playlist);
        log.info("Playlist updated: {} by user {}", id, userId);
        return toPlaylistResponse(playlist, userId);
    }

    // Link-only delete: removes PlaylistSong join rows + collaborator links, then the
    // Playlist row. NEVER deletes Song entities (songRepository.delete is never called
    // here) so songs survive playlist deletion. liked_playlists join rows are removed
    // via the Playlist.likedBy @ManyToMany mapping on playlist delete.
    @CacheEvict(value = "playlists", allEntries = true)
    public void deletePlaylist(String id, String userId) {
        Playlist playlist = playlistRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", id));
        validateOwnership(playlist, userId);
        playlistSongRepository.deleteAllByPlaylistId(id);
        // playlist_collaborators has no FK cascade (plain playlist_id column), so clean up explicitly.
        playlistCollaboratorRepository.deleteAllByPlaylistId(id);
        playlistRepository.delete(playlist);
        log.info("Playlist deleted: {} by user {}", id, userId);
    }

    @CacheEvict(value = "playlists", allEntries = true)
    public PlaylistResponse duplicatePlaylist(String id, String userId) {
        Playlist source = playlistRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", id));
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        Playlist duplicate = Playlist.builder()
                .name(source.getName() + " (copy)")
                .description(source.getDescription())
                .user(user)
                .isPublic(false)
                .isCollaborative(false)
                .type("USER")
                .coverUrl(source.getCoverUrl())
                .build();
        duplicate = playlistRepository.save(duplicate);

        List<PlaylistSong> sourceSongs = playlistSongRepository.findByPlaylistIdOrderByPositionAsc(id);
        for (PlaylistSong ps : sourceSongs) {
            PlaylistSong newPs = PlaylistSong.builder()
                    .playlistId(duplicate.getId())
                    .songId(ps.getSongId())
                    .position(ps.getPosition())
                    .addedBy(userId)
                    .build();
            playlistSongRepository.save(newPs);
        }
        updatePlaylistStats(duplicate.getId());
        log.info("Playlist duplicated: {} -> {} by user {}", id, duplicate.getId(), userId);
        return toPlaylistResponse(duplicate, userId);
    }

    @CacheEvict(value = "playlists", allEntries = true)
    public PlaylistResponse mergePlaylists(String targetId, String sourceId, String userId) {
        Playlist target = playlistRepository.findById(targetId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", targetId));
        validateOwnershipOrCollaboration(target, userId);

        Playlist source = playlistRepository.findById(sourceId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", sourceId));

        int maxPos = playlistSongRepository.findMaxPosition(targetId) != null
                ? playlistSongRepository.findMaxPosition(targetId) : -1;

        List<PlaylistSong> sourceSongs = playlistSongRepository.findByPlaylistIdOrderByPositionAsc(sourceId);
        for (PlaylistSong ps : sourceSongs) {
            if (!playlistSongRepository.existsByPlaylistIdAndSongId(targetId, ps.getSongId())) {
                PlaylistSong newPs = PlaylistSong.builder()
                        .playlistId(targetId)
                        .songId(ps.getSongId())
                        .position(++maxPos)
                        .addedBy(userId)
                        .build();
                playlistSongRepository.save(newPs);
            }
        }
        updatePlaylistStats(targetId);
        log.info("Playlists merged: source {} -> target {} by user {}", sourceId, targetId, userId);
        return toPlaylistResponse(target, userId);
    }

    @CacheEvict(value = "playlists", allEntries = true)
    public PlaylistResponse addSongsToPlaylist(String playlistId, AddSongsToPlaylistRequest request, String userId) {
        Playlist playlist = playlistRepository.findById(playlistId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", playlistId));
        validateOwnershipOrCollaboration(playlist, userId);

        List<String> songIds = request.getSongIds();
        List<Song> songs = songRepository.findByIds(songIds);
        if (songs.size() != songIds.size()) {
            throw new BadRequestException("One or more songs not found");
        }

        int insertPosition;
        List<PlaylistSong> existingSongs = playlistSongRepository.findByPlaylistIdOrderByPositionAsc(playlistId);

        if (request.getPosition() != null) {
            insertPosition = request.getPosition();
            for (PlaylistSong ps : existingSongs) {
                if (ps.getPosition() >= insertPosition) {
                    ps.setPosition(ps.getPosition() + songIds.size());
                    playlistSongRepository.save(ps);
                }
            }
        } else {
            insertPosition = existingSongs.isEmpty() ? 0
                    : existingSongs.get(existingSongs.size() - 1).getPosition() + 1;
        }

        int idx = 0;
        for (String songId : songIds) {
            if (!playlistSongRepository.existsByPlaylistIdAndSongId(playlistId, songId)) {
                PlaylistSong ps = PlaylistSong.builder()
                        .playlistId(playlistId)
                        .songId(songId)
                        .position(insertPosition + idx)
                        .addedBy(userId)
                        .build();
                playlistSongRepository.save(ps);
                idx++;
            }
        }
        updatePlaylistStats(playlistId);
        log.info("Songs added to playlist {}: {} songs", playlistId, songIds.size());
        return toPlaylistResponse(playlist, userId);
    }

    // Link-only removal: deletes the PlaylistSong join row and reindexes positions.
    // NEVER deletes the Song entity itself (no songRepository.delete call) so the
    // song remains in the catalog and in other playlists.
    @CacheEvict(value = "playlists", allEntries = true)
    public PlaylistResponse removeSongFromPlaylist(String playlistId, String songId, String userId) {
        Playlist playlist = playlistRepository.findById(playlistId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", playlistId));
        validateOwnershipOrCollaboration(playlist, userId);

        if (!playlistSongRepository.existsByPlaylistIdAndSongId(playlistId, songId)) {
            throw new ResourceNotFoundException("Song not found in playlist");
        }

        playlistSongRepository.deleteByPlaylistIdAndSongId(playlistId, songId);

        List<PlaylistSong> remaining = playlistSongRepository.findByPlaylistIdOrderByPositionAsc(playlistId);
        for (int i = 0; i < remaining.size(); i++) {
            remaining.get(i).setPosition(i);
            playlistSongRepository.save(remaining.get(i));
        }

        updatePlaylistStats(playlistId);
        log.info("Song {} removed from playlist {}", songId, playlistId);
        return toPlaylistResponse(playlist, userId);
    }

    @CacheEvict(value = "playlists", allEntries = true)
    public PlaylistResponse reorderSongs(String playlistId, List<ReorderItem> reorderItems, String userId) {
        Playlist playlist = playlistRepository.findById(playlistId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", playlistId));
        validateOwnershipOrCollaboration(playlist, userId);

        List<PlaylistSong> playlistSongs = playlistSongRepository.findByPlaylistIdOrderByPositionAsc(playlistId);
        Map<String, PlaylistSong> songMap = playlistSongs.stream()
                .collect(Collectors.toMap(PlaylistSong::getSongId, Function.identity(), (a, b) -> a));

        // Validate before touching any row: negative positions and unknown songs are client errors (400, not 500).
        for (ReorderItem item : reorderItems) {
            if (item.getNewPosition() < 0) {
                throw new BadRequestException("Invalid position: " + item.getNewPosition());
            }
            if (!songMap.containsKey(item.getSongId())) {
                throw new BadRequestException("Song not in playlist: " + item.getSongId());
            }
        }

        // UNIQUE(playlist_id, position) is checked per-statement by Postgres, so writing final
        // positions directly can collide mid-flush (e.g. swapping 0<->1). Park every row at a
        // unique temporary slot first, flush, then write the final contiguous positions.
        int tmp = -1;
        for (PlaylistSong ps : playlistSongs) {
            ps.setPosition(tmp--);
        }
        playlistSongRepository.saveAll(playlistSongs);
        playlistSongRepository.flush();

        // Mentioned songs take their requested slots (stable for ties); unmentioned keep
        // old relative order in the remaining free slots. All targets are distinct and every
        // row currently sits at a negative temp slot, so the flush cannot collide. Gaps are
        // harmless: all reads order by position, appends use max+1.
        List<ReorderItem> ordered = new ArrayList<>(reorderItems);
        ordered.sort(Comparator.comparingInt(ReorderItem::getNewPosition));
        Set<String> placed = new HashSet<>();
        Set<Integer> taken = new HashSet<>();
        for (ReorderItem item : ordered) {
            if (!placed.add(item.getSongId())) {
                continue;
            }
            int target = item.getNewPosition();
            while (!taken.add(target)) {
                target++;
            }
            songMap.get(item.getSongId()).setPosition(target);
        }
        for (PlaylistSong ps : playlistSongs) {
            if (!placed.contains(ps.getSongId())) {
                int target = 0;
                while (!taken.add(target)) {
                    target++;
                }
                ps.setPosition(target);
            }
        }
        playlistSongRepository.saveAll(playlistSongs);

        updatePlaylistStats(playlistId);
        log.info("Songs reordered in playlist {} by user {}", playlistId, userId);
        return toPlaylistResponse(playlist, userId);
    }

    @CacheEvict(value = "playlists", allEntries = true)
    public PlaylistResponse togglePublic(String playlistId, String userId) {
        Playlist playlist = playlistRepository.findById(playlistId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", playlistId));
        validateOwnership(playlist, userId);
        playlist.setPublic(!playlist.isPublic());
        playlist = playlistRepository.save(playlist);
        log.info("Playlist {} public toggled to {} by user {}", playlistId, playlist.isPublic(), userId);
        return toPlaylistResponse(playlist, userId);
    }

    @CacheEvict(value = "playlists", allEntries = true)
    public PlaylistResponse toggleCollaborative(String playlistId, String userId) {
        Playlist playlist = playlistRepository.findById(playlistId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", playlistId));
        validateOwnership(playlist, userId);
        playlist.setCollaborative(!playlist.isCollaborative());
        playlist = playlistRepository.save(playlist);
        log.info("Playlist {} collaborative toggled to {} by user {}", playlistId, playlist.isCollaborative(), userId);
        return toPlaylistResponse(playlist, userId);
    }

    @CacheEvict(value = "playlists", allEntries = true)
    public void addCollaborator(String playlistId, String collaboratorUserId, String userId) {
        Playlist playlist = playlistRepository.findById(playlistId)
                .orElseThrow(() -> new ResourceNotFoundException("Playlist", playlistId));
        validateOwnership(playlist, userId);

        userRepository.findById(collaboratorUserId)
                .orElseThrow(() -> new ResourceNotFoundException("User", collaboratorUserId));

        if (!playlistCollaboratorRepository.existsByPlaylistIdAndUserId(playlistId, collaboratorUserId)) {
            PlaylistCollaborator pc = PlaylistCollaborator.builder()
                    .playlistId(playlistId)
                    .userId(collaboratorUserId)
                    .build();
            playlistCollaboratorRepository.save(pc);
            if (!playlist.isCollaborative()) {
                playlist.setCollaborative(true);
                playlistRepository.save(playlist);
            }
            log.info("Collaborator {} added to playlist {} by user {}", collaboratorUserId, playlistId, userId);
        }
    }

    @Transactional(readOnly = true)
    public List<PlaylistResponse> getUserPlaylists(String userId) {
        return playlistRepository.findByUserId(userId).stream()
                .map(playlist -> toPlaylistResponse(playlist, userId))
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    @Cacheable(value = "playlists", key = "'featured:' + #limit")
    public List<PlaylistResponse> getFeaturedPlaylists(int limit) {
        return playlistRepository.findFeaturedPlaylists(PageRequest.of(0, limit)).stream()
                .map(playlist -> toPlaylistResponse(playlist, null))
                .collect(Collectors.toList());
    }

    // Featured ordering is by likeCount, so likes/unlikes must evict the featured cache.
    @CacheEvict(value = "playlists", allEntries = true)
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

    @CacheEvict(value = "playlists", allEntries = true)
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
    public List<PlaylistResponse> searchPlaylists(String query, Pageable pageable) {
        return playlistRepository.searchPublicPlaylists(query, pageable).stream()
                .map(playlist -> toPlaylistResponse(playlist, null))
                .collect(Collectors.toList());
    }

    private PlaylistResponse toPlaylistResponse(Playlist playlist, String userId) {
        List<PlaylistSong> playlistSongs = playlistSongRepository
                .findByPlaylistIdOrderByPositionAsc(playlist.getId());
        List<String> songIds = playlistSongs.stream()
                .map(PlaylistSong::getSongId)
                .collect(Collectors.toList());
        // Single batch fetch with core relations (artist/album/genre) instead
        // of N lazy loads, plus one liked IN query instead of N EXISTS.
        List<Song> songs = songIds.isEmpty() ? List.of()
                : songRepository.findByIdsWithCoreRelations(songIds);
        Map<String, Song> songMap = songs.stream()
                .collect(Collectors.toMap(Song::getId, Function.identity(), (a, b) -> a));
        final Set<String> likedIds;
        if (userId != null && !songIds.isEmpty()) {
            likedIds = new HashSet<>(likeRepository.findLikedSongIds(userId, songIds));
        } else {
            likedIds = Set.of();
        }

        List<SongResponse> songResponses = playlistSongs.stream()
                .map(ps -> songMap.get(ps.getSongId()))
                .filter(Objects::nonNull)
                .map(song -> toSongResponse(song, likedIds.contains(song.getId())))
                .collect(Collectors.toList());

        boolean liked = userId != null && playlistRepository.isLikedByUser(playlist.getId(), userId);

        return PlaylistResponse.builder()
                .id(playlist.getId())
                .name(playlist.getName())
                .description(playlist.getDescription())
                .userId(playlist.getUser().getId())
                .username(playlist.getUser().getUsername())
                .coverUrl(playlist.getCoverUrl())
                .isPublic(playlist.isPublic())
                .isCollaborative(playlist.isCollaborative())
                .songCount(playlist.getSongCount())
                .totalDurationMs(playlist.getTotalDurationMs())
                .type(playlist.getType())
                .archived(playlist.isArchived())
                // Contract: Playlist.featured is a dedicated column (not an isPublic proxy).
                // Mapped 1:1 here so PlaylistResponse.featured reflects editorial featuring.
                .featured(playlist.isFeatured())
                .likeCount(playlist.getLikeCount())
                .liked(liked)
                .songs(songResponses)
                .createdAt(playlist.getCreatedAt())
                .updatedAt(playlist.getUpdatedAt())
                .build();
    }

    private SongResponse toSongResponse(Song song, boolean liked) {
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
        builder.liked(liked);

        return builder.build();
    }

    private void updatePlaylistStats(String playlistId) {
        Playlist playlist = playlistRepository.findById(playlistId).orElse(null);
        if (playlist == null) return;
        List<PlaylistSong> playlistSongs = playlistSongRepository.findByPlaylistIdOrderByPositionAsc(playlistId);
        List<String> songIds = playlistSongs.stream().map(PlaylistSong::getSongId).collect(Collectors.toList());
        List<Song> songs = songRepository.findByIds(songIds);
        playlist.setSongCount(songs.size());
        playlist.setTotalDurationMs(songs.stream().mapToLong(Song::getDurationMs).sum());
        playlistRepository.save(playlist);
    }

    private void validateOwnership(Playlist playlist, String userId) {
        if (!playlist.getUser().getId().equals(userId)) {
            throw new UnauthorizedException("You do not have permission to modify this playlist");
        }
    }

    private void validateOwnershipOrCollaboration(Playlist playlist, String userId) {
        if (playlist.getUser().getId().equals(userId)) return;
        if (playlist.isCollaborative()
                && playlistCollaboratorRepository.existsByPlaylistIdAndUserId(playlist.getId(), userId)) return;
        throw new UnauthorizedException("You do not have permission to modify this playlist");
    }

    @Transactional(readOnly = true)
    public List<PlaylistResponse> getPlaylistsByIds(List<String> ids, String userId) {
        if (ids == null || ids.isEmpty()) return List.of();
        // Owner fetch-joined batch (no N lazy user loads in the loop below).
        List<Playlist> playlists = playlistRepository.findAllByIdsWithUser(ids);
        return playlists.stream()
                .map(playlist -> toPlaylistResponse(playlist, userId))
                .collect(Collectors.toList());
    }
}
