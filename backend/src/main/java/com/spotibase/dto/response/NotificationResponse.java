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
public class NotificationResponse {
    private String id;
    private String type;
    private String title;
    private String body;
    private String dataJson;
    private String imageUrl;
    private boolean isRead;
    private LocalDateTime createdAt;
}
