package com.spotibase.service;

import com.spotibase.dto.response.DownloadResponse;
import com.spotibase.entity.Download;
import com.spotibase.entity.Song;
import com.spotibase.entity.User;
import com.spotibase.exception.BadRequestException;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.DownloadRepository;
import com.spotibase.repository.SongRepository;
import com.spotibase.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class DownloadService {

    private final DownloadRepository downloadRepository;
    private final SongRepository songRepository;
    private final UserRepository userRepository;
    private final StorageService storageService;

    @Transactional
    public DownloadResponse startDownload(String userId, String songId, String quality) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        Song song = songRepository.findById(songId)
                .orElseThrow(() -> new ResourceNotFoundException("Song", songId));

        // Check if already downloaded or downloading
        var existing = downloadRepository.findByUserIdAndSongId(userId, songId);
        if (existing.isPresent()) {
            Download download = existing.get();
            if (download.getStatus().equals("COMPLETED")) {
                throw new BadRequestException("Song already downloaded");
            }
            if (download.getStatus().equals("DOWNLOADING")) {
                throw new BadRequestException("Song is already being downloaded");
            }
            // Resume failed/paused download
            download.setStatus("DOWNLOADING");
            download.setQuality(quality);
            download = downloadRepository.save(download);
            return toDownloadResponse(download);
        }

        // Create new download record
        Download download = Download.builder()
                .user(user)
                .songId(songId)
                .quality(quality)
                .status("DOWNLOADING")
                .fileSize(song.getFileSize())
                .lastPlayedAt(LocalDateTime.now())
                .build();

        download = downloadRepository.save(download);
        log.info("Started download for song {} by user {}", songId, userId);
        return toDownloadResponse(download);
    }

    @Transactional
    public DownloadResponse completeDownload(String userId, String songId, String filePath, long fileSize) {
        Download download = downloadRepository.findByUserIdAndSongId(userId, songId)
                .orElseThrow(() -> new ResourceNotFoundException("Download", songId));

        download.setStatus("COMPLETED");
        download.setFilePath(filePath);
        download.setFileSize(fileSize);
        download.setLastPlayedAt(LocalDateTime.now());
        download = downloadRepository.save(download);
        return toDownloadResponse(download);
    }

    @Transactional
    public DownloadResponse failDownload(String userId, String songId) {
        Download download = downloadRepository.findByUserIdAndSongId(userId, songId)
                .orElseThrow(() -> new ResourceNotFoundException("Download", songId));

        download.setStatus("FAILED");
        download = downloadRepository.save(download);
        return toDownloadResponse(download);
    }

    @Transactional
    public void deleteDownload(String userId, String songId) {
        Download download = downloadRepository.findByUserIdAndSongId(userId, songId)
                .orElseThrow(() -> new ResourceNotFoundException("Download", songId));

        // Delete file from storage if exists
        if (download.getFilePath() != null && !download.getFilePath().isBlank()) {
            storageService.deleteFile(download.getFilePath());
        }

        downloadRepository.delete(download);
        log.info("Deleted download for song {} by user {}", songId, userId);
    }

    @Transactional(readOnly = true)
    public List<DownloadResponse> getUserDownloads(String userId) {
        return downloadRepository.findByUserId(userId).stream()
                .map(this::toDownloadResponse)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public List<DownloadResponse> getUserDownloadsByStatus(String userId, String status) {
        return downloadRepository.findByUserIdAndStatus(userId, status).stream()
                .map(this::toDownloadResponse)
                .collect(Collectors.toList());
    }

    @Transactional(readOnly = true)
    public long getDownloadCount(String userId) {
        return downloadRepository.countByUserId(userId);
    }

    @Transactional(readOnly = true)
    public long getDownloadSize(String userId) {
        return downloadRepository.findByUserId(userId).stream()
                .filter(d -> "COMPLETED".equals(d.getStatus()))
                .mapToLong(Download::getFileSize)
                .sum();
    }

    @Transactional
    public DownloadResponse updateLastPlayed(String userId, String songId) {
        Download download = downloadRepository.findByUserIdAndSongId(userId, songId)
                .orElseThrow(() -> new ResourceNotFoundException("Download", songId));

        download.setLastPlayedAt(LocalDateTime.now());
        download = downloadRepository.save(download);
        return toDownloadResponse(download);
    }

    @Transactional
    public void clearCompletedDownloads(String userId) {
        List<Download> completed = downloadRepository.findByUserIdAndStatus(userId, "COMPLETED");
        for (Download download : completed) {
            if (download.getFilePath() != null) {
                storageService.deleteFile(download.getFilePath());
            }
        }
        downloadRepository.deleteAll(completed);
        log.info("Cleared {} completed downloads for user {}", completed.size(), userId);
    }

    private DownloadResponse toDownloadResponse(Download download) {
        return DownloadResponse.builder()
                .id(download.getId())
                .songId(download.getSongId())
                .filePath(download.getFilePath())
                .quality(download.getQuality())
                .status(download.getStatus())
                .fileSize(download.getFileSize())
                .downloadedAt(download.getDownloadedAt())
                .lastPlayedAt(download.getLastPlayedAt())
                .build();
    }
}