package com.spotibase.dto.response;

import java.io.Serializable;
import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Slim list-card projection of {@link SongResponse} for Spotify-fast loads.
 *
 * <p>Card shape is exactly
 * {@code id, title, artistName, coverUrl, durationMs, likeCount} — everything a
 * list row / grid tile renders without opening the detail view. Full
 * {@link SongResponse} (lyrics, file URLs, AI tags, contributors, ...) is only
 * served for detail endpoints and for list calls that omit {@code ?fields} or
 * pass {@code ?fields=full}.
 *
 * <p>Contract notes:
 * <ul>
 *   <li>{@code ?fields} accepts {@code card} (case-insensitive) or
 *       {@code full}. Missing, blank, or any other value means {@code full},
 *       so existing clients are unaffected (backward-compat default).</li>
 *   <li>Songs have no {@code like_count} column (they track
 *       {@code playCount}); the card {@code likeCount} is an alias of
 *       {@code playCount} so card tiles can render a single popularity number
 *       without a schema change.</li>
 *   <li>Card lists are clamped: {@code size <= 30} for card lists,
 *       {@code size <= 20} for search. Controllers enforce the clamp before
 *       querying; these helpers only project.</li>
 * </ul>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SongCardResponse implements Serializable {

    private String id;
    private String title;
    private String artistName;
    private String coverUrl;
    private long durationMs;
    private long likeCount;

    /** {@code true} only for {@code ?fields=card} (case-insensitive). */
    public static boolean isCardView(String fields) {
        return fields != null && "card".equalsIgnoreCase(fields.trim());
    }

    public static SongCardResponse from(SongResponse song) {
        if (song == null) {
            return null;
        }
        return SongCardResponse.builder()
                .id(song.getId())
                .title(song.getTitle())
                .artistName(song.getArtistName())
                .coverUrl(song.getCoverUrl())
                .durationMs(song.getDurationMs())
                // No like_count column on songs: expose playCount as the card
                // popularity number (documented alias, not a new metric).
                .likeCount(song.getPlayCount())
                .build();
    }

    public static List<SongCardResponse> fromList(List<SongResponse> songs) {
        if (songs == null) {
            return List.of();
        }
        return songs.stream()
                .filter(Objects::nonNull)
                .map(SongCardResponse::from)
                .collect(Collectors.toList());
    }

    /** Rebuilds a song page with card content, preserving paging metadata. */
    public static PagedResponse<SongCardResponse> projectPage(PagedResponse<SongResponse> page) {
        if (page == null) {
            return null;
        }
        return PagedResponse.<SongCardResponse>builder()
                .content(fromList(page.getContent()))
                .page(page.getPage())
                .size(page.getSize())
                .totalElements(page.getTotalElements())
                .totalPages(page.getTotalPages())
                .first(page.isFirst())
                .last(page.isLast())
                .build();
    }

    /**
     * Projects the {@link SongResponse} elements of a heterogeneous home-section
     * item list to cards; album / artist / playlist / genre items pass through
     * untouched. {@code null} input yields {@code null} (section contract).
     */
    public static List<?> projectItems(List<?> items) {
        if (items == null) {
            return null;
        }
        return items.stream()
                .map(item -> item instanceof SongResponse song ? from(song) : item)
                .collect(Collectors.toList());
    }
}
