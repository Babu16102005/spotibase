package com.spotibase.service;

import com.spotibase.dto.response.NotificationResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.entity.Notification;
import com.spotibase.entity.User;
import com.spotibase.repository.NotificationRepository;
import com.spotibase.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional
public class NotificationService {

    private final NotificationRepository notificationRepository;
    private final UserRepository userRepository;
    private final RealtimeService realtimeService;

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(readOnly = true)
    public PagedResponse<NotificationResponse> getUserNotifications(String userId, Pageable pageable) {
        Query countQuery = entityManager.createNativeQuery(
                "SELECT COUNT(*) FROM notifications WHERE user_id = :userId");
        countQuery.setParameter("userId", userId);
        long total = ((Number) countQuery.getSingleResult()).longValue();

        Query listQuery = entityManager.createNativeQuery(
                "SELECT * FROM notifications WHERE user_id = :userId ORDER BY created_at DESC",
                Notification.class);
        listQuery.setParameter("userId", userId);
        listQuery.setFirstResult((int) pageable.getOffset());
        listQuery.setMaxResults(pageable.getPageSize());
        List<Notification> notifications = listQuery.getResultList();

        List<NotificationResponse> content = notifications.stream()
                .map(this::toNotificationResponse)
                .collect(Collectors.toList());

        int totalPages = (int) Math.ceil((double) total / pageable.getPageSize());

        return PagedResponse.<NotificationResponse>builder()
                .content(content)
                .page(pageable.getPageNumber())
                .size(pageable.getPageSize())
                .totalElements(total)
                .totalPages(totalPages)
                .first(pageable.getPageNumber() == 0)
                .last(pageable.getPageNumber() >= totalPages - 1)
                .build();
    }

    public void createNotification(String userId, String type, String title, String body, String dataJson) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("User not found with id: " + userId));

        Notification notification = Notification.builder()
                .user(user)
                .type(type)
                .title(title)
                .body(body)
                .dataJson(dataJson)
                .isRead(false)
                .build();

        notificationRepository.save(notification);
        log.info("Notification created for user {}: {}", userId, title);

        // Push real-time notification to connected clients
        Map<String, Object> payload = new HashMap<>();
        payload.put("id", notification.getId());
        payload.put("type", type);
        payload.put("title", title);
        payload.put("body", body);
        payload.put("data", dataJson);
        payload.put("isRead", false);
        payload.put("createdAt", LocalDateTime.now().toString());
        realtimeService.pushNotification(userId, payload);
        realtimeService.pushEvent(userId, "unread-count",
                Map.of("count", getUnreadCount(userId)));
    }

    public void markAsRead(String notificationId, String userId) {
        Notification notification = notificationRepository.findById(notificationId)
                .orElseThrow(() -> new RuntimeException("Notification not found with id: " + notificationId));

        if (!notification.getUser().getId().equals(userId)) {
            throw new RuntimeException("Notification does not belong to user");
        }

        notification.setRead(true);
        notificationRepository.save(notification);
    }

    public void markAllAsRead(String userId) {
        notificationRepository.markAllAsRead(userId);
    }

    @Transactional(readOnly = true)
    public long getUnreadCount(String userId) {
        return notificationRepository.countByUserIdAndIsReadFalse(userId);
    }

    public void sendNewFollowerNotification(String followedUserId, String followerUsername) {
        createNotification(
                followedUserId,
                "NEW_FOLLOWER",
                "New Follower",
                followerUsername + " started following you",
                "{\"username\":\"" + followerUsername + "\"}"
        );
    }

    public void sendNewReleaseNotification(List<User> followers, String artistName, String albumName) {
        for (User follower : followers) {
            createNotification(
                    follower.getId(),
                    "NEW_RELEASE",
                    "New Release from " + artistName,
                    artistName + " released a new album: " + albumName,
                    "{\"artistName\":\"" + artistName + "\",\"albumName\":\"" + albumName + "\"}"
            );
        }
    }

    public NotificationResponse toNotificationResponse(Notification notification) {
        return NotificationResponse.builder()
                .id(notification.getId())
                .type(notification.getType())
                .title(notification.getTitle())
                .body(notification.getBody())
                .dataJson(notification.getDataJson())
                .imageUrl(notification.getImageUrl())
                .isRead(notification.isRead())
                .createdAt(notification.getCreatedAt())
                .build();
    }
}
