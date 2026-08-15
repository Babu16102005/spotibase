package com.spotibase.controller;

import com.spotibase.dto.request.CreateAlbumRequest;
import com.spotibase.dto.response.AlbumResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.AlbumService;
import com.spotibase.service.LikeService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController
@RequestMapping("/api/v1/albums")
@RequiredArgsConstructor
@Slf4j
public class AlbumController {

    private final AlbumService albumService;
    private final LikeService likeService;

    @GetMapping
    public ResponseEntity<List<AlbumResponse>> getAllAlbums(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @CurrentUser CustomUserDetails user) {
        log.info("Get all albums, page: {}, size: {}", page, size);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(albumService.getAllAlbums(page, size, userId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<AlbumResponse> getAlbumById(@PathVariable String id,
                                                       @CurrentUser CustomUserDetails user) {
        log.info("Get album by id: {}", id);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(albumService.getAlbumById(id, userId));
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<AlbumResponse> createAlbum(@Valid @RequestPart("request") CreateAlbumRequest request,
                                                      @RequestPart(value = "coverFile", required = false) MultipartFile coverFile) {
        log.info("Create album: {}", request.getName());
        return ResponseEntity.status(HttpStatus.CREATED).body(albumService.createAlbum(request, coverFile));
    }

    @PutMapping(value = "/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<AlbumResponse> updateAlbum(@PathVariable String id,
                                                      @Valid @RequestPart("request") CreateAlbumRequest request,
                                                      @RequestPart(value = "coverFile", required = false) MultipartFile coverFile) {
        log.info("Update album: {}", id);
        return ResponseEntity.ok(albumService.updateAlbum(id, request, coverFile));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<Void> deleteAlbum(@PathVariable String id) {
        log.info("Delete album: {}", id);
        albumService.deleteAlbum(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/restore")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> restoreAlbum(@PathVariable String id) {
        log.info("Restore album: {}", id);
        albumService.restoreAlbum(id);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/featured")
    public ResponseEntity<List<AlbumResponse>> getFeaturedAlbums(@CurrentUser CustomUserDetails user,
                                                                  @RequestParam(defaultValue = "20") int limit) {
        log.info("Get featured albums, limit: {}", limit);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(albumService.getFeaturedAlbums(userId, limit));
    }

    @GetMapping("/new-releases")
    public ResponseEntity<List<AlbumResponse>> getNewReleases(@CurrentUser CustomUserDetails user,
                                                               @RequestParam(defaultValue = "20") int limit) {
        log.info("Get new releases, limit: {}", limit);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(albumService.getNewReleases(userId, limit));
    }

    @PostMapping("/{id}/like")
    public ResponseEntity<Void> likeAlbum(@CurrentUser CustomUserDetails user,
                                           @PathVariable String id) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        log.info("User {} likes album {}", user.getId(), id);
        likeService.likeAlbum(user.getId(), id);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @DeleteMapping("/{id}/like")
    public ResponseEntity<Void> unlikeAlbum(@CurrentUser CustomUserDetails user,
                                             @PathVariable String id) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        log.info("User {} unlikes album {}", user.getId(), id);
        likeService.unlikeAlbum(user.getId(), id);
        return ResponseEntity.noContent().build();
    }
}