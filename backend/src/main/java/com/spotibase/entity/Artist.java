package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;

@Entity
@Table(name = "artists", indexes = {
        @Index(name = "idx_artists_name", columnList = "name"),
        @Index(name = "idx_artists_user_id", columnList = "user_id")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Artist {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(length = 2000)
    private String bio;

    @Column(length = 500)
    private String imageUrl;

    @Column(length = 500)
    private String coverUrl;

    @Column(nullable = false)
    @Builder.Default
    private long monthlyListeners = 0;

    @Column(nullable = false)
    @Builder.Default
    private long followerCount = 0;

    @Column(name = "user_id")
    private String userId; // FK to users table (nullable for system-seeded artists)

    @Column(nullable = false)
    @Builder.Default
    private boolean verified = false;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private LocalDateTime updatedAt;

    // Relationships
    @OneToMany(mappedBy = "artist", cascade = CascadeType.ALL)
    @Builder.Default
    private Set<Album> albums = new HashSet<>();

    @OneToMany(mappedBy = "artist", cascade = CascadeType.ALL)
    @Builder.Default
    private Set<Song> songs = new HashSet<>();

    @ManyToMany
    @JoinTable(name = "liked_artists",
            joinColumns = @JoinColumn(name = "artist_id"),
            inverseJoinColumns = @JoinColumn(name = "user_id"))
    @Builder.Default
    private Set<User> likedBy = new HashSet<>();
}
