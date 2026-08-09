package com.spotibase.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotibase.dto.request.AddSongsToPlaylistRequest;
import com.spotibase.dto.request.CreatePlaylistRequest;
import com.spotibase.dto.request.UpdatePlaylistRequest;
import com.spotibase.dto.response.PlaylistResponse;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.service.LikeService;
import com.spotibase.service.PlaylistService;
import com.spotibase.support.BaseWebMvcTest;
import com.spotibase.support.TestSecurityConfig;
import com.spotibase.support.TestUsers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Web slice tests for {@link PlaylistController}.
 */
@WebMvcTest(PlaylistController.class)
@Import(TestSecurityConfig.class)
class PlaylistControllerTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private PlaylistService playlistService;

    @MockBean
    private LikeService likeService;

    private PlaylistResponse buildPlaylistResponse() {
        return PlaylistResponse.builder()
                .id("pl-1")
                .name("My Playlist")
                .userId("user-1")
                .username("alice")
                .isPublic(true)
                .isCollaborative(false)
                .build();
    }

    // ---------- reads ----------

    @Test
    void getUserPlaylists_authenticated_returns200() throws Exception {
        when(playlistService.getUserPlaylists("user-1")).thenReturn(List.of(buildPlaylistResponse()));

        mockMvc.perform(get("/api/v1/playlists")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("pl-1"))
                .andExpect(jsonPath("$[0].name").value("My Playlist"));
    }

    @Test
    void getUserPlaylists_unauthenticated_isRejected() throws Exception {
        mockMvc.perform(get("/api/v1/playlists"))
                .andExpect(status().isForbidden());
    }

    @Test
    void getPlaylistById_returns200() throws Exception {
        when(playlistService.getPlaylistById("pl-1", "user-1")).thenReturn(buildPlaylistResponse());

        mockMvc.perform(get("/api/v1/playlists/pl-1")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("pl-1"))
                .andExpect(jsonPath("$.username").value("alice"));
    }

    @Test
    void getPlaylistById_notFound_returns404() throws Exception {
        when(playlistService.getPlaylistById("missing", "user-1"))
                .thenThrow(new ResourceNotFoundException("Playlist", "missing"));

        mockMvc.perform(get("/api/v1/playlists/missing")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Playlist not found with id: missing"));
    }

    @Test
    void getFeaturedPlaylists_isPublic_returns200() throws Exception {
        when(playlistService.getFeaturedPlaylists(20)).thenReturn(List.of(buildPlaylistResponse()));

        mockMvc.perform(get("/api/v1/playlists/featured"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("pl-1"));

        verify(playlistService).getFeaturedPlaylists(20);
    }

    // ---------- mutations ----------

    @Test
    void createPlaylist_validBody_returns201() throws Exception {
        when(playlistService.createPlaylist(any(CreatePlaylistRequest.class), anyString()))
                .thenReturn(buildPlaylistResponse());

        mockMvc.perform(post("/api/v1/playlists")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(CreatePlaylistRequest.builder()
                                .name("My Playlist")
                                .description("desc")
                                .build())))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("pl-1"));
    }

    @Test
    void createPlaylist_blankName_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/playlists")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(CreatePlaylistRequest.builder()
                                .name("  ")
                                .build())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Invalid input parameters"))
                .andExpect(jsonPath("$.validationErrors.name").value("Playlist name is required"));
    }

    @Test
    void updatePlaylist_returns200() throws Exception {
        when(playlistService.updatePlaylist(anyString(), any(UpdatePlaylistRequest.class), anyString()))
                .thenReturn(buildPlaylistResponse());

        mockMvc.perform(put("/api/v1/playlists/pl-1")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(UpdatePlaylistRequest.builder()
                                .name("Renamed")
                                .description("new desc")
                                .build())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("My Playlist"));
    }

    @Test
    void deletePlaylist_returns204() throws Exception {
        mockMvc.perform(delete("/api/v1/playlists/pl-1")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isNoContent());

        verify(playlistService).deletePlaylist("pl-1", "user-1");
    }

    @Test
    void duplicatePlaylist_returns201() throws Exception {
        when(playlistService.duplicatePlaylist("pl-1", "user-1")).thenReturn(buildPlaylistResponse());

        mockMvc.perform(post("/api/v1/playlists/pl-1/duplicate")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("pl-1"));
    }

    @Test
    void mergePlaylists_returns200() throws Exception {
        when(playlistService.mergePlaylists("pl-1", "pl-2", "user-1")).thenReturn(buildPlaylistResponse());

        mockMvc.perform(post("/api/v1/playlists/pl-1/merge")
                        .param("sourcePlaylistId", "pl-2")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk());

        verify(playlistService).mergePlaylists("pl-1", "pl-2", "user-1");
    }

    @Test
    void addSongsToPlaylist_validBody_returns201() throws Exception {
        when(playlistService.addSongsToPlaylist(anyString(), any(AddSongsToPlaylistRequest.class), anyString()))
                .thenReturn(buildPlaylistResponse());

        mockMvc.perform(post("/api/v1/playlists/pl-1/songs")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(AddSongsToPlaylistRequest.builder()
                                .songIds(List.of("song-1", "song-2"))
                                .build())))
                .andExpect(status().isCreated());
    }

    @Test
    void addSongsToPlaylist_emptySongIds_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/playlists/pl-1/songs")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(AddSongsToPlaylistRequest.builder()
                                .songIds(List.of())
                                .build())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.validationErrors.songIds").value("Song IDs are required"));
    }

    @Test
    void removeSongFromPlaylist_returns200WithUpdatedPlaylist() throws Exception {
        when(playlistService.removeSongFromPlaylist("pl-1", "song-1", "user-1"))
                .thenReturn(buildPlaylistResponse());

        mockMvc.perform(delete("/api/v1/playlists/pl-1/songs/song-1")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("pl-1"));
    }

    @Test
    void reorderSongs_returns200() throws Exception {
        when(playlistService.reorderSongs(anyString(), any(), anyString()))
                .thenReturn(buildPlaylistResponse());

        String body = "[{\"songId\":\"song-1\",\"newPosition\":2},{\"songId\":\"song-2\",\"newPosition\":0}]";

        mockMvc.perform(put("/api/v1/playlists/pl-1/songs/reorder")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    @Test
    void togglePublic_returns200() throws Exception {
        when(playlistService.togglePublic("pl-1", "user-1")).thenReturn(buildPlaylistResponse());

        mockMvc.perform(put("/api/v1/playlists/pl-1/public")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk());
    }

    @Test
    void toggleCollaborative_returns200() throws Exception {
        when(playlistService.toggleCollaborative("pl-1", "user-1")).thenReturn(buildPlaylistResponse());

        mockMvc.perform(put("/api/v1/playlists/pl-1/collaborative")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk());
    }

    @Test
    void addCollaborator_returns201() throws Exception {
        mockMvc.perform(post("/api/v1/playlists/pl-1/collaborators")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("userId", "user-2"))))
                .andExpect(status().isCreated());

        verify(playlistService).addCollaborator("pl-1", "user-2", "user-1");
    }

    @Test
    void likePlaylist_returns201() throws Exception {
        mockMvc.perform(post("/api/v1/playlists/pl-1/like")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isCreated());

        verify(likeService).likePlaylist("user-1", "pl-1");
    }

    @Test
    void unlikePlaylist_returns204() throws Exception {
        mockMvc.perform(delete("/api/v1/playlists/pl-1/like")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isNoContent());

        verify(likeService).unlikePlaylist("user-1", "pl-1");
    }

    @Test
    void likePlaylist_unauthenticated_isRejected() throws Exception {
        mockMvc.perform(post("/api/v1/playlists/pl-1/like"))
                .andExpect(status().isForbidden());
    }
}
