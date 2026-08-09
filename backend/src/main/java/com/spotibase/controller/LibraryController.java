package com.spotibase.controller;

import com.spotibase.dto.response.AlbumResponse;
import com.spotibase.dto.response.ArtistResponse;
import com.spotibase.dto.response.LibraryResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.PlaylistResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.AlbumService;
import com.spotibase.service.ArtistService;
import com.spotibase.service.PlaylistService;
import com.spotibase.service.SongService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/library")
@RequiredArgsConstructor
@Slf4j
public class LibraryController {

    private final PlaylistService playlistService;
    private final AlbumService albumService;
    private final ArtistService artistService;
    private final SongService songService;

    @GetMapping
    public ResponseEntity<LibraryResponse> getLibrary(@CurrentUser CustomUserDetails user) {
        log.info("Get library for user: {}", user.getId());
        List<PlaylistResponse> playlists = playlistService.getUserPlaylists(user.getId());
        List<SongResponse> likedSongs = songService.getLikedSongs(user.getId());
        List<AlbumResponse> likedAlbums = albumService.getLikedAlbums(user.getId());
        List<ArtistResponse> likedArtists = artistService.getLikedArtists(user.getId());

        return ResponseEntity.ok(LibraryResponse.builder()
                .playlists(playlists)
                .albums(likedAlbums)
                .artists(likedArtists)
                .likedSongs(likedSongs)
                .totalPlaylists(playlists.size())
                .totalAlbums(likedAlbums.size())
                .totalArtists(likedArtists.size())
                .totalLikedSongs(likedSongs.size())
                .build());
    }

    @GetMapping("/playlists")
    public ResponseEntity<List<PlaylistResponse>> getLibraryPlaylists(@CurrentUser CustomUserDetails user) {
        log.info("Get library playlists for user: {}", user.getId());
        return ResponseEntity.ok(playlistService.getUserPlaylists(user.getId()));
    }

    @GetMapping("/albums")
    public ResponseEntity<List<AlbumResponse>> getLikedAlbums(@CurrentUser CustomUserDetails user) {
        log.info("Get liked albums for user: {}", user.getId());
        return ResponseEntity.ok(albumService.getLikedAlbums(user.getId()));
    }

    @GetMapping("/artists")
    public ResponseEntity<List<ArtistResponse>> getLikedArtists(@CurrentUser CustomUserDetails user) {
        log.info("Get liked artists for user: {}", user.getId());
        return ResponseEntity.ok(artistService.getLikedArtists(user.getId()));
    }

    @GetMapping("/liked-songs")
    public ResponseEntity<List<SongResponse>> getLikedSongs(@CurrentUser CustomUserDetails user) {
        log.info("Get liked songs for user: {}", user.getId());
        return ResponseEntity.ok(songService.getLikedSongs(user.getId()));
    }

    @GetMapping("/recent")
    public ResponseEntity<List<SongResponse>> getRecentlyPlayed(@CurrentUser CustomUserDetails user) {
        log.info("Get recently played for user: {}", user.getId());
        return ResponseEntity.ok(songService.getRecentlyPlayed(user.getId()));
    }

    @GetMapping("/history")
    public ResponseEntity<PagedResponse<SongResponse>> getListeningHistory(
            @CurrentUser CustomUserDetails user,
            @PageableDefault(sort = "playedAt", direction = Sort.Direction.DESC) Pageable pageable) {
        log.info("Get listening history for user: {}", user.getId());
        return ResponseEntity.ok(songService.getListeningHistory(user.getId(), pageable));
    }
}