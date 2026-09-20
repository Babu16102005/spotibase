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
public class HomeResponse implements Serializable {
    private String greeting;
    private List<Section> sections;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Section implements Serializable {
        private String id;
        private String title;
        private String type; // SONG, ALBUM, ARTIST, PLAYLIST, GENRE
        private String subtitle;
        private List<?> items;
    }
}
