package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DownloadResponse {
    private String id;
    private String songId;
    private String filePath;
    private String quality;
    private String status;
    private long fileSize;
    private LocalDateTime downloadedAt;
    private LocalDateTime lastPlayedAt;
}