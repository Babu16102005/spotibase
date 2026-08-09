package com.spotibase.controller;

import com.spotibase.dto.response.DownloadResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.DownloadService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/downloads")
@RequiredArgsConstructor
@Slf4j
public class DownloadController {

    private final DownloadService downloadService;

    @PostMapping
    @PreAuthorize("hasRole('USER') or hasRole('PREMIUM_USER') or hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<DownloadResponse> startDownload(
            @CurrentUser CustomUserDetails user,
            @RequestParam String songId,
            @RequestParam(defaultValue = "HIGH") String quality) {
        log.info("Start download: songId={}, quality={}, user={}", songId, quality, user.getId());
        DownloadResponse response = downloadService.startDownload(user.getId(), songId, quality);
        return ResponseEntity.ok(response);
    }

    @GetMapping
    @PreAuthorize("hasRole('USER') or hasRole('PREMIUM_USER') or hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<List<DownloadResponse>> getDownloads(
            @CurrentUser CustomUserDetails user,
            @RequestParam(required = false) String status) {
        List<DownloadResponse> downloads;
        if (status != null && !status.isBlank()) {
            downloads = downloadService.getUserDownloadsByStatus(user.getId(), status);
        } else {
            downloads = downloadService.getUserDownloads(user.getId());
        }
        return ResponseEntity.ok(downloads);
    }

    @GetMapping("/stats")
    @PreAuthorize("hasRole('USER') or hasRole('PREMIUM_USER') or hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<DownloadStatsResponse> getDownloadStats(@CurrentUser CustomUserDetails user) {
        long count = downloadService.getDownloadCount(user.getId());
        long size = downloadService.getDownloadSize(user.getId());
        return ResponseEntity.ok(new DownloadStatsResponse(count, size));
    }

    @DeleteMapping("/{songId}")
    @PreAuthorize("hasRole('USER') or hasRole('PREMIUM_USER') or hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<Void> deleteDownload(
            @CurrentUser CustomUserDetails user,
            @PathVariable String songId) {
        log.info("Delete download: songId={}, user={}", songId, user.getId());
        downloadService.deleteDownload(user.getId(), songId);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping
    @PreAuthorize("hasRole('USER') or hasRole('PREMIUM_USER') or hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<Void> clearCompletedDownloads(@CurrentUser CustomUserDetails user) {
        log.info("Clear completed downloads for user: {}", user.getId());
        downloadService.clearCompletedDownloads(user.getId());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/{songId}/play")
    @PreAuthorize("hasRole('USER') or hasRole('PREMIUM_USER') or hasRole('ARTIST') or hasRole('ADMIN')")
    public ResponseEntity<DownloadResponse> markPlayed(
            @CurrentUser CustomUserDetails user,
            @PathVariable String songId) {
        DownloadResponse response = downloadService.updateLastPlayed(user.getId(), songId);
        return ResponseEntity.ok(response);
    }

    public record DownloadStatsResponse(long count, long totalSizeBytes) {}
}