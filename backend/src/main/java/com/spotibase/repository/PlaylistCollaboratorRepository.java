package com.spotibase.repository;

import com.spotibase.entity.PlaylistCollaborator;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PlaylistCollaboratorRepository extends JpaRepository<PlaylistCollaborator, String> {

    List<PlaylistCollaborator> findByPlaylistId(String playlistId);

    boolean existsByPlaylistIdAndUserId(String playlistId, String userId);

    void deleteByPlaylistIdAndUserId(String playlistId, String userId);

    // Bulk cleanup for playlist delete: removes all collaborator links for a
    // playlist in one statement. No FK cascade exists for playlist_collaborators
    // (playlistId is a plain column, not a JPA relation), so callers must invoke
    // this explicitly before deleting the Playlist row.
    void deleteAllByPlaylistId(String playlistId);
}
