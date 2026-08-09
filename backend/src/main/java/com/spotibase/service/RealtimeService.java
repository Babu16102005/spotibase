package com.spotibase.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * Real-time push service built on the STOMP WebSocket broker.
 * Pushes events to connected clients: notifications, queue sync,
 * collaborative playlist changes, and presence updates.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RealtimeService {

    private final SimpMessagingTemplate messagingTemplate;

    /** Push a notification to a single user (delivered to all their sessions). */
    public void pushNotification(String userId, Map<String, Object> payload) {
        try {
            messagingTemplate.convertAndSendToUser(userId, "/queue/notifications", payload);
        } catch (Exception e) {
            log.warn("Failed to push notification to user {}: {}", userId, e.getMessage());
        }
    }

    /** Broadcast a queue change to a specific user's devices (player sync). */
    public void pushQueueUpdate(String userId, Map<String, Object> payload) {
        try {
            messagingTemplate.convertAndSendToUser(userId, "/queue/queue-updates", payload);
        } catch (Exception e) {
            log.warn("Failed to push queue update to user {}: {}", userId, e.getMessage());
        }
    }

    /** Push a collaborative playlist change to everyone subscribed to the playlist topic. */
    public void pushPlaylistUpdate(String playlistId, Map<String, Object> payload) {
        try {
            messagingTemplate.convertAndSend("/topic/playlists/" + playlistId, payload);
        } catch (Exception e) {
            log.warn("Failed to push playlist update for {}: {}", playlistId, e.getMessage());
        }
    }

    /** Broadcast presence (online/offline) to followers. */
    public void pushPresence(String userId, boolean online) {
        try {
            messagingTemplate.convertAndSendToUser(userId, "/queue/presence",
                    Map.of("userId", userId, "online", online, "timestamp", System.currentTimeMillis()));
        } catch (Exception e) {
            log.warn("Failed to push presence for user {}: {}", userId, e.getMessage());
        }
    }

    /** Push a generic event to a user channel. */
    public void pushEvent(String userId, String channel, Map<String, Object> payload) {
        try {
            messagingTemplate.convertAndSendToUser(userId, "/queue/" + channel, payload);
        } catch (Exception e) {
            log.warn("Failed to push event {}/{} to user {}: {}", channel, userId, e.getMessage());
        }
    }
}