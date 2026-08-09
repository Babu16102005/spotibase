package com.spotibase.controller;

import com.spotibase.dto.request.AddSongsToPlaylistRequest;
import com.spotibase.dto.request.CreatePlaylistRequest;
import com.spotibase.dto.request.ReorderItem;
import com.spotibase.dto.request.UpdatePlaylistRequest;
import com.spotibase.dto.response.PlaylistResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.LikeService;
import com.spotibase.service.PlaylistService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/playlists")
@RequiredArgsConstructor
@Slf4j
public class PlaylistController {

    private final PlaylistService playlistService;
    private final LikeService likeService;

    @GetMapping
    public ResponseEntity<List<PlaylistResponse>> getUserPlaylists(@CurrentUser CustomUserDetails user) {
        log.info("Get playlists for user: {}", user.getId());
        return ResponseEntity.ok(playlistService.getUserPlaylists(user.getId()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<PlaylistResponse> getPlaylistById(@PathVariable String id,
                                                             @CurrentUser CustomUserDetails user) {
        log.info("Get playlist by id: {}", id);
        return ResponseEntity.ok(playlistService.getPlaylistById(id, user.getId()));
    }

    @PostMapping
    public ResponseEntity<PlaylistResponse> createPlaylist(@Valid @RequestBody CreatePlaylistRequest request,
                                                            @CurrentUser CustomUserDetails user) {
        log.info("Create playlist: {} by user {}", request.getName(), user.getId());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(playlistService.createPlaylist(request, user.getId()));
    }

    @PutMapping("/{id}")
    public ResponseEntity<PlaylistResponse> updatePlaylist(@PathVariable String id,
                                                            @Valid @RequestBody UpdatePlaylistRequest request,
                                                            @CurrentUser CustomUserDetails user) {
        log.info("Update playlist: {} by user {}", id, user.getId());
        return ResponseEntity.ok(playlistService.updatePlaylist(id, request, user.getId()));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deletePlaylist(@PathVariable String id,
                                                @CurrentUser CustomUserDetails user) {
        log.info("Delete playlist: {} by user {}", id, user.getId());
        playlistService.deletePlaylist(id, user.getId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/duplicate")
    public ResponseEntity<PlaylistResponse> duplicatePlaylist(@PathVariable String id,
                                                               @CurrentUser CustomUserDetails user) {
        log.info("Duplicate playlist: {} by user {}", id, user.getId());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(playlistService.duplicatePlaylist(id, user.getId()));
    }

    @PostMapping("/{id}/merge")
    public ResponseEntity<PlaylistResponse> mergePlaylists(@PathVariable String id,
                                                            @RequestParam String sourcePlaylistId,
                                                            @CurrentUser CustomUserDetails user) {
        log.info("Merge playlist {} into {} by user {}", sourcePlaylistId, id, user.getId());
        return ResponseEntity.ok(playlistService.mergePlaylists(id, sourcePlaylistId, user.getId()));
    }

    @PostMapping("/{id}/songs")
    public ResponseEntity<PlaylistResponse> addSongsToPlaylist(@PathVariable String id,
                                                                @Valid @RequestBody AddSongsToPlaylistRequest request,
                                                                @CurrentUser CustomUserDetails user) {
        log.info("Add songs to playlist {} by user {}", id, user.getId());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(playlistService.addSongsToPlaylist(id, request, user.getId()));
    }

    @DeleteMapping("/{id}/songs/{songId}")
    public ResponseEntity<PlaylistResponse> removeSongFromPlaylist(@PathVariable String id,
                                                                    @PathVariable String songId,
                                                                    @CurrentUser CustomUserDetails user) {
        log.info("Remove song {} from playlist {} by user {}", songId, id, user.getId());
        return ResponseEntity.ok(playlistService.removeSongFromPlaylist(id, songId, user.getId()));
    }

    @PutMapping("/{id}/songs/reorder")
    public ResponseEntity<PlaylistResponse> reorderSongs(@PathVariable String id,
                                                          @Valid @RequestBody List<ReorderItem> reorderList,
                                                          @CurrentUser CustomUserDetails user) {
        log.info("Reorder songs in playlist {} by user {}", id, user.getId());
        return ResponseEntity.ok(playlistService.reorderSongs(id, reorderList, user.getId()));
    }

    @PutMapping("/{id}/public")
    public ResponseEntity<PlaylistResponse> togglePublic(@PathVariable String id,
                                                          @CurrentUser CustomUserDetails user) {
        log.info("Toggle public for playlist {} by user {}", id, user.getId());
        return ResponseEntity.ok(playlistService.togglePublic(id, user.getId()));
    }

    @PutMapping("/{id}/collaborative")
    public ResponseEntity<PlaylistResponse> toggleCollaborative(@PathVariable String id,
                                                                 @CurrentUser CustomUserDetails user) {
        log.info("Toggle collaborative for playlist {} by user {}", id, user.getId());
        return ResponseEntity.ok(playlistService.toggleCollaborative(id, user.getId()));
    }

    @PostMapping("/{id}/collaborators")
    public ResponseEntity<Void> addCollaborator(@PathVariable String id,
                                                 @RequestBody Map<String, String> request,
                                                 @CurrentUser CustomUserDetails user) {
        String collaboratorUserId = request.get("userId");
        log.info("Add collaborator {} to playlist {} by user {}", collaboratorUserId, id, user.getId());
        playlistService.addCollaborator(id, collaboratorUserId, user.getId());
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @GetMapping("/featured")
    public ResponseEntity<List<PlaylistResponse>> getFeaturedPlaylists(
            @RequestParam(defaultValue = "20") int limit) {
        log.info("Get featured playlists, limit: {}", limit);
        return ResponseEntity.ok(playlistService.getFeaturedPlaylists(limit));
    }

    @PostMapping("/{id}/like")
    public ResponseEntity<Void> likePlaylist(@CurrentUser CustomUserDetails user,
                                              @PathVariable String id) {
        log.info("User {} likes playlist {}", user.getId(), id);
        likeService.likePlaylist(user.getId(), id);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @DeleteMapping("/{id}/like")
    public ResponseEntity<Void> unlikePlaylist(@CurrentUser CustomUserDetails user,
                                                @PathVariable String id) {
        log.info("User {} unlikes playlist {}", user.getId(), id);
        likeService.unlikePlaylist(user.getId(), id);
        return ResponseEntity.noContent().build();
    }
}