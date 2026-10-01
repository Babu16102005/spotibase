package com.spotibase.controller;

import com.spotibase.dto.response.AlbumResponse;
import com.spotibase.dto.response.ArtistResponse;
import com.spotibase.dto.response.LibraryResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.PlaylistResponse;
import com.spotibase.dto.response.SongCardResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.AlbumService;
import com.spotibase.service.ArtistService;
import com.spotibase.service.LibraryFacade;
import com.spotibase.service.PlaylistService;
import com.spotibase.service.SongService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/library")
@RequiredArgsConstructor
@Slf4j
public class LibraryController {

    private final LibraryFacade libraryFacade;
    private final PlaylistService playlistService;
    private final AlbumService albumService;
    private final ArtistService artistService;
    private final SongService songService;

    /** Personalized responses: private, 30s (matches the {@code library} cache TTL). */
    private static CacheControl libraryCacheControl() {
        return CacheControl.maxAge(30, TimeUnit.SECONDS).cachePrivate();
    }

    /**
     * Library aggregate, assembled by {@link LibraryFacade} with parallel
     * fan-out over the five parts (each fail-open).
     *
     * @param fields {@code card} truncates the embedded {@code likedSongs} to
     *               30 full-shape entries for a lighter first paint; the
     *               aggregate keeps its stable contract (totals + shapes).
     *               Use {@code /library/liked-songs?fields=card} for true card
     *               payloads. Missing/anything else means {@code full}.
     */
    @GetMapping
    public ResponseEntity<LibraryResponse> getLibrary(
            @CurrentUser CustomUserDetails user,
            @RequestParam(defaultValue = "full") String fields) {
        log.info("Get library for user: {}", user.getId());
        LibraryResponse library = libraryFacade.getLibrary(user.getId());
        if (SongCardResponse.isCardView(fields)
                && library.getLikedSongs() != null && library.getLikedSongs().size() > 30) {
            library.setLikedSongs(library.getLikedSongs().stream()
                    .limit(30)
                    .collect(Collectors.toList()));
        }
        return ResponseEntity.ok().cacheControl(libraryCacheControl()).body(library);
    }

    @GetMapping("/playlists")
    public ResponseEntity<List<PlaylistResponse>> getLibraryPlaylists(@CurrentUser CustomUserDetails user) {
        log.info("Get library playlists for user: {}", user.getId());
        return ResponseEntity.ok()
                .cacheControl(libraryCacheControl())
                .body(playlistService.getUserPlaylists(user.getId()));
    }

    @GetMapping("/albums")
    public ResponseEntity<List<AlbumResponse>> getLikedAlbums(@CurrentUser CustomUserDetails user) {
        log.info("Get liked albums for user: {}", user.getId());
        return ResponseEntity.ok()
                .cacheControl(libraryCacheControl())
                .body(albumService.getLikedAlbums(user.getId()));
    }

    @GetMapping("/artists")
    public ResponseEntity<List<ArtistResponse>> getLikedArtists(@CurrentUser CustomUserDetails user) {
        log.info("Get liked artists for user: {}", user.getId());
        return ResponseEntity.ok()
                .cacheControl(libraryCacheControl())
                .body(artistService.getLikedArtists(user.getId()));
    }

    /**
     * @param fields {@code card} returns slim cards (capped at 30);
     *               missing/anything else returns full {@link SongResponse}s.
     */
    @GetMapping("/liked-songs")
    public ResponseEntity<?> getLikedSongs(
            @CurrentUser CustomUserDetails user,
            @RequestParam(defaultValue = "full") String fields) {
        log.info("Get liked songs for user: {}", user.getId());
        List<SongResponse> likedSongs = songService.getLikedSongs(user.getId());
        if (SongCardResponse.isCardView(fields)) {
            return ResponseEntity.ok()
                    .cacheControl(libraryCacheControl())
                    .body(SongCardResponse.fromList(
                            likedSongs.stream().limit(30).collect(Collectors.toList())));
        }
        return ResponseEntity.ok().cacheControl(libraryCacheControl()).body(likedSongs);
    }

    /**
     * @param fields {@code card} returns slim cards (capped at 30);
     *               missing/anything else returns full {@link SongResponse}s.
     */
    @GetMapping("/recent")
    public ResponseEntity<?> getRecentlyPlayed(
            @CurrentUser CustomUserDetails user,
            @RequestParam(defaultValue = "full") String fields) {
        log.info("Get recently played for user: {}", user.getId());
        List<SongResponse> recent = songService.getRecentlyPlayed(user.getId());
        if (SongCardResponse.isCardView(fields)) {
            return ResponseEntity.ok()
                    .cacheControl(libraryCacheControl())
                    .body(SongCardResponse.fromList(
                            recent.stream().limit(30).collect(Collectors.toList())));
        }
        return ResponseEntity.ok().cacheControl(libraryCacheControl()).body(recent);
    }

    /**
     * @param fields {@code card} clamps the page to 30 and returns slim cards;
     *               missing/anything else returns full {@link SongResponse}s.
     */
    @GetMapping("/history")
    public ResponseEntity<?> getListeningHistory(
            @CurrentUser CustomUserDetails user,
            @PageableDefault(sort = "playedAt", direction = Sort.Direction.DESC) Pageable pageable,
            @RequestParam(defaultValue = "full") String fields) {
        log.info("Get listening history for user: {}", user.getId());
        // Clamp client-supplied page size (COUNT-free Slice still needs a
        // bounded LIMIT; ?size=10000 must not become LIMIT 10000).
        // Card pages are capped at 30 for fast list rendering.
        int maxSize = SongCardResponse.isCardView(fields) ? 30 : 50;
        Pageable safe = org.springframework.data.domain.PageRequest.of(
                Math.max(0, pageable.getPageNumber()),
                Math.max(1, Math.min(pageable.getPageSize(), maxSize)),
                pageable.getSort());
        PagedResponse<SongResponse> history = songService.getListeningHistory(user.getId(), safe);
        if (SongCardResponse.isCardView(fields)) {
            return ResponseEntity.ok()
                    .cacheControl(libraryCacheControl())
                    .body(SongCardResponse.projectPage(history));
        }
        return ResponseEntity.ok().cacheControl(libraryCacheControl()).body(history);
    }
}
