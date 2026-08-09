package com.spotibase.controller;

import com.spotibase.dto.response.QueueResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.QueueService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/queue")
@RequiredArgsConstructor
@Slf4j
public class QueueController {

    private final QueueService queueService;

    @GetMapping
    public ResponseEntity<QueueResponse> getQueue(@CurrentUser CustomUserDetails user) {
        log.info("Get queue for user: {}", user.getId());
        return ResponseEntity.ok(queueService.getQueue(user.getId()));
    }

    @PostMapping
    public ResponseEntity<Void> addToQueue(@CurrentUser CustomUserDetails user,
                                            @RequestBody Map<String, String> request) {
        String songId = request.get("songId");
        String source = request.getOrDefault("source", "QUEUE");
        log.info("Add song {} to queue for user {}", songId, user.getId());
        queueService.addToQueue(user.getId(), songId, source);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @PostMapping("/play-next")
    public ResponseEntity<Void> playNext(@CurrentUser CustomUserDetails user,
                                          @RequestBody Map<String, String> request) {
        String songId = request.get("songId");
        String source = request.getOrDefault("source", "QUEUE");
        log.info("Play next song {} for user {}", songId, user.getId());
        queueService.playNext(user.getId(), songId, source);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> removeFromQueue(@PathVariable String id,
                                                 @CurrentUser CustomUserDetails user) {
        log.info("Remove queue item {} for user {}", id, user.getId());
        queueService.removeFromQueue(id, user.getId());
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/{id}/move")
    public ResponseEntity<Void> moveInQueue(@PathVariable String id,
                                             @RequestBody Map<String, Integer> request,
                                             @CurrentUser CustomUserDetails user) {
        int newPosition = request.get("newPosition");
        log.info("Move queue item {} to position {} for user {}", id, newPosition, user.getId());
        queueService.moveInQueue(id, newPosition, user.getId());
        return ResponseEntity.ok().build();
    }

    @DeleteMapping
    public ResponseEntity<Void> clearQueue(@CurrentUser CustomUserDetails user) {
        log.info("Clear queue for user: {}", user.getId());
        queueService.clearQueue(user.getId());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/save")
    public ResponseEntity<Void> saveQueue(@CurrentUser CustomUserDetails user) {
        log.info("Save queue for user: {}", user.getId());
        queueService.saveQueue(user.getId());
        return ResponseEntity.ok().build();
    }

    @PostMapping("/restore")
    public ResponseEntity<QueueResponse> restoreQueue(@CurrentUser CustomUserDetails user) {
        log.info("Restore queue for user: {}", user.getId());
        return ResponseEntity.ok(queueService.restoreQueue(user.getId()));
    }
}