package com.spotibase.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotibase.dto.request.CreateSongRequest;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.Song;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.LikeService;
import com.spotibase.service.R2StorageService;
import com.spotibase.service.SongService;
import com.spotibase.service.StorageService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.InputStreamResource;
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
    private final R2StorageService r2StorageService;
    private final ObjectMapper objectMapper;

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

    /**
     * Bulk upload: one or more audio files (multipart parts named "files") plus
     * an optional JSON array (part named "requests", aligned to files by index).
     * Metadata is auto-parsed from each file's audio tags (FLAC/MP3/WAV...) when
     * the client does not provide it. Files are stored unchanged, so FLAC stays
     * FLAC and is streamed with Range support.
     */
    @PostMapping(value = "/bulk", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<List<SongResponse>> createSongsBulk(
            @RequestParam("files") List<MultipartFile> files,
            @RequestPart(value = "requests", required = false) String requestsJson) {
        log.info("Bulk create songs: {} files", files != null ? files.size() : 0);
        List<CreateSongRequest> requests = parseRequests(requestsJson);
        return ResponseEntity.status(HttpStatus.CREATED).body(songService.createSongsBulk(files, requests));
    }

    private List<CreateSongRequest> parseRequests(String requestsJson) {
        if (requestsJson == null || requestsJson.isBlank()) {
            return new java.util.ArrayList<>();
        }
        try {
            return objectMapper.readValue(requestsJson, new com.fasterxml.jackson.core.type.TypeReference<List<CreateSongRequest>>() {});
        } catch (IOException e) {
            throw new com.spotibase.exception.BadRequestException("Invalid bulk upload metadata: " + e.getMessage());
        }
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
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(songService.getTrendingSongs(userId, limit));
    }

    @GetMapping("/new-releases")
    public ResponseEntity<List<SongResponse>> getNewReleases(@CurrentUser CustomUserDetails user,
                                                              @RequestParam(defaultValue = "20") int limit) {
        log.info("Get new releases, limit: {}", limit);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(songService.getNewReleases(userId, limit));
    }

    @GetMapping("/featured")
    public ResponseEntity<List<SongResponse>> getFeaturedSongs(@CurrentUser CustomUserDetails user,
                                                                @RequestParam(defaultValue = "20") int limit) {
        log.info("Get featured songs, limit: {}", limit);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(songService.getFeaturedSongs(userId, limit));
    }

    @PostMapping("/{id}/like")
    public ResponseEntity<Void> likeSong(@CurrentUser CustomUserDetails user,
                                          @PathVariable String id) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        log.info("User {} likes song {}", user.getId(), id);
        likeService.likeSong(user.getId(), id);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @DeleteMapping("/{id}/like")
    public ResponseEntity<Void> unlikeSong(@CurrentUser CustomUserDetails user,
                                            @PathVariable String id) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        log.info("User {} unlikes song {}", user.getId(), id);
        likeService.unlikeSong(user.getId(), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/stream")
    public ResponseEntity<?> streamSong(@PathVariable String id,
                                        HttpServletRequest request,
                                        Authentication authentication) {
        boolean headRequest = "HEAD".equalsIgnoreCase(request.getMethod());
        String userId = authentication != null && authentication.getPrincipal() instanceof CustomUserDetails cd ? cd.getId() : "anonymous";
        log.info("{} stream song: {} for user: {}", request.getMethod(), id, userId);
        if (!headRequest) {
            songService.incrementPlayCount(id);
            if (!"anonymous".equals(userId)) {
                songService.recordPlayback(userId, id, "STREAM");
            }
        }

        Song song = songService.getSongEntityById(id);
        String fileUrl = song.getFileUrl();

        if (fileUrl == null || fileUrl.isBlank()) {
            return ResponseEntity.notFound().build();
        }

        // R2: proxy the bytes through the backend so browsers get Range
        // support AND CORS headers. r2.dev public URLs do not send CORS
        // headers, so a direct redirect is unusable from the web client.
        if (fileUrl.contains("r2.cloudflarestorage.com") || fileUrl.contains("r2.dev")) {
            return handleR2Streaming(song, fileUrl, request);
        }

        // For Supabase Storage, generate signed URL with Range support
        String signedUrl = storageService.getSignedUrl(extractSupabasePath(fileUrl), 3600);
        return handleSignedUrlStreaming(signedUrl, request);
    }

    private ResponseEntity<?> handleR2Streaming(Song song, String fileUrl, HttpServletRequest request) {
        String key = r2StorageService.resolveKey(fileUrl);
        HttpHeaders headers = new HttpHeaders();
        headers.set("Accept-Ranges", "bytes");
        headers.set("Cache-Control", "public, max-age=31536000");

        if ("HEAD".equalsIgnoreCase(request.getMethod())) {
            R2StorageService.R2ObjectInfo info = r2StorageService.headObject(key);
            headers.setContentType(MediaType.parseMediaType(resolveContentType(song, info.contentType())));
            headers.setContentLength(info.size());
            return ResponseEntity.status(HttpStatus.OK).headers(headers).build();
        }

        String rangeHeader = request.getHeader("Range");
        R2StorageService.R2ObjectStream os = r2StorageService.readRange(key, rangeHeader);
        headers.setContentType(MediaType.parseMediaType(resolveContentType(song, os.contentType())));
        headers.setContentLength(os.end() - os.start() + 1);
        headers.set("Content-Range", "bytes " + os.start() + "-" + os.end() + "/" + os.objectSize());
        HttpStatus status = os.isPartial() ? HttpStatus.PARTIAL_CONTENT : HttpStatus.OK;
        return ResponseEntity.status(status).headers(headers).body(new InputStreamResource(os.stream()));
    }

    private String resolveContentType(Song song, String fallback) {
        String format = song.getFileFormat();
        if (format != null) {
            switch (format.toUpperCase()) {
                case "FLAC": return "audio/flac";
                case "MP3": return "audio/mpeg";
                case "WAV": return "audio/wav";
                case "M4A": return "audio/mp4";
                case "OGG": return "audio/ogg";
                case "AAC": return "audio/aac";
                default: break;
            }
        }
        return fallback != null ? fallback : "application/octet-stream";
    }

    private ResponseEntity<Void> handleSignedUrlStreaming(String signedUrl, HttpServletRequest request) {
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