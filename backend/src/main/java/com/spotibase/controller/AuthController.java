package com.spotibase.controller;

import com.spotibase.dto.request.LoginRequest;
import com.spotibase.dto.request.RegisterRequest;
import com.spotibase.dto.response.AuthResponse;
import com.spotibase.service.AuthService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
@Slf4j
public class AuthController {

    private final AuthService authService;

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        log.info("Registration request for email: {}", request.getEmail());
        return ResponseEntity.status(HttpStatus.CREATED).body(authService.register(request));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        log.info("Login request for email: {}", request.getEmail());
        return ResponseEntity.ok(authService.login(request));
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refreshToken(@RequestBody Map<String, String> request) {
        String refreshToken = request.get("refreshToken");
        log.info("Token refresh request");
        return ResponseEntity.ok(authService.refreshToken(refreshToken));
    }

    @PostMapping("/social/{provider}")
    public ResponseEntity<AuthResponse> socialAuth(@PathVariable String provider,
                                                    @RequestBody Map<String, String> request) {
        String idToken = request.get("idToken");
        log.info("Social auth request for provider: {}", provider);
        return ResponseEntity.ok(authService.socialAuth(provider, idToken));
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<Void> forgotPassword(@RequestBody Map<String, String> request) {
        String email = request.get("email");
        log.info("Password reset requested for email: {}", email);
        authService.forgotPassword(email);
        return ResponseEntity.ok().build();
    }

    @PostMapping("/reset-password")
    public ResponseEntity<Void> resetPassword(@RequestBody Map<String, String> request) {
        String token = request.get("token");
        String newPassword = request.get("newPassword");
        log.info("Password reset with token");
        authService.resetPassword(token, newPassword);
        return ResponseEntity.ok().build();
    }
}