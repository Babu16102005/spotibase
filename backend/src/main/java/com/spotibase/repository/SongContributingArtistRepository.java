package com.spotibase.repository;

import com.spotibase.entity.SongContributingArtist;
import com.spotibase.entity.SongContributingArtistId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface SongContributingArtistRepository extends JpaRepository<SongContributingArtist, SongContributingArtistId> {

    List<SongContributingArtist> findBySongId(String songId);

    List<SongContributingArtist> findByArtistId(String artistId);

    @Query("SELECT ca FROM SongContributingArtist ca WHERE ca.songId = :songId AND ca.role = :role")
    List<SongContributingArtist> findBySongIdAndRole(@Param("songId") String songId, @Param("role") String role);

    void deleteBySongId(String songId);
}