package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "user_settings")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class UserSetting {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @OneToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;

    @Column(length = 20)
    @Builder.Default
    private String streamingQuality = "HIGH"; // LOW, MEDIUM, HIGH, LOSSLESS

    @Column(length = 20)
    @Builder.Default
    private String downloadQuality = "HIGH"; // LOW, MEDIUM, HIGH, LOSSLESS

    @Column(nullable = false)
    @Builder.Default
    private int crossfadeDuration = 0; // seconds

    @Column(nullable = false)
    @Builder.Default
    private boolean gaplessEnabled = true;

    @Column(nullable = false)
    @Builder.Default
    private boolean normalizeVolume = true;

    @Column(nullable = false)
    @Builder.Default
    private boolean explicitFilter = false;

    @Column(nullable = false)
    @Builder.Default
    private boolean monoAudio = false;

    @Column(nullable = false)
    @Builder.Default
    private int bassBoost = 0; // 0-100

    @Column(nullable = false)
    @Builder.Default
    private int treble = 0; // 0-100

    @Column(length = 20)
    @Builder.Default
    private String theme = "DARK"; // DARK, AMOLED, LIGHT

    @Column(length = 10)
    @Builder.Default
    private String language = "en";

    @Column(nullable = false)
    @Builder.Default
    private boolean wifiOnlyDownload = false;

    @Column(nullable = false)
    @Builder.Default
    private boolean smartDownloads = true;

    @Column(nullable = false)
    @Builder.Default
    private boolean autoPlay = true;

    @Column()
    @Builder.Default
    private int sleepTimerMinutes = 0; // 0 = disabled

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private LocalDateTime updatedAt;
}
