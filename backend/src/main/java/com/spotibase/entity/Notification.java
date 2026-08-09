package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "notifications", indexes = {
        @Index(name = "idx_notifications_user_id", columnList = "user_id"),
        @Index(name = "idx_notifications_is_read", columnList = "user_id, is_read"),
        @Index(name = "idx_notifications_created_at", columnList = "user_id, created_at")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false, length = 50)
    private String type; // NEW_FOLLOWER, SHARED_PLAYLIST, NEW_RELEASE, RECOMMENDATION, WEEKLY_SUMMARY

    @Column(nullable = false, length = 300)
    private String title;

    @Column(length = 1000)
    private String body;

    @Column(columnDefinition = "jsonb")
    private String dataJson;

    @Column(length = 500)
    private String imageUrl;

    @Column(nullable = false)
    @Builder.Default
    private boolean isRead = false;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;
}
