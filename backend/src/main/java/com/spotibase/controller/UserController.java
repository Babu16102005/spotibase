package com.spotibase.controller;

import com.spotibase.dto.request.UpdateProfileRequest;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.UserResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.UserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
@Slf4j
public class UserController {

    private final UserService userService;

    @GetMapping("/me")
    public ResponseEntity<UserResponse> getCurrentUser(@CurrentUser CustomUserDetails user) {
        log.info("Get current user: {}", user.getId());
        return ResponseEntity.ok(userService.getCurrentUser(user.getId()));
    }

    @PutMapping("/me")
    public ResponseEntity<UserResponse> updateProfile(@CurrentUser CustomUserDetails user,
                                                       @Valid @RequestBody UpdateProfileRequest request) {
        log.info("Update profile for user: {}", user.getId());
        return ResponseEntity.ok(userService.updateProfile(user.getId(), request));
    }

    @DeleteMapping("/me")
    public ResponseEntity<Void> deleteAccount(@CurrentUser CustomUserDetails user) {
        log.info("Delete account for user: {}", user.getId());
        userService.deleteAccount(user.getId());
        return ResponseEntity.noContent().build();
    }

    @PutMapping(value = "/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, String>> updateAvatar(@CurrentUser CustomUserDetails user,
                                                             @RequestParam("file") MultipartFile file) {
        log.info("Update avatar for user: {}", user.getId());
        String avatarUrl = userService.updateAvatar(user.getId(), file);
        return ResponseEntity.ok(Map.of("avatarUrl", avatarUrl));
    }

    @PutMapping(value = "/me/cover", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, String>> updateCover(@CurrentUser CustomUserDetails user,
                                                            @RequestParam("file") MultipartFile file) {
        log.info("Update cover for user: {}", user.getId());
        String coverUrl = userService.updateCover(user.getId(), file);
        return ResponseEntity.ok(Map.of("coverUrl", coverUrl));
    }

    @PutMapping("/me/password")
    public ResponseEntity<Void> changePassword(@CurrentUser CustomUserDetails user,
                                                @RequestBody Map<String, String> request) {
        String oldPassword = request.get("oldPassword");
        String newPassword = request.get("newPassword");
        log.info("Change password for user: {}", user.getId());
        userService.changePassword(user.getId(), oldPassword, newPassword);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/{id}")
    public ResponseEntity<UserResponse> getUserById(@PathVariable String id) {
        log.info("Get user by id: {}", id);
        return ResponseEntity.ok(userService.getUserById(id));
    }

    @GetMapping("/{id}/stats")
    public ResponseEntity<Map<String, Object>> getUserStats(@PathVariable String id) {
        log.info("Get stats for user: {}", id);
        return ResponseEntity.ok(userService.getUserStats(id));
    }

    @PostMapping("/{id}/follow")
    public ResponseEntity<Void> followUser(@CurrentUser CustomUserDetails user,
                                            @PathVariable String id) {
        log.info("User {} follows user {}", user.getId(), id);
        userService.followUser(user.getId(), id);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    @DeleteMapping("/{id}/follow")
    public ResponseEntity<Void> unfollowUser(@CurrentUser CustomUserDetails user,
                                              @PathVariable String id) {
        log.info("User {} unfollows user {}", user.getId(), id);
        userService.unfollowUser(user.getId(), id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/followers")
    public ResponseEntity<PagedResponse<UserResponse>> getFollowers(@PathVariable String id,
                                                                     @PageableDefault(sort = "createdAt", direction = Sort.Direction.DESC) Pageable pageable) {
        log.info("Get followers for user: {}", id);
        return ResponseEntity.ok(userService.getFollowers(id, pageable));
    }

    @GetMapping("/{id}/following")
    public ResponseEntity<PagedResponse<UserResponse>> getFollowing(@PathVariable String id,
                                                                     @PageableDefault(sort = "createdAt", direction = Sort.Direction.DESC) Pageable pageable) {
        log.info("Get following for user: {}", id);
        return ResponseEntity.ok(userService.getFollowing(id, pageable));
    }
}