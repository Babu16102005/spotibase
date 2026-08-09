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
public class SearchResponse {
    private String query;
    private List<SongResponse> songs;
    private List<AlbumResponse> albums;
    private List<ArtistResponse> artists;
    private List<PlaylistResponse> playlists;
    private int totalResults;
    private int page;
    private int size;
    private boolean hasMore;
}
