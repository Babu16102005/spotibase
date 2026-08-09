package com.spotibase.controller;

import com.spotibase.dto.request.UpdateSettingsRequest;
import com.spotibase.dto.response.UserSettingsResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.SettingsService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/settings")
@RequiredArgsConstructor
@Slf4j
public class SettingsController {

    private final SettingsService settingsService;

    @GetMapping
    public ResponseEntity<UserSettingsResponse> getSettings(@CurrentUser CustomUserDetails user) {
        log.info("Get settings for user: {}", user.getId());
        return ResponseEntity.ok(settingsService.getSettings(user.getId()));
    }

    @PutMapping
    public ResponseEntity<UserSettingsResponse> updateSettings(@CurrentUser CustomUserDetails user,
                                                       @Valid @RequestBody UpdateSettingsRequest request) {
        log.info("Update settings for user: {}", user.getId());
        return ResponseEntity.ok(settingsService.updateSettings(user.getId(), request));
    }

    @PutMapping("/theme")
    public ResponseEntity<UserSettingsResponse> updateTheme(@CurrentUser CustomUserDetails user,
                                                    @RequestBody Map<String, String> request) {
        String theme = request.get("theme");
        log.info("Update theme to {} for user: {}", theme, user.getId());
        return ResponseEntity.ok(settingsService.updateTheme(user.getId(), theme));
    }
}