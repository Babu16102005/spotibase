package com.spotibase.service;

import com.spotibase.dto.response.AlbumResponse;
import com.spotibase.dto.response.ArtistResponse;
import com.spotibase.dto.response.LibraryResponse;
import com.spotibase.dto.response.PlaylistResponse;
import com.spotibase.dto.response.SongResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Parallel fan-out for the library aggregate (Spotify-fast loads).
 *
 * <p>The five library parts (user playlists, liked songs, liked albums, liked
 * artists, featured playlists) are independent queries, so they run
 * concurrently on a bounded {@code library-} pool instead of sequentially.
 * Each future is fail-open with a 1.5s timeout: one slow/failing part degrades
 * to an empty section instead of failing the whole aggregate (same semantics
 * the controller previously hand-rolled for featured playlists only).
 *
 * <p>Runs with NO outer transaction ({@code NOT_SUPPORTED}): worker threads
 * cannot share the request-thread persistence context, and each nested service
 * call already opens its own short read-only transaction.
 *
 * <p>The assembled aggregate is cached 30s per user ({@code library} cache,
 * see {@code RedisCacheConfig}); the short TTL bounds staleness after
 * like/playlist mutations without extra eviction wiring.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class LibraryFacade {

    private static final long PART_TIMEOUT_MS = 1500;

    private static final AtomicLong THREAD_SEQ = new AtomicLong();

    private static final Executor LIBRARY_EXECUTOR = new ThreadPoolExecutor(
            5, 10, 60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(100),
            r -> {
                Thread t = new Thread(r, "library-" + THREAD_SEQ.incrementAndGet());
                t.setDaemon(true);
                return t;
            },
            new ThreadPoolExecutor.CallerRunsPolicy());

    private final PlaylistService playlistService;
    private final SongService songService;
    private final AlbumService albumService;
    private final ArtistService artistService;

    @Cacheable(value = "library", key = "#userId")
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public LibraryResponse getLibrary(String userId) {
        CompletableFuture<List<PlaylistResponse>> playlistsF =
                supplyFailOpen("playlists", () -> playlistService.getUserPlaylists(userId));
        CompletableFuture<List<SongResponse>> likedSongsF =
                supplyFailOpen("liked-songs", () -> songService.getLikedSongs(userId));
        CompletableFuture<List<AlbumResponse>> likedAlbumsF =
                supplyFailOpen("liked-albums", () -> albumService.getLikedAlbums(userId));
        CompletableFuture<List<ArtistResponse>> likedArtistsF =
                supplyFailOpen("liked-artists", () -> artistService.getLikedArtists(userId));
        CompletableFuture<List<PlaylistResponse>> featuredF =
                supplyFailOpen("featured-playlists", () -> playlistService.getFeaturedPlaylists(20));

        CompletableFuture.allOf(playlistsF, likedSongsF, likedAlbumsF, likedArtistsF, featuredF).join();

        List<PlaylistResponse> playlists = playlistsF.join();
        List<SongResponse> likedSongs = likedSongsF.join();
        List<AlbumResponse> likedAlbums = likedAlbumsF.join();
        List<ArtistResponse> likedArtists = likedArtistsF.join();
        List<PlaylistResponse> featuredPlaylists = featuredF.join();

        return LibraryResponse.builder()
                .playlists(playlists)
                .albums(likedAlbums)
                .artists(likedArtists)
                .likedSongs(likedSongs)
                .totalPlaylists(playlists.size())
                .totalAlbums(likedAlbums.size())
                .totalArtists(likedArtists.size())
                .totalLikedSongs(likedSongs.size())
                .featuredPlaylists(featuredPlaylists)
                .totalFeaturedPlaylists(featuredPlaylists.size())
                .build();
    }

    private static <T> CompletableFuture<List<T>> supplyFailOpen(
            String part, java.util.function.Supplier<List<T>> supplier) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                List<T> result = supplier.get();
                return result != null ? result : List.<T>of();
            } catch (Exception e) {
                log.warn("Library part '{}' failed, serving empty section: {}", part, e.getMessage());
                return List.<T>of();
            }
        }, LIBRARY_EXECUTOR)
                .orTimeout(PART_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .exceptionally(e -> {
                    log.warn("Library part '{}' timed out/failed, serving empty section: {}",
                            part, e.getMessage());
                    return List.of();
                });
    }
}
