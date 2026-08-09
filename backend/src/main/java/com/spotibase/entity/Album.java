package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;

@Entity
@Table(name = "albums", indexes = {
        @Index(name = "idx_albums_name", columnList = "name"),
        @Index(name = "idx_albums_artist_id", columnList = "artist_id"),
        @Index(name = "idx_albums_genre_id", columnList = "genre_id"),
        @Index(name = "idx_albums_release_date", columnList = "release_date")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Album {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false, length = 300)
    private String name;

    @Column(length = 2000)
    private String description;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "artist_id", nullable = false)
    private Artist artist;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "genre_id")
    private Genre genre;

    @Column(length = 500)
    private String coverUrl;

    @Column(nullable = false)
    private LocalDate releaseDate;

    @Column(nullable = false)
    @Builder.Default
    private int songCount = 0;

    @Column(nullable = false)
    @Builder.Default
    private long totalDurationMs = 0;

    @Column(length = 100)
    private String type; // ALBUM, SINGLE, EP, COMPILATION

    @Column(nullable = false)
    @Builder.Default
    private boolean archived = false;

    @Column(nullable = false)
    @Builder.Default
    private boolean featured = false;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private LocalDateTime updatedAt;

    // Relationships
    @OneToMany(mappedBy = "album", cascade = CascadeType.ALL)
    @OrderBy("trackNumber ASC")
    @Builder.Default
    private Set<Song> songs = new HashSet<>();

    @ManyToMany
    @JoinTable(name = "liked_albums",
            joinColumns = @JoinColumn(name = "album_id"),
            inverseJoinColumns = @JoinColumn(name = "user_id"))
    @Builder.Default
    private Set<User> likedBy = new HashSet<>();
}
