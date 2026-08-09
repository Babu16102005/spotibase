package com.spotibase.repository;

import com.spotibase.entity.PlaylistSong;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PlaylistSongRepository extends JpaRepository<PlaylistSong, String> {

    List<PlaylistSong> findByPlaylistIdOrderByPositionAsc(String playlistId);

    @Query("SELECT MAX(ps.position) FROM PlaylistSong ps WHERE ps.playlistId = :playlistId")
    Integer findMaxPosition(@Param("playlistId") String playlistId);

    boolean existsByPlaylistIdAndSongId(String playlistId, String songId);

    @Modifying
    @Query("DELETE FROM PlaylistSong ps WHERE ps.playlistId = :playlistId AND ps.songId = :songId")
    void deleteByPlaylistIdAndSongId(@Param("playlistId") String playlistId,
                                     @Param("songId") String songId);

    @Modifying
    @Query("DELETE FROM PlaylistSong ps WHERE ps.playlistId = :playlistId")
    void deleteAllByPlaylistId(@Param("playlistId") String playlistId);
}
