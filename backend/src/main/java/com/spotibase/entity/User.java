package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.Set;

@Entity
@Table(name = "users", indexes = {
        @Index(name = "idx_users_email", columnList = "email", unique = true),
        @Index(name = "idx_users_username", columnList = "username", unique = true)
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false, unique = true, length = 100)
    private String email;

    @Column(nullable = false, unique = true, length = 50)
    private String username;

    @Column(length = 500)
    private String passwordHash;

    @Column(length = 500)
    private String avatarUrl;

    @Column(length = 500)
    private String coverUrl;

    @Column(length = 500)
    private String bio;

    @Column(length = 100)
    private String country;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "user_favorite_genres", joinColumns = @JoinColumn(name = "user_id"))
    @Column(name = "genre")
    @Builder.Default
    private Set<String> favoriteGenres = new HashSet<>();

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private Role role = Role.USER;

    @Column(nullable = false)
    @Builder.Default
    private boolean emailVerified = false;

    @Column(length = 500)
    private String supabaseUid;

    @Column(length = 100)
    private String authProvider; // EMAIL, GOOGLE, APPLE

    @Column(nullable = false)
    @Builder.Default
    private boolean active = true;

    @Column(nullable = false)
    @Builder.Default
    private long totalListeningTimeMs = 0;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    @Column(nullable = false)
    private LocalDateTime updatedAt;

    // Relationships
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private Set<Playlist> playlists = new HashSet<>();

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private Set<Queue> queues = new HashSet<>();

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private Set<UserSetting> settings = new HashSet<>();

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private Set<Notification> notifications = new HashSet<>();

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    @Builder.Default
    private Set<Download> downloads = new HashSet<>();

    @ManyToMany
    @JoinTable(name = "followers",
            joinColumns = @JoinColumn(name = "follower_id"),
            inverseJoinColumns = @JoinColumn(name = "following_id"))
    @Builder.Default
    private Set<User> following = new HashSet<>();

    @ManyToMany(mappedBy = "following")
    @Builder.Default
    private Set<User> followers = new HashSet<>();
}
