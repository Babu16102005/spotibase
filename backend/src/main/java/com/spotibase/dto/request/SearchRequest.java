package com.spotibase.dto.request;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SearchRequest {

    private String query;

    @Builder.Default
    private List<String> types = List.of("song", "album", "artist", "playlist");

    @Builder.Default
    private int page = 0;
    @Builder.Default
    private int size = 20;
    private String language;
    private Integer year;
    private String genre;
    private String sortBy; // relevance, recent, popularity
}
