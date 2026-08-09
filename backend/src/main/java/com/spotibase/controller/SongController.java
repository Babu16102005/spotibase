package com.spotibase.controller;

import com.spotibase.dto.request.CreateSongRequest;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.Song;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.LikeService;
import com.spotibase.service.SongService;
import com.spotibase.service.StorageService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;

@RestController
@RequestMapping("/api/v1/songs")
@RequiredArgsConstructor
@Slf4j
public class SongController {

    private final SongService songService;
    private final LikeService likeService;
    private final StorageService storageService;

    @GetMapping
    public ResponseEntity<PagedResponse<SongResponse>> getAllSongs(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @CurrentUser CustomUserDetails user) {
        log.info("Get all songs, page: {}, size: {}", page, size);
        return ResponseEntity.ok(songService.getAllSongs(page, size, user.getId()));
    }

    // NEW: Optimized home feed endpoint
    @GetMapping("/home")
    public ResponseEntity<PagedResponse<SongResponse>> getHomeFeed(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @CurrentUser CustomUserDetails user) {
        log.info("Get home feed, page: {}, size: {}", page, size);
        Pageable pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        return ResponseEntity.ok(songService.getHomeFeed(user.getId(), pageable));
    }

    // NEW: Fast search endpoint
    @GetMapping("/search")
    public ResponseEntity<PagedResponse<SongResponse>> searchSongs(
            @RequestParam String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @CurrentUser CustomUserDetails user) {
        log.info("Search songs: {}", q);
        Pageable pageable = PageRequest.of(page, size);
        return ResponseEntity.ok(songService.searchSongs(q, user.getId(), pageable));
    }

    @GetMapping("/{id}")
    public ResponseEntity<SongResponse> getSongById(@PathVariable String id,
                                                     @CurrentUser CustomUserDetails user) {
        log.info("Get song by id: {}", id);
        return ResponseEntity.ok(songService.getSongById(id, user.getId()));
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<SongResponse> createSong(@Valid @RequestPart("request") CreateSongRequest request,
                                                    @RequestPart(value = "audioFile", required = false) MultipartFile audioFile,
                                                    @RequestPart(value = "coverFile", required = false) MultipartFile coverFile) {
        log.info("Create song: {}", request.getTitle());
        return ResponseEntity.status(HttpStatus.CREATED).body(songService.createSong(request, audioFile, coverFile));
    }

    @PutMapping(value = "/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<SongResponse> updateSong(@PathVariable String id,
                                                    @Valid @RequestPart("request") CreateSongRequest request,
                                                    @RequestPart(value = "audioFile", required = false) MultipartFile audioFile,
                                                    @RequestPart(value = "coverFile", required = false) MultipartFile coverFile) {
        log.info("Update song: {}", id);
        return ResponseEntity.ok(songService.updateSong(id, request, audioFile, coverFile));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<Void> deleteSong(@PathVariable String id) {
        log.info("Delete song: {}", id);
        songService.deleteSong(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/restore")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> restoreSong(@PathVariable String id) {
        log.info("Restore song: {}", id);
        songService.restoreSong(id);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/trending")
    public ResponseEntity<List<SongResponse>> getTrendingSongs(@CurrentUser CustomUserDetails user,
                                                                @RequestParam(defaultValue = "20") int limit) {
        log.info("Get trending songs, limit: {}", limit);
        return ResponseEntity.ok(songService.getTrendingSongs(user.getId(), limit));
    }

    @GetMapping("/new-releases")
    public ResponseEntity<List<SongResponse>> getNewReleases(@CurrentUser CustomUserDetails user,
                                                              @RequestParam(defaultValue = "20") int limit) {
        log.info("Get new releases, limit: {}", limit);
        return ResponseEntity.ok(songService.getNewReleases(user.getId(), limit));
    }

    @GetMapping("/featured")
    public ResponseEntity<List<SongResponse>> getFeaturedSongs(@CurrentUser CustomUserDetails user,
                                                                @RequestParam(defaultValue = "20") int limit) {
        log.info("Get featured songs, limit: {}", limit);
        return ResponseEntity.ok(songService.getFeaturedSongs(user.getId(), limit));
    }

    @PostMapping("/{id}/like")
    public ResponseEntity<Void> likeSong(@CurrentUser CustomUserDetails user,
                                          @PathVariable String id) {
        log.info("User {} likes song {}", user.getId(), id);
        likeService.likeSong(user.getId(), id);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @DeleteMapping("/{id}/like")
    public ResponseEntity<Void> unlikeSong(@CurrentUser CustomUserDetails user,
                                            @PathVariable String id) {
        log.info("User {} unlikes song {}", user.getId(), id);
        likeService.unlikeSong(user.getId(), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/stream")
    public ResponseEntity<?> streamSong(@PathVariable String id,
                                        HttpServletRequest request,
                                        Authentication authentication) {
        String userId = authentication != null && authentication.getPrincipal() instanceof CustomUserDetails cd ? cd.getId() : "anonymous";
        log.info("Stream song: {} for user: {}", id, userId);
        songService.incrementPlayCount(id);
        
        Song song = songService.getSongEntityById(id);
        String fileUrl = song.getFileUrl();
        
        if (fileUrl == null || fileUrl.isBlank()) {
            return ResponseEntity.notFound().build();
        }
        
        // If using R2 with public URL, redirect with Range support
        if (fileUrl.contains("r2.cloudflarestorage.com") || fileUrl.contains("r2.dev")) {
            return handleR2Streaming(fileUrl, request);
        }
        
        // For Supabase Storage, generate signed URL with Range support
        String signedUrl = storageService.getSignedUrl(extractSupabasePath(fileUrl), 3600);
        return handleSignedUrlStreaming(signedUrl, request);
    }
    
    private ResponseEntity<Void> handleR2Streaming(String fileUrl, HttpServletRequest request) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Accept-Ranges", "bytes");
        headers.setContentType(MediaType.parseMediaType("audio/mpeg"));
        headers.set("Cache-Control", "public, max-age=31536000");
        // Redirect to the CDN - R2 supports Range requests natively and avoids proxy buffering
        headers.setLocation(URI.create(fileUrl));
        return ResponseEntity.status(HttpStatus.FOUND).headers(headers).build();
    }
    
    private ResponseEntity<Resource> handleSignedUrlStreaming(String signedUrl, HttpServletRequest request) {
        String rangeHeader = request.getHeader("Range");
        HttpHeaders headers = new HttpHeaders();
        headers.set("Accept-Ranges", "bytes");
        headers.setContentType(MediaType.parseMediaType("audio/mpeg"));
        headers.set("Cache-Control", "private, max-age=3600");
        headers.setLocation(URI.create(signedUrl));
        
        if (rangeHeader != null) {
            headers.set("Content-Range", "bytes */*");
        }
        
        return ResponseEntity.status(HttpStatus.FOUND).headers(headers).build();
    }
    
    private String extractSupabasePath(String publicUrl) {
        try {
            URI uri = new URI(publicUrl);
            String path = uri.getPath();
            int bucketIndex = path.indexOf("/spotibase/");
            if (bucketIndex >= 0) {
                return path.substring(bucketIndex + 1);
            }
            return path.startsWith("/") ? path.substring(1) : path;
        } catch (URISyntaxException e) {
            log.warn("Failed to parse Supabase URL: {}", publicUrl);
            return publicUrl;
        }
    }
}