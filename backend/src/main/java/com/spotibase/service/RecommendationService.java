package com.spotibase.service;

import com.spotibase.dto.response.*;
import com.spotibase.entity.*;
import com.spotibase.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
@Slf4j
@RequiredArgsConstructor
public class RecommendationService {

    private final SongRepository songRepository;
    private final ListeningHistoryRepository listeningHistoryRepository;
    private final UserRepository userRepository;
    private final ArtistRepository artistRepository;
    private final GenreRepository genreRepository;
    private final RecentlyPlayedRepository recentlyPlayedRepository;
    private final LikeRepository likeRepository;
    private final EntityManager entityManager;

    private final SongService songService;
    private final AlbumService albumService;
    private final ArtistService artistService;
    private final PlaylistService playlistService;

    public Map<String, List<SongResponse>> getDailyMix(String userId) {
        if (userId == null) return Collections.emptyMap();

        String genreSql = """
            SELECT g.id, g.name FROM listening_history lh
            JOIN songs s ON lh.song_id = s.id
            JOIN genres g ON s.genre_id = g.id
            WHERE lh.user_id = :userId AND lh.skipped = false
            GROUP BY g.id, g.name
            ORDER BY COUNT(*) DESC
        """;

        Query genreQuery = entityManager.createNativeQuery(genreSql);
        genreQuery.setParameter("userId", userId);
        List<Object[]> genreRows = genreQuery.getResultList();

        Map<String, List<SongResponse>> dailyMix = new LinkedHashMap<>();

        for (Object[] row : genreRows) {
            String genreId = (String) row[0];
            String genreName = (String) row[1];

            String songSql = """
                SELECT s.id FROM songs s
                WHERE s.genre_id = :genreId
                AND s.archived = false
                AND s.id NOT IN (
                    SELECT lh.song_id FROM listening_history lh WHERE lh.user_id = :userId
                )
                ORDER BY s.play_count DESC
                LIMIT 30
            """;

            Query songQuery = entityManager.createNativeQuery(songSql);
            songQuery.setParameter("genreId", genreId);
            songQuery.setParameter("userId", userId);
            List<String> songIds = songQuery.getResultList();

            if (!songIds.isEmpty()) {
                List<SongResponse> songs = songService.getSongsByIds(songIds, userId);
                dailyMix.put(genreName, songs);
            }
        }

        return dailyMix;
    }

    public List<SongResponse> getWeeklyMix(String userId) {
        if (userId == null) return Collections.emptyList();

        String sql = """
            SELECT DISTINCT lh.song_id FROM listening_history lh
            WHERE lh.user_id IN (
                SELECT lh2.user_id FROM listening_history lh2
                WHERE lh2.song_id IN (
                    SELECT song_id FROM listening_history WHERE user_id = :userId
                ) AND lh2.user_id != :userId
                GROUP BY lh2.user_id
                ORDER BY COUNT(*) DESC LIMIT 10
            ) AND lh.song_id NOT IN (
                SELECT song_id FROM listening_history WHERE user_id = :userId
            )
            ORDER BY RANDOM() LIMIT 30
        """;

        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("userId", userId);
        List<String> songIds = q.getResultList();

        return songService.getSongsByIds(songIds, userId);
    }

    public List<SongResponse> getDiscoverWeekly(String userId) {
        if (userId == null) return Collections.emptyList();

        Optional<User> userOpt = userRepository.findById(userId);
        if (userOpt.isEmpty()) return Collections.emptyList();

        User user = userOpt.get();
        Set<String> favoriteGenres = user.getFavoriteGenres();
        String language = user.getCountry() != null ? getLanguageFromCountry(user.getCountry()) : null;

        StringBuilder sql = new StringBuilder("""
            SELECT s.id FROM songs s
            WHERE s.archived = false
            AND s.id NOT IN (
                SELECT lh.song_id FROM listening_history lh WHERE lh.user_id = :userId
            )
        """);

        if (!favoriteGenres.isEmpty()) {
            List<String> genreIds = findGenreIdsByNames(favoriteGenres);
            if (!genreIds.isEmpty()) {
                String ids = genreIds.stream()
                        .map(id -> "'" + id.replace("'", "''") + "'")
                        .collect(Collectors.joining(","));
                sql.append(" AND s.genre_id IN (").append(ids).append(")");
            }
        }

        if (language != null) {
            sql.append(" AND s.language = :language");
        }

        sql.append(" ORDER BY s.play_count DESC LIMIT 30");

        Query q = entityManager.createNativeQuery(sql.toString());
        q.setParameter("userId", userId);
        if (language != null) {
            q.setParameter("language", language);
        }

        List<String> songIds = q.getResultList();
        return songService.getSongsByIds(songIds, userId);
    }

    public List<SongResponse> getReleaseRadar(String userId) {
        if (userId == null) return Collections.emptyList();

        String sql = """
            SELECT s.id FROM songs s
            JOIN artists a ON s.artist_id = a.id
            JOIN liked_artists la ON la.artist_id = a.id
            WHERE la.user_id = :userId
            AND s.archived = false
            AND s.release_date >= :since
            ORDER BY s.release_date DESC
            LIMIT 30
        """;

        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("userId", userId);
        q.setParameter("since", LocalDate.now().minusWeeks(2));
        List<String> songIds = q.getResultList();

        return songService.getSongsByIds(songIds, userId);
    }

    public List<SongResponse> getMadeForYou(String userId) {
        if (userId == null) return Collections.emptyList();

        String recentGenresSql = """
            SELECT DISTINCT ON (s.genre_id) s.genre_id, lh.played_at FROM listening_history lh
            JOIN songs s ON lh.song_id = s.id
            WHERE lh.user_id = :userId AND s.genre_id IS NOT NULL
            ORDER BY s.genre_id, lh.played_at DESC
            LIMIT 5
        """;

        Query genreQuery = entityManager.createNativeQuery(recentGenresSql);
        genreQuery.setParameter("userId", userId);
        List<String> recentGenreIds = genreQuery.getResultList();

        if (recentGenreIds.isEmpty()) return Collections.emptyList();

        String ids = recentGenreIds.stream()
                .map(id -> "'" + id.replace("'", "''") + "'")
                .collect(Collectors.joining(","));

        String songSql = """
            SELECT s.id FROM songs s
            WHERE s.genre_id IN (""" + ids + """
            ) AND s.archived = false
            AND s.id NOT IN (
                SELECT lh.song_id FROM listening_history lh WHERE lh.user_id = :userId
            )
            ORDER BY s.play_count DESC
            LIMIT 30
        """;

        Query q = entityManager.createNativeQuery(songSql);
        q.setParameter("userId", userId);
        List<String> songIds = q.getResultList();

        return songService.getSongsByIds(songIds, userId);
    }

    public List<SongResponse> getSimilarSongs(String songId, int limit) {
        Optional<Song> songOpt = songRepository.findById(songId);
        if (songOpt.isEmpty()) return Collections.emptyList();

        Song song = songOpt.get();
        String genreId = song.getGenre() != null ? song.getGenre().getId() : null;

        StringBuilder sql = new StringBuilder("""
            SELECT s.id FROM songs s
            WHERE s.archived = false
            AND s.id != :songId
        """);

        if (genreId != null) {
            sql.append(" AND s.genre_id = :genreId");
        }

        sql.append(" ORDER BY ABS(s.play_count - :playCount) ASC, s.play_count DESC LIMIT :limit");

        Query q = entityManager.createNativeQuery(sql.toString());
        q.setParameter("songId", songId);
        q.setParameter("playCount", song.getPlayCount());
        q.setParameter("limit", limit);
        if (genreId != null) {
            q.setParameter("genreId", genreId);
        }

        List<String> songIds = q.getResultList();
        return songService.getSongsByIds(songIds, null);
    }

    public List<SongResponse> getRecommendedSongs(String userId, int limit) {
        if (userId == null) {
            PageRequest pageable = PageRequest.of(0, limit);
            return songRepository.findTopSongs(pageable).stream()
                    .map(song -> songService.toSongResponse(song, null))
                    .collect(Collectors.toList());
        }

        String sql = """
            SELECT s.id FROM songs s
            WHERE s.archived = false
            AND s.id NOT IN (
                SELECT lh.song_id FROM listening_history lh WHERE lh.user_id = :userId
            )
            AND (
                s.genre_id IN (
                    SELECT DISTINCT s2.genre_id FROM listening_history lh2
                    JOIN songs s2 ON lh2.song_id = s2.id
                    WHERE lh2.user_id = :userId AND s2.genre_id IS NOT NULL
                )
                OR s.language IN (
                    SELECT DISTINCT s3.language FROM listening_history lh3
                    JOIN songs s3 ON lh3.song_id = s3.id
                    WHERE lh3.user_id = :userId AND s3.language IS NOT NULL
                )
            )
            ORDER BY s.play_count DESC
            LIMIT :limit
        """;

        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("userId", userId);
        q.setParameter("limit", limit);
        List<String> songIds = q.getResultList();

        return songService.getSongsByIds(songIds, userId);
    }

    public List<SongResponse> getBasedOnListening(String userId) {
        if (userId == null) return Collections.emptyList();

        String recentSongsSql = """
            SELECT lh.song_id FROM listening_history lh
            WHERE lh.user_id = :userId AND lh.skipped = false
            ORDER BY lh.played_at DESC
            LIMIT 10
        """;

        Query recentQuery = entityManager.createNativeQuery(recentSongsSql);
        recentQuery.setParameter("userId", userId);
        List<String> recentSongIds = recentQuery.getResultList();

        if (recentSongIds.isEmpty()) return Collections.emptyList();

        String ids = recentSongIds.stream()
                .map(id -> "'" + id.replace("'", "''") + "'")
                .collect(Collectors.joining(","));

        String sql = """
            SELECT DISTINCT s.id FROM songs s
            WHERE s.archived = false
            AND s.genre_id IN (
                SELECT DISTINCT s2.genre_id FROM songs s2
                WHERE s2.id IN (""" + ids + """
                ) AND s2.genre_id IS NOT NULL
            )
            AND s.id NOT IN (
                SELECT lh.song_id FROM listening_history lh WHERE lh.user_id = :userId
            )
            ORDER BY s.play_count DESC
            LIMIT 30
        """;

        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("userId", userId);
        List<String> songIds = q.getResultList();

        return songService.getSongsByIds(songIds, userId);
    }

    public HomeResponse getHomeSections(String userId) {
        List<HomeResponse.Section> sections = new ArrayList<>();

        if (userId != null) {
            sections.add(buildContinueListeningSection(userId));
            sections.add(buildRecentlyPlayedSection(userId));
        }

        sections.add(buildTrendingSection());
        sections.add(buildNewReleasesSection(userId));
        sections.add(buildFeaturedAlbumsSection(userId));
        sections.add(buildFeaturedArtistsSection());
        sections.add(buildFeaturedPlaylistsSection());

        if (userId != null) {
            sections.add(buildMadeForYouSection(userId));
            sections.add(buildDailyMixesSection(userId));
        }

        sections.add(buildPopularGenresSection());

        return HomeResponse.builder()
                .greeting(getGreeting())
                .sections(sections)
                .build();
    }

    private String getGreeting() {
        int hour = LocalTime.now().getHour();
        if (hour < 12) return "Good Morning";
        if (hour < 17) return "Good Afternoon";
        return "Good Evening";
    }

    private HomeResponse.Section buildContinueListeningSection(String userId) {
        List<RecentlyPlayed> recentItems = recentlyPlayedRepository
                .findByUserIdOrderByPlayedAtDesc(userId);

        List<SongResponse> songs = recentItems.stream()
                .filter(rp -> "SONG".equals(rp.getItemType()))
                .limit(10)
                .map(rp -> {
                    try {
                        return songService.getSongById(rp.getItemId(), userId);
                    } catch (Exception e) {
                        return null;
                    }
                })
                .filter(Objects::nonNull)
                .collect(Collectors.toList());

        return HomeResponse.Section.builder()
                .id("continue-listening")
                .title("Continue Listening")
                .type("SONG")
                .subtitle("Pick up where you left off")
                .items(songs)
                .build();
    }

    private HomeResponse.Section buildRecentlyPlayedSection(String userId) {
        List<RecentlyPlayed> recentItems = recentlyPlayedRepository
                .findByUserIdOrderByPlayedAtDesc(userId);

        List<Object> items = recentItems.stream()
                .limit(10)
                .map(rp -> {
                    try {
                        return switch (rp.getItemType()) {
                            case "SONG" -> songService.getSongById(rp.getItemId(), userId);
                            case "ALBUM" -> albumService.getAlbumById(rp.getItemId(), userId);
                            case "ARTIST" -> artistService.getArtistById(rp.getItemId(), userId);
                            case "PLAYLIST" -> playlistService.getPlaylistById(rp.getItemId(), userId);
                            default -> null;
                        };
                    } catch (Exception e) {
                        return null;
                    }
                })
                .filter(Objects::nonNull)
                .collect(Collectors.toList());

        return HomeResponse.Section.builder()
                .id("recently-played")
                .title("Recently Played")
                .type("SONG")
                .subtitle("Your listening history")
                .items(items)
                .build();
    }

    private HomeResponse.Section buildTrendingSection() {
        List<Song> topSongs = songRepository.findTopSongs(PageRequest.of(0, 10));
        List<SongResponse> songs = topSongs.stream()
                .map(song -> songService.toSongResponse(song, null))
                .collect(Collectors.toList());

        return HomeResponse.Section.builder()
                .id("trending")
                .title("Trending Now")
                .type("SONG")
                .subtitle("Most played songs")
                .items(songs)
                .build();
    }

    private HomeResponse.Section buildNewReleasesSection(String userId) {
        List<SongResponse> songs = songService.getNewReleases(userId, 10);

        return HomeResponse.Section.builder()
                .id("new-releases")
                .title("New Releases")
                .type("SONG")
                .subtitle("Fresh music just for you")
                .items(songs)
                .build();
    }

    private HomeResponse.Section buildFeaturedAlbumsSection(String userId) {
        List<AlbumResponse> albums = albumService.getFeaturedAlbums(userId, 10);

        return HomeResponse.Section.builder()
                .id("featured-albums")
                .title("Featured Albums")
                .type("ALBUM")
                .subtitle("Editor's picks")
                .items(albums)
                .build();
    }

    private HomeResponse.Section buildFeaturedArtistsSection() {
        List<ArtistResponse> artists = artistService.getFeaturedArtists(10);

        return HomeResponse.Section.builder()
                .id("featured-artists")
                .title("Featured Artists")
                .type("ARTIST")
                .subtitle("Top verified artists")
                .items(artists)
                .build();
    }

    private HomeResponse.Section buildFeaturedPlaylistsSection() {
        List<PlaylistResponse> playlists = playlistService.getFeaturedPlaylists(10);

        return HomeResponse.Section.builder()
                .id("featured-playlists")
                .title("Featured Playlists")
                .type("PLAYLIST")
                .subtitle("Handpicked collections")
                .items(playlists)
                .build();
    }

    private HomeResponse.Section buildMadeForYouSection(String userId) {
        List<SongResponse> songs = getMadeForYou(userId);
        if (songs.size() > 10) songs = songs.subList(0, 10);

        return HomeResponse.Section.builder()
                .id("made-for-you")
                .title("Made For You")
                .type("SONG")
                .subtitle("Based on your taste")
                .items(songs)
                .build();
    }

    private HomeResponse.Section buildDailyMixesSection(String userId) {
        Map<String, List<SongResponse>> dailyMix = getDailyMix(userId);

        List<Map<String, Object>> mixItems = dailyMix.entrySet().stream()
                .limit(6)
                .map(entry -> {
                    Map<String, Object> mix = new LinkedHashMap<>();
                    mix.put("genre", entry.getKey());
                    mix.put("songs", entry.getValue().stream().limit(5).collect(Collectors.toList()));
                    return mix;
                })
                .collect(Collectors.toList());

        return HomeResponse.Section.builder()
                .id("daily-mixes")
                .title("Daily Mixes")
                .type("SONG")
                .subtitle("Your genre mixes")
                .items(mixItems)
                .build();
    }

    private HomeResponse.Section buildPopularGenresSection() {
        List<Genre> genres = genreRepository.findPopularGenres();

        return HomeResponse.Section.builder()
                .id("popular-genres")
                .title("Popular Genres")
                .type("GENRE")
                .subtitle("Browse by genre")
                .items(genres)
                .build();
    }

    private List<String> findGenreIdsByNames(Set<String> names) {
        return names.stream()
                .map(name -> {
                    try {
                        return genreRepository.findByName(name).map(Genre::getId).orElse(null);
                    } catch (Exception e) {
                        return null;
                    }
                })
                .filter(Objects::nonNull)
                .collect(Collectors.toList());
    }

    private String getLanguageFromCountry(String country) {
        Map<String, String> countryLanguage = Map.ofEntries(
                Map.entry("US", "English"), Map.entry("GB", "English"), Map.entry("AU", "English"),
                Map.entry("IN", "Hindi"), Map.entry("ES", "Spanish"), Map.entry("MX", "Spanish"),
                Map.entry("FR", "French"), Map.entry("DE", "German"), Map.entry("JP", "Japanese"),
                Map.entry("KR", "Korean"), Map.entry("CN", "Chinese"), Map.entry("BR", "Portuguese"),
                Map.entry("IT", "Italian"), Map.entry("RU", "Russian"), Map.entry("NL", "Dutch"),
                Map.entry("SE", "Swedish"), Map.entry("NO", "Norwegian"), Map.entry("DK", "Danish"),
                Map.entry("FI", "Finnish"), Map.entry("PL", "Polish"), Map.entry("TR", "Turkish"),
                Map.entry("AR", "Spanish"), Map.entry("PT", "Portuguese"), Map.entry("ZA", "English"),
                Map.entry("NG", "English"), Map.entry("EG", "Arabic"), Map.entry("SA", "Arabic"),
                Map.entry("IL", "Hebrew"), Map.entry("TH", "Thai"), Map.entry("VN", "Vietnamese")
        );
        return countryLanguage.getOrDefault(country, null);
    }
}