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
}
