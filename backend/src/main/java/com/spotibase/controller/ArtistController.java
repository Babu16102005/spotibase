package com.spotibase.controller;

import com.spotibase.dto.response.ArtistResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.ArtistService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

@RestController
@RequestMapping("/api/v1/artists")
@RequiredArgsConstructor
@Slf4j
public class ArtistController {

    private final ArtistService artistService;

    @GetMapping
    public ResponseEntity<List<ArtistResponse>> getAllArtists(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @CurrentUser CustomUserDetails user) {
        log.info("Get all artists, page: {}, size: {}", page, size);
        return ResponseEntity.ok(artistService.getAllArtists(page, size, user.getId()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ArtistResponse> getArtistById(@PathVariable String id,
                                                         @CurrentUser CustomUserDetails user) {
        log.info("Get artist by id: {}", id);
        return ResponseEntity.ok(artistService.getArtistById(id, user.getId()));
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ArtistResponse> createArtist(
            @RequestParam("name") String name,
            @RequestParam(value = "bio", required = false) String bio,
            @RequestParam(value = "imageFile", required = false) MultipartFile imageFile,
            @RequestParam(value = "coverFile", required = false) MultipartFile coverFile,
            @CurrentUser CustomUserDetails user) {
        log.info("Create artist: {}", name);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(artistService.createArtist(name, bio, imageFile, coverFile, user.getId()));
    }

    @PutMapping(value = "/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ArtistResponse> updateArtist(
            @PathVariable String id,
            @RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "bio", required = false) String bio,
            @RequestParam(value = "imageFile", required = false) MultipartFile imageFile,
            @RequestParam(value = "coverFile", required = false) MultipartFile coverFile) {
        log.info("Update artist: {}", id);
        return ResponseEntity.ok(artistService.updateArtist(id, name, bio, imageFile, coverFile));
    }

    @GetMapping("/top")
    public ResponseEntity<List<ArtistResponse>> getTopArtists(@RequestParam(defaultValue = "20") int limit) {
        log.info("Get top artists, limit: {}", limit);
        return ResponseEntity.ok(artistService.getTopArtists(limit));
    }

    @GetMapping("/featured")
    public ResponseEntity<List<ArtistResponse>> getFeaturedArtists(@RequestParam(defaultValue = "20") int limit) {
        log.info("Get featured artists, limit: {}", limit);
        return ResponseEntity.ok(artistService.getFeaturedArtists(limit));
    }

    @PostMapping("/{id}/follow")
    public ResponseEntity<Void> followArtist(@CurrentUser CustomUserDetails user,
                                              @PathVariable String id) {
        log.info("User {} follows artist {}", user.getId(), id);
        artistService.followArtist(user.getId(), id);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @DeleteMapping("/{id}/follow")
    public ResponseEntity<Void> unfollowArtist(@CurrentUser CustomUserDetails user,
                                                @PathVariable String id) {
        log.info("User {} unfollows artist {}", user.getId(), id);
        artistService.unfollowArtist(user.getId(), id);
        return ResponseEntity.noContent().build();
    }
}