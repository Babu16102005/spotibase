package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Entity
@Table(name = "songs", indexes = {
        @Index(name = "idx_songs_name", columnList = "name"),
        @Index(name = "idx_songs_artist_id", columnList = "artist_id"),
        @Index(name = "idx_songs_album_id", columnList = "album_id"),
        @Index(name = "idx_songs_genre_id", columnList = "genre_id"),
        @Index(name = "idx_songs_language", columnList = "language"),
        @Index(name = "idx_songs_release_date", columnList = "release_date"),
        @Index(name = "idx_songs_play_count", columnList = "play_count"),
        @Index(name = "idx_songs_fts", columnList = "fts_vector", unique = false),
        // New composite indexes for fast listing
        @Index(name = "idx_songs_home_feed", columnList = "archived,featured,releaseDate"),
        @Index(name = "idx_songs_artist_page", columnList = "artistId,archived,releaseDate"),
        @Index(name = "idx_songs_album_page", columnList = "albumId,discNumber,trackNumber"),
        @Index(name = "idx_songs_album_artist_page", columnList = "albumArtistId,archived,releaseDate"),
        @Index(name = "idx_songs_genre_listing", columnList = "genreId,archived,releaseDate")
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Song {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false, length = 300)
    private String name;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "artist_id", nullable = false)
    private Artist artist;

    // NEW: Album artist (distinct from track artist for compilations)
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "album_artist_id")
    private Artist albumArtist;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "album_id")
    private Album album;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "genre_id")
    private Genre genre;

    @Column(length = 100)
    private String language;

    @Column(length = 300)
    private String composer;

    @Column(columnDefinition = "TEXT")
    private String lyrics;

    @Column(length = 10)
    private String duration; // "MM:SS" format

    @Column(nullable = false)
    @Builder.Default
    private long durationMs = 0;

    @Column(nullable = false)
    private LocalDate releaseDate;

    @Column(nullable = false)
    @Builder.Default
    private int trackNumber = 1;

    @Column(nullable = false)
    @Builder.Default
    private int discNumber = 1;

    @Column(length = 500)
    private String fileUrl;

    @Column(length = 500)
    private String coverUrl;

    @Column(length = 50)
    private String fileFormat; // MP3, FLAC, WAV, AAC

    @Column(nullable = false)
    @Builder.Default
    private long fileSize = 0;

    @Column(nullable = false)
    @Builder.Default
    private int bitrate = 320;

    @Column(nullable = false)
    @Builder.Default
    private int sampleRate = 44100;

    @Column(nullable = false)
    @Builder.Default
    private boolean explicit = false;

    @Column(nullable = false)
    @Builder.Default
    private boolean archived = false;

    @Column(nullable = false)
    @Builder.Default
    private boolean featured = false;

    @Column(name = "play_count", nullable = false)
    @Builder.Default
    private long playCount = 0;

    // Full-text search vector maintained by a database trigger - read-only
    @Column(name = "fts_vector", columnDefinition = "tsvector", insertable = false, updatable = false)
    private String ftsVector;

    // NEW: Denormalized fields for fast listing without joins
    @Column(name = "primary_artist_name", length = 200)
    private String primaryArtistName;

    @Column(name = "album_name", length = 300)
    private String albumName;

    @Column(name = "cover_url_cached", length = 500)
    private String coverUrlCached;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private LocalDateTime updatedAt;

    // Relationships
    @ManyToMany(mappedBy = "songs")
    @Builder.Default
    private Set<Playlist> playlists = new HashSet<>();

    @ManyToMany
    @JoinTable(name = "liked_songs",
            joinColumns = @JoinColumn(name = "song_id"),
            inverseJoinColumns = @JoinColumn(name = "user_id"))
    @Builder.Default
    private Set<User> likedBy = new HashSet<>();

    // NEW: Contributing artists (featuring, remixers, producers, etc.)
    @OneToMany(mappedBy = "song", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private List<SongContributingArtist> contributingArtists = new ArrayList<>();

    // Helper methods
    public String getEffectiveCoverUrl() {
        return coverUrl != null ? coverUrl : 
               coverUrlCached != null ? coverUrlCached : 
               (album != null ? album.getCoverUrl() : null);
    }

    public String getEffectivePrimaryArtistName() {
        return primaryArtistName != null ? primaryArtistName : 
               (artist != null ? artist.getName() : null);
    }

    public String getEffectiveAlbumName() {
        return albumName != null ? albumName : 
               (album != null ? album.getName() : null);
    }

    public List<SongContributingArtist> getContributingArtistsByRole(String role) {
        return contributingArtists.stream()
                .filter(ca -> role.equalsIgnoreCase(ca.getRole()))
                .toList();
    }

    public List<SongContributingArtist> getFeaturingArtists() {
        return getContributingArtistsByRole("FEATURING");
    }

    public List<SongContributingArtist> getRemixers() {
        return getContributingArtistsByRole("REMIXER");
    }
}