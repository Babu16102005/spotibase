package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LibraryResponse {
    private List<PlaylistResponse> playlists;
    private List<AlbumResponse> albums;
    private List<ArtistResponse> artists;
    private List<SongResponse> likedSongs;
    private int totalPlaylists;
    private int totalAlbums;
    private int totalArtists;
    private int totalLikedSongs;
}
