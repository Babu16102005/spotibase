package com.spotibase.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotibase.dto.request.CreateSongRequest;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.Role;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.service.LikeService;
import com.spotibase.service.SongService;
import com.spotibase.support.BaseWebMvcTest;
import com.spotibase.support.TestSecurityConfig;
import com.spotibase.support.TestUsers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Web slice tests for {@link SongController}.
 */
@WebMvcTest(SongController.class)
@Import(TestSecurityConfig.class)
class SongControllerTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private SongService songService;

    @MockBean
    private LikeService likeService;

    @MockBean
    private com.spotibase.service.StorageService storageService;

    private SongResponse buildSongResponse() {
        return SongResponse.builder()
                .id("song-1")
                .title("Hit Song")
                .artistId("artist-1")
                .artistName("The Band")
                .durationMs(180000)
                .build();
    }

    // ---------- reads ----------

    @Test
    void getSongById_authenticated_returns200() throws Exception {
        when(songService.getSongById("song-1", "user-1")).thenReturn(buildSongResponse());

        mockMvc.perform(get("/api/v1/songs/song-1")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("song-1"))
                .andExpect(jsonPath("$.title").value("Hit Song"))
                .andExpect(jsonPath("$.artistName").value("The Band"));
    }

    @Test
    void getSongById_notFound_returns404WithErrorBody() throws Exception {
        when(songService.getSongById("missing", "user-1"))
                .thenThrow(new ResourceNotFoundException("Song", "missing"));

        mockMvc.perform(get("/api/v1/songs/missing")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.message").value("Song not found with id: missing"));
    }

    @Test
    void getSongById_unauthenticated_isRejected() throws Exception {
        // Production returns 403: no AuthenticationEntryPoint is configured, so Spring Security
        // uses the default Http403ForbiddenEntryPoint.
        mockMvc.perform(get("/api/v1/songs/song-1"))
                .andExpect(status().isForbidden());
    }

    @Test
    void getAllSongs_authenticated_returnsPagedResponse() throws Exception {
        PagedResponse<SongResponse> paged = PagedResponse.<SongResponse>builder()
                .content(List.of(buildSongResponse()))
                .page(0)
                .size(20)
                .totalElements(1)
                .totalPages(1)
                .first(true)
                .last(true)
                .build();
        when(songService.getAllSongs(0, 20, "user-1")).thenReturn(paged);

        mockMvc.perform(get("/api/v1/songs")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value("song-1"))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void getTrendingSongs_returns200() throws Exception {
        when(songService.getTrendingSongs("user-1", 20)).thenReturn(List.of(buildSongResponse()));

        mockMvc.perform(get("/api/v1/songs/trending")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("song-1"));
    }

    @Test
    void getNewReleases_returns200() throws Exception {
        when(songService.getNewReleases("user-1", 20)).thenReturn(List.of(buildSongResponse()));

        mockMvc.perform(get("/api/v1/songs/new-releases")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].title").value("Hit Song"));
    }

    @Test
    void getFeaturedSongs_returns200() throws Exception {
        when(songService.getFeaturedSongs("user-1", 20)).thenReturn(List.of(buildSongResponse()));

        mockMvc.perform(get("/api/v1/songs/featured")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].title").value("Hit Song"));
    }

    // ---------- likes ----------

    @Test
    void likeSong_authenticated_returns201() throws Exception {
        mockMvc.perform(post("/api/v1/songs/song-1/like")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isCreated());

        verify(likeService).likeSong("user-1", "song-1");
    }

    @Test
    void likeSong_unauthenticated_isRejected() throws Exception {
        mockMvc.perform(post("/api/v1/songs/song-1/like"))
                .andExpect(status().isForbidden());

        verify(likeService, org.mockito.Mockito.never()).likeSong(anyString(), anyString());
    }

    @Test
    void unlikeSong_authenticated_returns204() throws Exception {
        mockMvc.perform(delete("/api/v1/songs/song-1/like")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isNoContent());

        verify(likeService).unlikeSong("user-1", "song-1");
    }

    // ---------- stream ----------

    @Test
    void streamSong_isPermitAll_redirectsToR2File() throws Exception {
        com.spotibase.entity.Song song = com.spotibase.entity.Song.builder()
                .id("song-1")
                .name("Hit Song")
                .fileUrl("https://pub-example.r2.dev/songs/artist-1/song-1.mp3")
                .durationMs(180000)
                .fileFormat("audio/mpeg")
                .build();
        when(songService.getSongEntityById("song-1")).thenReturn(song);

        mockMvc.perform(get("/api/v1/songs/song-1/stream"))
                .andExpect(status().isFound())
                .andExpect(header().string("Location", "https://pub-example.r2.dev/songs/artist-1/song-1.mp3"))
                .andExpect(header().string("Accept-Ranges", "bytes"));

        verify(songService).incrementPlayCount("song-1");
    }

    @Test
    void streamSong_withRange_redirectsAndPassesRange() throws Exception {
        com.spotibase.entity.Song song = com.spotibase.entity.Song.builder()
                .id("song-1")
                .name("Hit Song")
                .fileUrl("https://pub-example.r2.dev/songs/artist-1/song-1.mp3")
                .fileFormat("audio/mpeg")
                .build();
        when(songService.getSongEntityById("song-1")).thenReturn(song);

        mockMvc.perform(get("/api/v1/songs/song-1/stream").header("Range", "bytes=0-1023"))
                .andExpect(status().isFound())
                .andExpect(header().string("Accept-Ranges", "bytes"));
    }

    @Test
    void streamSong_missingFileUrl_returns404() throws Exception {
        com.spotibase.entity.Song song = com.spotibase.entity.Song.builder()
                .id("song-1")
                .fileUrl(null)
                .build();
        when(songService.getSongEntityById("song-1")).thenReturn(song);

        mockMvc.perform(get("/api/v1/songs/song-1/stream"))
                .andExpect(status().isNotFound());
    }

    // ---------- create / update / delete (role restricted) ----------

    @Test
    void createSong_asArtist_returns201() throws Exception {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("New Song")
                .artistId("artist-1")
                .releaseDate(LocalDate.of(2025, 1, 1))
                .build();
        when(songService.createSong(any(CreateSongRequest.class), any(), any()))
                .thenReturn(buildSongResponse());

        mockMvc.perform(multipart("/api/v1/songs")
                        .file(new MockMultipartFile("request", "", "application/json",
                                objectMapper.writeValueAsBytes(request)))
                        .with(user(TestUsers.artist("artist-1"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("song-1"));
    }

    @Test
    void createSong_asRegularUser_isForbidden() throws Exception {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("New Song")
                .artistId("artist-1")
                .releaseDate(LocalDate.of(2025, 1, 1))
                .build();

        mockMvc.perform(multipart("/api/v1/songs")
                        .file(new MockMultipartFile("request", "", "application/json",
                                objectMapper.writeValueAsBytes(request)))
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void createSong_invalidRequestPart_returns400() throws Exception {
        String invalidJson = objectMapper.writeValueAsString(CreateSongRequest.builder()
                .title("")
                .artistId("artist-1")
                .build());

        mockMvc.perform(multipart("/api/v1/songs")
                        .file(new MockMultipartFile("request", "", "application/json", invalidJson.getBytes()))
                        .with(user(TestUsers.artist("artist-1"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.validationErrors.title").value("Song title is required"));
    }

    @Test
    void deleteSong_asAdmin_returns204() throws Exception {
        mockMvc.perform(delete("/api/v1/songs/song-1")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isNoContent());

        verify(songService).deleteSong("song-1");
    }

    @Test
    void restoreSong_asAdmin_returns200() throws Exception {
        mockMvc.perform(post("/api/v1/songs/song-1/restore")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isOk());

        verify(songService).restoreSong("song-1");
    }

    @Test
    void restoreSong_asRegularUser_isForbidden() throws Exception {
        mockMvc.perform(post("/api/v1/songs/song-1/restore")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isForbidden());
    }
}
