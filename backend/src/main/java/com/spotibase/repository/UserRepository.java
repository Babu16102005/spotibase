package com.spotibase.repository;

import com.spotibase.entity.User;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, String> {

    Optional<User> findByEmail(String email);

    Optional<User> findByUsername(String username);

    @EntityGraph(attributePaths = {"favoriteGenres"})
    @Query("SELECT u FROM User u WHERE u.email = :email")
    Optional<User> findByEmailWithFavoriteGenres(@Param("email") String email);

    boolean existsByEmail(String email);

    boolean existsByUsername(String username);

    Optional<User> findBySupabaseUid(String supabaseUid);

    @Query("SELECT u FROM User u WHERE u.active = true ORDER BY u.createdAt DESC")
    List<User> findAllActiveUsers();

    @Query("SELECT COUNT(u) FROM User u WHERE u.active = true")
    long countActiveUsers();

    @Query("SELECT COUNT(u) FROM User u WHERE u.createdAt >= :since")
    long countUsersSince(@Param("since") java.time.LocalDateTime since);
}
