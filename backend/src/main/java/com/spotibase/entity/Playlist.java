package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;

@Entity
@Table(name = "playlists", indexes = {
        @Index(name = "idx_playlists_user_id", columnList = "user_id"),
        @Index(name = "idx_playlists_name", columnList = "name")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Playlist {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false, length = 300)
    private String name;

    @Column(length = 2000)
    private String description;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(length = 500)
    private String coverUrl;

    @Column(nullable = false)
    @Builder.Default
    private boolean isPublic = true;

    @Column(nullable = false)
    @Builder.Default
    private boolean isCollaborative = false;

    @Column(nullable = false)
    @Builder.Default
    private int songCount = 0;

    @Column(nullable = false)
    @Builder.Default
    private long totalDurationMs = 0;

    @Column(length = 20)
    private String type; // USER, SYSTEM, SMART, AI_GENERATED

    @Column(nullable = false)
    @Builder.Default
    private boolean archived = false;

    @Column(nullable = false)
    @Builder.Default
    private boolean featured = false;

    @Column(nullable = false)
    @Builder.Default
    private long likeCount = 0;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private LocalDateTime updatedAt;

    // Relationships
    @ManyToMany
    @JoinTable(name = "playlist_songs",
            joinColumns = @JoinColumn(name = "playlist_id"),
            inverseJoinColumns = @JoinColumn(name = "song_id"))
    @OrderColumn(name = "position")
    @Builder.Default
    private Set<Song> songs = new HashSet<>();

    @ManyToMany
    @JoinTable(name = "liked_playlists",
            joinColumns = @JoinColumn(name = "playlist_id"),
            inverseJoinColumns = @JoinColumn(name = "user_id"))
    @Builder.Default
    private Set<User> likedBy = new HashSet<>();
}
