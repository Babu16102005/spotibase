package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "downloads", indexes = {
        @Index(name = "idx_downloads_user_id", columnList = "user_id"),
        @Index(name = "idx_downloads_song_id", columnList = "song_id"),
        @Index(name = "idx_downloads_status", columnList = "user_id, status")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Download {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "song_id", nullable = false, length = 36)
    private String songId;

    @Column(length = 500)
    private String filePath;

    @Column(length = 50)
    @Builder.Default
    private String quality = "HIGH"; // LOW, MEDIUM, HIGH, LOSSLESS

    @Column(length = 50)
    @Builder.Default
    private String status = "DOWNLOADING"; // PENDING, DOWNLOADING, COMPLETED, FAILED, PAUSED

    @Column(nullable = false)
    @Builder.Default
    private long fileSize = 0;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime downloadedAt;

    @Column(nullable = false)
    private LocalDateTime lastPlayedAt;
}
