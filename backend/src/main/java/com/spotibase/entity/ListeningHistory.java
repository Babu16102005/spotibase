package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "listening_history", indexes = {
        @Index(name = "idx_listening_history_user_id", columnList = "user_id"),
        @Index(name = "idx_listening_history_song_id", columnList = "song_id"),
        @Index(name = "idx_listening_history_played_at", columnList = "user_id, played_at")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ListeningHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "song_id", nullable = false, length = 36)
    private String songId;

    @Column(nullable = false)
    @Builder.Default
    private long durationPlayedMs = 0;

    @Column(length = 50)
    private String source; // SONG, ALBUM, PLAYLIST, SEARCH, RADIO, QUEUE, LOCAL

    @Column(nullable = false)
    @Builder.Default
    private boolean skipped = false;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime playedAt;
}
