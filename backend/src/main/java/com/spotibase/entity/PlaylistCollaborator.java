package com.spotibase.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "playlist_collaborators", indexes = {
        @Index(name = "idx_collab_playlist_id", columnList = "playlist_id"),
        @Index(name = "idx_collab_user_id", columnList = "user_id"),
        @Index(name = "idx_collab_unique", columnList = "playlist_id, user_id", unique = true)
})
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class PlaylistCollaborator {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "playlist_id", nullable = false, length = 36)
    private String playlistId;

    @Column(name = "user_id", nullable = false, length = 36)
    private String userId;

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    private LocalDateTime addedAt;
}
