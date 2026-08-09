package com.spotibase.repository;

import com.spotibase.entity.Genre;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface GenreRepository extends JpaRepository<Genre, String> {

    Optional<Genre> findByName(String name);

    List<Genre> findAllByOrderBySortOrderAsc();

    @Query("SELECT g FROM Genre g WHERE SIZE(g.songs) > 0 ORDER BY SIZE(g.songs) DESC")
    List<Genre> findPopularGenres();
}
