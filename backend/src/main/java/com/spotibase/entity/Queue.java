package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "queues", indexes = {
        @Index(name = "idx_queue_user_id", columnList = "user_id"),
        @Index(name = "idx_queue_position", columnList = "user_id, position")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Queue {

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
    private int position = 0;

    @Column(length = 50)
    private String source; // SONG, ALBUM, PLAYLIST, SEARCH, QUEUE, LOCAL

    @Column(nullable = false)
    @Builder.Default
    private boolean played = false;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime addedAt;
}
