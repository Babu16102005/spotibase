package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "recently_played", indexes = {
        @Index(name = "idx_recently_played_user_id", columnList = "user_id"),
        @Index(name = "idx_recently_played_played_at", columnList = "user_id, played_at")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class RecentlyPlayed {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "item_type", nullable = false, length = 20)
    private String itemType; // SONG, ALBUM, ARTIST, PLAYLIST

    @Column(name = "item_id", nullable = false, length = 36)
    private String itemId;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime playedAt;
}
