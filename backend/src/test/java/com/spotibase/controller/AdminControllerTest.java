package com.spotibase.controller;

import com.spotibase.dto.response.AdminDashboardResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.UserResponse;
import com.spotibase.service.AdminService;
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

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Web slice tests for {@link AdminController}.
 *
 * <p>The controller is guarded by a class-level {@code @PreAuthorize("hasRole('ADMIN')")},
 * enforced through {@code @EnableMethodSecurity} in {@link TestSecurityConfig}.
 */
@WebMvcTest(AdminController.class)
@Import(TestSecurityConfig.class)
class AdminControllerTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private AdminService adminService;

    private AdminDashboardResponse buildDashboard() {
        return AdminDashboardResponse.builder()
                .totalUsers(10)
                .totalSongs(50)
                .totalListeningHours(120)
                .build();
    }

    // ---------- role enforcement ----------

    @Test
    void getDashboard_asAdmin_returns200() throws Exception {
        when(adminService.getDashboard()).thenReturn(buildDashboard());

        mockMvc.perform(get("/api/v1/admin/dashboard")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalUsers").value(10))
                .andExpect(jsonPath("$.totalSongs").value(50));
    }

    @Test
    void getDashboard_asRegularUser_isForbidden() throws Exception {
        mockMvc.perform(get("/api/v1/admin/dashboard")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void getDashboard_unauthenticated_isRejected() throws Exception {
        mockMvc.perform(get("/api/v1/admin/dashboard"))
                .andExpect(status().isForbidden());
    }

    // ---------- user management ----------

    @Test
    void getAllUsers_asAdmin_returns200() throws Exception {
        PagedResponse<UserResponse> paged = PagedResponse.<UserResponse>builder()
                .content(List.of(UserResponse.builder().id("user-1").username("alice").build()))
                .page(0)
                .size(20)
                .totalElements(1)
                .totalPages(1)
                .first(true)
                .last(true)
                .build();
        when(adminService.getAllUsers(0, 20)).thenReturn(paged);

        mockMvc.perform(get("/api/v1/admin/users")
                        .param("page", "0")
                        .param("size", "20")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].username").value("alice"))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void updateUserRole_asAdmin_returns200() throws Exception {
        when(adminService.updateUserRole("user-1", "ARTIST"))
                .thenReturn(UserResponse.builder().id("user-1").username("alice").build());

        mockMvc.perform(put("/api/v1/admin/users/user-1/role")
                        .with(user(TestUsers.admin("admin-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"ARTIST\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("user-1"));
    }

    @Test
    void updateUserRole_asRegularUser_isForbidden() throws Exception {
        mockMvc.perform(put("/api/v1/admin/users/user-1/role")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"ARTIST\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void forceDeleteSong_asAdmin_returns204() throws Exception {
        mockMvc.perform(delete("/api/v1/admin/songs/song-1")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isNoContent());

        verify(adminService).forceDeleteSong("song-1");
    }

    // ---------- features ----------

    @Test
    void featureSong_asAdmin_returns200() throws Exception {
        mockMvc.perform(post("/api/v1/admin/feature/song")
                        .with(user(TestUsers.admin("admin-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"songId\":\"song-1\"}"))
                .andExpect(status().isOk());

        verify(adminService).featureSong("song-1");
    }

    @Test
    void featurePlaylist_asAdmin_returns200() throws Exception {
        mockMvc.perform(post("/api/v1/admin/feature/playlist")
                        .with(user(TestUsers.admin("admin-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"playlistId\":\"pl-1\"}"))
                .andExpect(status().isOk());

        verify(adminService).featurePlaylist("pl-1");
    }

    // ---------- analytics ----------

    @Test
    void getAnalyticsOverview_returns200() throws Exception {
        when(adminService.getDashboard()).thenReturn(buildDashboard());

        mockMvc.perform(get("/api/v1/admin/analytics/overview")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalUsers").value(10));
    }

    @Test
    void getUserGrowth_returns200() throws Exception {
        when(adminService.getUserGrowth("weekly"))
                .thenReturn(List.of(Map.of("period", "2025-W01", "count", 3L)));

        mockMvc.perform(get("/api/v1/admin/analytics/user-growth")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].period").value("2025-W01"));

        verify(adminService).getUserGrowth("weekly");
    }

    @Test
    void getTopSongs_returns200() throws Exception {
        when(adminService.getTopSongs(20))
                .thenReturn(List.of(Map.of("id", "song-1", "name", "Hit Song", "playCount", 100L)));

        mockMvc.perform(get("/api/v1/admin/analytics/top-songs")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Hit Song"));

        verify(adminService).getTopSongs(20);
    }

    @Test
    void getTopGenres_returns200() throws Exception {
        when(adminService.getTopGenres(20)).thenReturn(List.of(Map.of("genre", "Rock")));

        mockMvc.perform(get("/api/v1/admin/analytics/top-genres")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].genre").value("Rock"));

        verify(adminService).getTopGenres(20);
    }
}
