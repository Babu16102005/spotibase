package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "playlist_songs", indexes = {
        @Index(name = "idx_playlist_songs_playlist_id", columnList = "playlist_id"),
        @Index(name = "idx_playlist_songs_song_id", columnList = "song_id"),
        @Index(name = "idx_playlist_songs_position", columnList = "playlist_id, position")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class PlaylistSong {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "playlist_id", nullable = false, length = 36)
    private String playlistId;

    @Column(name = "song_id", nullable = false, length = 36)
    private String songId;

    @Column(nullable = false)
    @Builder.Default
    private int position = 0;

    @Column(name = "added_by", length = 36)
    private String addedBy;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime addedAt;
}
