package com.spotibase.controller;

import com.spotibase.dto.response.AdminDashboardResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.UserResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.AdminService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
@Slf4j
@PreAuthorize("hasRole('ADMIN')")
public class AdminController {

    private final AdminService adminService;

    @GetMapping("/dashboard")
    public ResponseEntity<AdminDashboardResponse> getDashboard(@CurrentUser CustomUserDetails user) {
        log.info("Admin {} requested dashboard", user.getId());
        return ResponseEntity.ok(adminService.getDashboard());
    }

    @GetMapping("/users")
    public ResponseEntity<PagedResponse<UserResponse>> getAllUsers(
            @PageableDefault(sort = "createdAt", direction = Sort.Direction.DESC) Pageable pageable) {
        log.info("Admin get all users");
        return ResponseEntity.ok(adminService.getAllUsers(pageable.getPageNumber(), pageable.getPageSize()));
    }

    @PutMapping("/users/{id}/role")
    public ResponseEntity<UserResponse> updateUserRole(@PathVariable String id,
                                                        @RequestBody Map<String, String> request) {
        String role = request.get("role");
        log.info("Admin changing user {} role to {}", id, role);
        return ResponseEntity.ok(adminService.updateUserRole(id, role));
    }

    @DeleteMapping("/songs/{id}")
    public ResponseEntity<Void> forceDeleteSong(@PathVariable String id) {
        log.info("Admin force deleting song: {}", id);
        adminService.forceDeleteSong(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/feature/song")
    public ResponseEntity<Void> featureSong(@RequestBody Map<String, String> request) {
        String songId = request.get("songId");
        log.info("Admin featuring song: {}", songId);
        adminService.featureSong(songId);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/feature/playlist")
    public ResponseEntity<Void> featurePlaylist(@RequestBody Map<String, String> request) {
        String playlistId = request.get("playlistId");
        log.info("Admin featuring playlist: {}", playlistId);
        adminService.featurePlaylist(playlistId);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/analytics/overview")
    public ResponseEntity<AdminDashboardResponse> getAnalyticsOverview() {
        log.info("Admin requested analytics overview");
        return ResponseEntity.ok(adminService.getDashboard());
    }

    @GetMapping("/analytics/user-growth")
    public ResponseEntity<List<Map<String, Object>>> getUserGrowth() {
        log.info("Admin requested user growth analytics");
        return ResponseEntity.ok(adminService.getUserGrowth("weekly"));
    }

    @GetMapping("/analytics/top-songs")
    public ResponseEntity<List<Map<String, Object>>> getTopSongs() {
        log.info("Admin requested top songs analytics");
        return ResponseEntity.ok(adminService.getTopSongs(20));
    }

    @GetMapping("/analytics/top-genres")
    public ResponseEntity<List<Map<String, Object>>> getTopGenres() {
        log.info("Admin requested top genres analytics");
        return ResponseEntity.ok(adminService.getTopGenres(20));
    }
}