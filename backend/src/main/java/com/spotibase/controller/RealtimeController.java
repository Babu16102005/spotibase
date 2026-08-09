package com.spotibase.controller;

import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.RealtimeService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * WebSocket controller for real-time client events:
 * presence, playback sync, and collaborative playlist editing.
 */
@Slf4j
@Controller
@RequiredArgsConstructor
public class RealtimeController {

    private final SimpMessagingTemplate messagingTemplate;
    private final RealtimeService realtimeService;

    /** Track connected users for presence. */
    private static final ConcurrentHashMap<String, Long> onlineUsers = new ConcurrentHashMap<>();

    @MessageMapping("/presence.online")
    public void markOnline(Principal principal) {
        if (principal == null) return;
        onlineUsers.put(principal.getName(), System.currentTimeMillis());
        messagingTemplate.convertAndSend("/topic/presence",
                Map.of("userId", principal.getName(), "online", true));
    }

    @MessageMapping("/presence.offline")
    public void markOffline(Principal principal) {
        if (principal == null) return;
        onlineUsers.remove(principal.getName());
        messagingTemplate.convertAndSend("/topic/presence",
                Map.of("userId", principal.getName(), "online", false));
    }

    @MessageMapping("/queue.sync")
    public void syncQueue(Principal principal, @Payload Map<String, Object> payload) {
        if (principal == null) return;
        // Broadcast current playback state to the user's other devices
        messagingTemplate.convertAndSendToUser(principal.getName(), "/queue/queue-updates",
                Map.of("type", "QUEUE_SYNC", "data", payload, "from", principal.getName()));
    }

    @MessageMapping("/playlist.{playlistId}.edit")
    public void playlistEdit(@DestinationVariable String playlistId,
                             Principal principal,
                             @Payload Map<String, Object> payload) {
        if (principal == null) return;
        payload.put("editor", principal.getName());
        messagingTemplate.convertAndSend("/topic/playlists/" + playlistId, payload);
    }

    @MessageMapping("/playlist.{playlistId}.join")
    public void joinPlaylist(@DestinationVariable String playlistId, Principal principal) {
        if (principal == null) return;
        messagingTemplate.convertAndSend("/topic/playlists/" + playlistId,
                Map.of("type", "MEMBER_JOINED", "userId", principal.getName()));
    }

    @MessageMapping("/playlist.{playlistId}.leave")
    public void leavePlaylist(@DestinationVariable String playlistId, Principal principal) {
        if (principal == null) return;
        messagingTemplate.convertAndSend("/topic/playlists/" + playlistId,
                Map.of("type", "MEMBER_LEFT", "userId", principal.getName()));
    }

    public static boolean isUserOnline(String userId) {
        return onlineUsers.containsKey(userId);
    }

    public static ConcurrentHashMap<String, Long> getOnlineUsers() {
        return onlineUsers;
    }
}