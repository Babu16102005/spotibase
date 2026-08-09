package com.spotibase.controller;

import com.spotibase.dto.response.HomeResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.spotibase.service.RecommendationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/home")
@RequiredArgsConstructor
@Slf4j
public class HomeController {

    private final RecommendationService recommendationService;

    @GetMapping
    public ResponseEntity<HomeResponse> getHomeSections(@CurrentUser CustomUserDetails user) {
        log.info("Get home sections for user: {}", user.getId());
        return ResponseEntity.ok(recommendationService.getHomeSections(user.getId()));
    }
}