package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import java.io.Serializable;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import com.fasterxml.jackson.annotation.JsonIgnore;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class HomeResponse implements Serializable {
    private String greeting;
    private List<Section> sections;
    /**
     * Completeness flag for cache-gating: false when any REQUIRED section id
     * for the tier is missing from {@link #sections} (slow section timed out /
     * failed fail-open). Partial feeds still return HTTP 200, they are just
     * never cached (see {@code unless="... || !#result.complete"} on the tier
     * {@code @Cacheable}s). Never serialized to clients or Redis JSON; L1
     * reference-cached copies keep the in-memory value.
     */
    @JsonIgnore
    @Builder.Default
    private boolean complete = true;

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
