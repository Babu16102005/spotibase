package com.spotibase.controller;

import com.spotibase.dto.response.NotificationResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.NotificationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/notifications")
@RequiredArgsConstructor
@Slf4j
public class NotificationController {

    private final NotificationService notificationService;

    @GetMapping
    public ResponseEntity<PagedResponse<NotificationResponse>> getNotifications(
            @CurrentUser CustomUserDetails user,
            @PageableDefault(sort = "createdAt", direction = Sort.Direction.DESC) Pageable pageable) {
        log.info("Get notifications for user: {}", user.getId());
        return ResponseEntity.ok(notificationService.getUserNotifications(user.getId(), pageable));
    }

    @GetMapping("/unread-count")
    public ResponseEntity<Map<String, Long>> getUnreadCount(@CurrentUser CustomUserDetails user) {
        log.info("Get unread notification count for user: {}", user.getId());
        long count = notificationService.getUnreadCount(user.getId());
        return ResponseEntity.ok(Map.of("count", count));
    }

    @PutMapping("/{id}/read")
    public ResponseEntity<Void> markAsRead(@PathVariable String id,
                                            @CurrentUser CustomUserDetails user) {
        log.info("Mark notification {} as read for user {}", id, user.getId());
        notificationService.markAsRead(id, user.getId());
        return ResponseEntity.ok().build();
    }

    @PutMapping("/read-all")
    public ResponseEntity<Void> markAllAsRead(@CurrentUser CustomUserDetails user) {
        log.info("Mark all notifications as read for user: {}", user.getId());
        notificationService.markAllAsRead(user.getId());
        return ResponseEntity.ok().build();
    }
}