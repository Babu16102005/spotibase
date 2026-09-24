package com.spotibase.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotibase.dto.request.CreateSongRequest;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.Song;
import com.spotibase.exception.InvalidRangeException;
import com.spotibase.exception.ResourceNotFoundException;
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
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;

import java.io.IOException;
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
        int safePage = Math.max(0, page);
        // Clamp: page size defaults to 20, hard cap 50 to protect DB/cache.
        int safeSize = size <= 0 ? 20 : Math.min(size, 50);
        log.info("Get all songs, page: {}, size: {} (requested page={}, size={})", safePage, safeSize, page, size);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(songService.getAllSongs(safePage, safeSize, userId));
    }

    /**
     * Cursor-based infinite scroll: pass the last seen song id as
     * {@code cursorId} to fetch the next slice. Prefer this over deep
     * page offsets for large catalogs (index-only id scan + batch fetch).
     */
    @GetMapping("/cursor")
    public ResponseEntity<List<SongResponse>> getSongsCursor(
            @RequestParam(required = false) String cursorId,
            @RequestParam(defaultValue = "20") int size,
            @CurrentUser CustomUserDetails user) {
        int safeSize = size <= 0 ? 20 : Math.min(size, 50);
        String userId = user != null ? user.getId() : null;
        log.info("Get songs cursor: cursorId={}, size={}", cursorId, safeSize);
        return ResponseEntity.ok(songService.getSongsAfterCursor(cursorId, safeSize, userId));
    }

    // NEW: Optimized home feed endpoint
    @GetMapping("/home")
    public ResponseEntity<PagedResponse<SongResponse>> getHomeFeed(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @CurrentUser CustomUserDetails user) {
        int safePage = Math.max(0, page);
        int safeSize = size <= 0 ? 20 : Math.min(size, 50);
        log.info("Get home feed, page: {}, size: {}", safePage, safeSize);
        Pageable pageable = PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "createdAt"));
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(songService.getHomeFeed(userId, pageable));
    }

    // NEW: Fast search endpoint
    @GetMapping("/search")
    public ResponseEntity<PagedResponse<SongResponse>> searchSongs(
            @RequestParam String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @CurrentUser CustomUserDetails user) {
        int safePage = Math.max(0, page);
        int safeSize = size <= 0 ? 20 : Math.min(size, 50);
        log.info("Search songs: {}", q);
        Pageable pageable = PageRequest.of(safePage, safeSize);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(songService.searchSongs(q, userId, pageable));
    }

    @GetMapping("/{id}")
    public ResponseEntity<SongResponse> getSongById(@PathVariable String id,
                                                     @CurrentUser CustomUserDetails user) {
        log.info("Get song by id: {}", id);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(songService.getSongById(id, userId));
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
        int safeLimit = limit <= 0 ? 20 : Math.min(limit, 50);
        log.info("Get trending songs, limit: {} (requested {})", safeLimit, limit);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(songService.getTrendingSongs(userId, safeLimit));
    }

    @GetMapping("/new-releases")
    public ResponseEntity<List<SongResponse>> getNewReleases(@CurrentUser CustomUserDetails user,
                                                              @RequestParam(defaultValue = "20") int limit) {
        int safeLimit = limit <= 0 ? 20 : Math.min(limit, 50);
        log.info("Get new releases, limit: {} (requested {})", safeLimit, limit);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(songService.getNewReleases(userId, safeLimit));
    }

    @GetMapping("/featured")
    public ResponseEntity<List<SongResponse>> getFeaturedSongs(@CurrentUser CustomUserDetails user,
                                                                @RequestParam(defaultValue = "20") int limit) {
        int safeLimit = limit <= 0 ? 20 : Math.min(limit, 50);
        log.info("Get featured songs, limit: {} (requested {})", safeLimit, limit);
        String userId = user != null ? user.getId() : null;
        return ResponseEntity.ok(songService.getFeaturedSongs(userId, safeLimit));
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

    /**
     * Stream contract (permitAll, see {@code SecurityConfig}):
     * <ul>
     *   <li>GET with/without {@code Range} -&gt; always {@code 206} with
     *       {@code Content-Range + Accept-Ranges + Content-Length} (seekable
     *       from the first byte). An un-ranged request serves the first 1MB
     *       chunk for sub-300ms audio start instead of a 12s full-file fetch.</li>
     *   <li>HEAD -&gt; {@code 200} with {@code Content-Length + Content-Type}
     *       (+ {@code ETag}), no body, never counted as a play.</li>
     *   <li>Unsatisfiable/malformed {@code Range} -&gt; {@code 416} with
     *       {@code Content-Range: bytes *&#47;size} (never 500).</li>
     *   <li>{@code If-None-Match} match -&gt; {@code 304}; stale
     *       {@code If-Range} -&gt; Range ignored, default first chunk.</li>
     *   <li>Plays are counted only for the first chunk
     *       ({@code start==0}), un-ranged requests, or explicit
     *       {@code ?count=1} — seeks and re-buffers never inflate counts —
     *       and are fired {@code @Async} after headers are fixed, so the
     *       stream thread never blocks on analytics writes.</li>
     * </ul>
     */
    @GetMapping("/{id}/stream")
    public ResponseEntity<StreamingResponseBody> streamSong(@PathVariable String id,
                                        @RequestParam(value = "count", required = false) String countParam,
                                        HttpServletRequest request,
                                        Authentication authentication) {
        boolean headRequest = "HEAD".equalsIgnoreCase(request.getMethod());
        String userId = authentication != null && authentication.getPrincipal() instanceof CustomUserDetails cd ? cd.getId() : "anonymous";
        log.info("{} stream song: {} for user: {}", request.getMethod(), id, userId);

        // Cheap cached lookup (fileUrl + fileFormat projection, 'stream:{id}');
        // falls back to the full entity when the cache/ref is unavailable.
        // Lookup happens BEFORE analytics so missing songs 404 instead of
        // recording phantom plays (or 500ing on the history FK).
        String fileUrl = null;
        String fileFormat = null;
        try {
            SongService.SongStreamRef ref = songService.getSongStreamRef(id);
            if (ref != null) {
                fileUrl = ref.fileUrl();
                fileFormat = ref.fileFormat();
            }
        } catch (ResourceNotFoundException e) {
            throw e;
        } catch (Exception e) {
            log.debug("Stream ref lookup failed for {}, falling back to entity: {}", id, e.getMessage());
        }
        if (fileUrl == null || fileUrl.isBlank()) {
            Song song = songService.getSongEntityById(id);
            fileUrl = song.getFileUrl();
            fileFormat = song.getFileFormat();
        }

        if (fileUrl == null || fileUrl.isBlank()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(null);
        }

        // R2 streaming: browsers need a CORS-aware proxy; native mobile clients
        // (React Native / TrackPlayer) can consume a direct redirect to the R2
        // public URL without any CORS concern, which eliminates the >2s proxy
        // download overhead that was causing songs to not play on mobile.
        if (fileUrl.contains("r2.cloudflarestorage.com") || fileUrl.contains("r2.dev")) {
            String userAgent = request.getHeader("User-Agent");
            boolean isBrowser = userAgent != null &&
                    (userAgent.contains("Mozilla") || userAgent.contains("Chrome") ||
                     userAgent.contains("Safari") || userAgent.contains("Firefox") ||
                     userAgent.contains("Edge"));
            if (!isBrowser) {
                // Native mobile client: redirect directly to R2 public URL for instant start.
                // Same play-count gating as the proxy path (seeks/HEAD never count).
                // P0-3: analytics are fire-and-forget — a saturated pool or DB
                // failure must never 500 the redirect.
                if (!headRequest && shouldCountPlay(request.getHeader("Range"), countParam, -1)) {
                    try {
                        songService.incrementPlayCount(id);
                        if (!"anonymous".equals(userId)) {
                            songService.recordPlayback(userId, id, "STREAM");
                        }
                    } catch (Exception e) {
                        log.warn("Stream analytics failed for song {}: {}", id, e.getMessage());
                    }
                }
                log.info("Redirecting native client to R2 URL for song: {}", id);
                HttpHeaders redirectHeaders = new HttpHeaders();
                redirectHeaders.set("Accept-Ranges", "bytes");
                redirectHeaders.set("Cache-Control", "public, max-age=3600");
                redirectHeaders.setLocation(URI.create(fileUrl));
                return ResponseEntity.status(HttpStatus.FOUND).headers(redirectHeaders).body(null);
            }
            return handleR2Streaming(id, fileUrl, fileFormat, request, userId, countParam);
        }

        // For Supabase Storage, generate signed URL with Range support
        String signedUrl = storageService.getSignedUrl(extractSupabasePath(fileUrl), 3600);
        return handleSignedUrlStreaming(signedUrl, request);
    }

    private ResponseEntity<StreamingResponseBody> handleR2Streaming(String songId, String fileUrl, String fileFormat,
                                                HttpServletRequest request, String userId,
                                                String countParam) {
        boolean headRequest = "HEAD".equalsIgnoreCase(request.getMethod());
        String key = r2StorageService.resolveKey(fileUrl);
        if (key == null || key.isBlank()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(null);
        }

        // One HEAD gives size + eTag + type: powers 304/416/validation without
        // fetching any bytes. Missing key -> 404, upstream failure -> 502.
        R2StorageService.R2ObjectInfo info = r2StorageService.headObject(key);
        long objectSize = info.size();
        String eTag = normalizeETag(info.eTag());
        String contentType = safeContentType(resolveContentType(fileFormat, info.contentType()));

        HttpHeaders headers = new HttpHeaders();
        headers.set("Accept-Ranges", "bytes");
        // Proxy responses revalidate hourly. R2 keys are UUID-immutable so a
        // longer max-age would be safe, but 3600 keeps metadata corrections
        // deployable fast and matches the native-redirect path.
        headers.set("Cache-Control", "public, max-age=3600");
        if (eTag != null) {
            headers.setETag(eTag);
        }
        headers.set("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length, Content-Type, ETag");
        headers.set("X-Content-Type-Options", "nosniff");

        if (headRequest) {
            // HEAD: metadata only, never counted as a play.
            headers.setContentType(MediaType.parseMediaType(contentType));
            headers.setContentLength(objectSize);
            return ResponseEntity.status(HttpStatus.OK).headers(headers).body(null);
        }

        // Conditional GET: the client already holds these exact bytes.
        // A 304 carries no body and is not a play.
        if (matchesETag(request.getHeader("If-None-Match"), eTag)) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED).headers(headers).body(null);
        }

        String rangeHeader = request.getHeader("Range");
        R2StorageService.ParsedRange parsed;
        try {
            parsed = R2StorageService.parseRange(rangeHeader);
        } catch (InvalidRangeException e) {
            return rangeNotSatisfiable(objectSize);
        }

        // If-Range (ETag form): a stale validator means the client is seeking
        // in an outdated object — ignore the Range and serve the default
        // first chunk. Date-form If-Range cannot be compared (no mtime
        // tracked), so any non-matching value takes this path.
        String ifRange = request.getHeader("If-Range");
        if (ifRange != null && !ifRange.isBlank() && eTag != null && !matchesETag(ifRange, eTag)) {
            log.debug("If-Range mismatch for song {}, serving default first chunk", songId);
            parsed = null;
        }

        long[] resolved;
        try {
            resolved = R2StorageService.resolveRange(parsed, objectSize);
        } catch (InvalidRangeException e) {
            return rangeNotSatisfiable(objectSize);
        }
        String s3Range = "bytes=" + resolved[0] + "-" + resolved[1];

        R2StorageService.R2ObjectStream os;
        try {
            os = r2StorageService.readRange(key, s3Range);
        } catch (InvalidRangeException e) {
            return rangeNotSatisfiable(objectSize);
        }
        // R2's Content-Range is authoritative (covers S3 end-clamping).
        long start = os.start();
        long end = os.end();
        objectSize = os.objectSize();
        if (os.eTag() != null) {
            String freshTag = normalizeETag(os.eTag());
            if (freshTag != null) {
                eTag = freshTag;
                headers.setETag(eTag);
            }
        }

        headers.setContentType(MediaType.parseMediaType(safeContentType(resolveContentType(fileFormat, os.contentType()))));
        headers.setContentLength(end - start + 1);
        headers.set("Content-Range", "bytes " + start + "-" + end + "/" + objectSize);

        // Analytics AFTER headers are fixed, fire-and-forget (@Async): only
        // the first chunk (start==0), an un-ranged request, or explicit
        // ?count=1 counts as a play. Seeks, suffix tails, 304s, 416s and
        // HEADs never inflate play counts. P0-3: wrapped so async rejection
        // or DB failure degrades to a warn, never a 500.
        if (shouldCountPlay(rangeHeader, countParam, objectSize)) {
            try {
                songService.incrementPlayCount(songId);
                if (userId != null && !"anonymous".equals(userId)) {
                    songService.recordPlayback(userId, songId, "STREAM");
                }
            } catch (Exception e) {
                log.warn("Stream analytics failed for song {}: {}", songId, e.getMessage());
            }
        }

        // StreamingResponseBody with a 64KB buffer + try-with-resources: the
        // R2 stream is always closed, including on client abort mid-download.
        // Always 206 (even for the default no-Range first-1MB chunk) so
        // players get seekable Content-Range semantics from the first byte.
        ResponseInputStream<GetObjectResponse> r2stream = os.stream();
        StreamingResponseBody body = outputStream -> {
            try (ResponseInputStream<GetObjectResponse> in = r2stream) {
                byte[] buffer = new byte[65536];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    outputStream.write(buffer, 0, read);
                }
                outputStream.flush();
            } catch (IOException e) {
                log.debug("Stream aborted for song {}: {}", songId, e.getMessage());
            }
        };
        return ResponseEntity.status(HttpStatus.PARTIAL_CONTENT).headers(headers).body(body);
    }

    /**
     * Whether this stream request counts as a play: explicit
     * {@code ?count=1} always counts; otherwise only un-ranged requests and
     * ranges starting at byte 0 (a suffix {@code bytes=-N} counts only when
     * it covers the whole object). Malformed ranges never count (they 416).
     * {@code objectSize &lt; 0} (unknown, e.g. native-redirect path) means
     * suffix ranges do not count.
     */
    static boolean shouldCountPlay(String rangeHeader, String countParam, long objectSize) {
        if ("1".equals(countParam)) {
            return true;
        }
        if (rangeHeader == null || rangeHeader.isBlank()) {
            return true;
        }
        R2StorageService.ParsedRange parsed;
        try {
            parsed = R2StorageService.parseRange(rangeHeader);
        } catch (InvalidRangeException e) {
            return false;
        }
        if (parsed == null) {
            return true;
        }
        if (parsed.suffix()) {
            return objectSize >= 0 && parsed.end() >= objectSize;
        }
        return parsed.start() == 0;
    }

    private ResponseEntity<StreamingResponseBody> rangeNotSatisfiable(long objectSize) {
        HttpHeaders headers = new HttpHeaders();
        headers.set("Accept-Ranges", "bytes");
        headers.set("Content-Range", "bytes */" + objectSize);
        headers.set("Cache-Control", "public, max-age=3600");
        return ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE).headers(headers).body(null);
    }

    static String normalizeETag(String eTag) {
        if (eTag == null || eTag.isBlank()) {
            return null;
        }
        String tag = eTag.trim();
        if (tag.startsWith("W/")) {
            return tag;
        }
        if (tag.length() >= 2 && tag.startsWith("\"") && tag.endsWith("\"")) {
            return tag;
        }
        return "\"" + tag + "\"";
    }

    static boolean matchesETag(String headerValue, String eTag) {
        if (headerValue == null || headerValue.isBlank() || eTag == null) {
            return false;
        }
        String value = headerValue.trim();
        if ("*".equals(value)) {
            return true;
        }
        String expected = stripETag(value.startsWith("W/") ? value.substring(2).trim() : value);
        String actual = stripETag(eTag.startsWith("W/") ? eTag.substring(2).trim() : eTag);
        for (String part : value.split(",")) {
            String candidate = part.trim();
            if ("*".equals(candidate)) {
                return true;
            }
            if (stripETag(candidate.startsWith("W/") ? candidate.substring(2).trim() : candidate).equals(actual)
                    || candidate.equals(expected)) {
                return true;
            }
        }
        return false;
    }

    private static String stripETag(String tag) {
        String t = tag.trim();
        if (t.length() >= 2 && t.startsWith("\"") && t.endsWith("\"")) {
            return t.substring(1, t.length() - 1);
        }
        return t;
    }

    /** Guards against garbage upstream content-types turning into a 500. */
    private String safeContentType(String contentType) {
        if (contentType == null || contentType.isBlank()) {
            return "application/octet-stream";
        }
        try {
            MediaType.parseMediaType(contentType);
            return contentType;
        } catch (Exception e) {
            log.debug("Unparseable content-type '{}', falling back to octet-stream", contentType);
            return "application/octet-stream";
        }
    }

    private String resolveContentType(String fileFormat, String fallback) {
        if (fileFormat != null) {
            switch (fileFormat.toUpperCase()) {
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

    private ResponseEntity<StreamingResponseBody> handleSignedUrlStreaming(String signedUrl, HttpServletRequest request) {
        String rangeHeader = request.getHeader("Range");
        HttpHeaders headers = new HttpHeaders();
        headers.set("Accept-Ranges", "bytes");
        headers.setContentType(MediaType.parseMediaType("audio/mpeg"));
        headers.set("Cache-Control", "private, max-age=3600");
        headers.setLocation(URI.create(signedUrl));
        
        if (rangeHeader != null) {
            headers.set("Content-Range", "bytes */*");
        }
        
        return ResponseEntity.status(HttpStatus.FOUND).headers(headers).body(null);
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