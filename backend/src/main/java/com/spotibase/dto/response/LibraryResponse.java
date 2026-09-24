package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import java.io.Serializable;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LibraryResponse implements Serializable {
    private List<PlaylistResponse> playlists;
    private List<AlbumResponse> albums;
    private List<ArtistResponse> artists;
    private List<SongResponse> likedSongs;
    private int totalPlaylists;
    private int totalAlbums;
    private int totalArtists;
    private int totalLikedSongs;
    // Featured playlists (public, ordered by likeCount). Added alongside
    // user playlists so clients get discovery content in one call.
    // Kept separate from `playlists` for back-compat.
    @Builder.Default
    private List<PlaylistResponse> featuredPlaylists = new java.util.ArrayList<>();
    @Builder.Default
    private int totalFeaturedPlaylists = 0;
}
