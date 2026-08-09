package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "song_contributing_artists", indexes = {
        @Index(name = "idx_song_contrib_artists_song", columnList = "song_id"),
        @Index(name = "idx_song_contrib_artists_artist", columnList = "artist_id"),
        @Index(name = "idx_song_contrib_artists_role", columnList = "role")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
@IdClass(SongContributingArtistId.class)
public class SongContributingArtist {

    @Id
    @Column(name = "song_id", length = 36)
    private String songId;

    @Id
    @Column(name = "artist_id", length = 36)
    private String artistId;

    @Id
    @Column(name = "role", length = 50)
    private String role; // PRIMARY, FEATURING, REMIXER, PRODUCER, WRITER, VOCALIST, COMPOSER

    @Column(nullable = false)
    @Builder.Default
    private int position = 0;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "song_id", insertable = false, updatable = false)
    private Song song;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "artist_id", insertable = false, updatable = false)
    private Artist artist;
}