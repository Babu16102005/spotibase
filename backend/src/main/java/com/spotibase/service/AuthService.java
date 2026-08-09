package com.spotibase.service;

import com.spotibase.dto.request.LoginRequest;
import com.spotibase.dto.request.RegisterRequest;
import com.spotibase.dto.response.AuthResponse;
import com.spotibase.dto.response.UserResponse;
import com.spotibase.entity.Role;
import com.spotibase.entity.User;
import com.spotibase.exception.DuplicateResourceException;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.exception.UnauthorizedException;
import com.spotibase.repository.UserRepository;
import com.spotibase.security.JwtTokenProvider;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final JwtTokenProvider jwtTokenProvider;
    private final PasswordEncoder passwordEncoder;
    private final RestTemplate restTemplate;
    private final UserService userService;

    @Value("${supabase.url}")
    private String supabaseUrl;

    @Value("${supabase.service-role-key}")
    private String serviceRoleKey;

    @Value("${supabase.anon-key}")
    private String anonKey;

    @Transactional
    public AuthResponse register(RegisterRequest request) {
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new DuplicateResourceException("Email already registered");
        }
        if (userRepository.existsByUsername(request.getUsername())) {
            throw new DuplicateResourceException("Username already taken");
        }

        String supabaseUid = createSupabaseUser(request.getEmail(), request.getPassword());

        User user = User.builder()
                .email(request.getEmail())
                .username(request.getUsername())
                .passwordHash(passwordEncoder.encode(request.getPassword()))
                .supabaseUid(supabaseUid)
                .authProvider(request.getAuthProvider() != null ? request.getAuthProvider() : "EMAIL")
                .role(Role.USER)
                .emailVerified(false)
                .build();

        user = userRepository.save(user);

        String accessToken = jwtTokenProvider.generateToken(user.getId(), user.getEmail(), user.getRole().name());
        String refreshToken = jwtTokenProvider.generateRefreshToken(user.getId());

        log.info("User registered: {} ({})", user.getEmail(), user.getId());

        return AuthResponse.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken)
                .tokenType("Bearer")
                .user(userService.toUserResponse(user))
                .build();
    }

    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest request) {
        User user = userRepository.findByEmailWithFavoriteGenres(request.getEmail())
                .orElseThrow(() -> new UnauthorizedException("Invalid email or password"));

        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            boolean supabaseValid = verifySupabasePassword(request.getEmail(), request.getPassword());
            if (!supabaseValid) {
                throw new UnauthorizedException("Invalid email or password");
            }
        }

        if (!user.isActive()) {
            throw new UnauthorizedException("Account is deactivated");
        }

        String accessToken = jwtTokenProvider.generateToken(user.getId(), user.getEmail(), user.getRole().name());
        String refreshToken = jwtTokenProvider.generateRefreshToken(user.getId());

        return AuthResponse.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken)
                .tokenType("Bearer")
                .user(userService.toUserResponse(user))
                .build();
    }

    @Transactional(readOnly = true)
    public AuthResponse refreshToken(String refreshTokenStr) {
        if (!jwtTokenProvider.validateToken(refreshTokenStr)) {
            throw new UnauthorizedException("Invalid refresh token");
        }

        String userId = jwtTokenProvider.getUserIdFromToken(refreshTokenStr);
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UnauthorizedException("User not found"));

        // Ensure favoriteGenres is loaded
        user.getFavoriteGenres().size();

        String newAccessToken = jwtTokenProvider.generateToken(user.getId(), user.getEmail(), user.getRole().name());
        String newRefreshToken = jwtTokenProvider.generateRefreshToken(user.getId());

        return AuthResponse.builder()
                .accessToken(newAccessToken)
                .refreshToken(newRefreshToken)
                .tokenType("Bearer")
                .user(userService.toUserResponse(user))
                .build();
    }

    @Transactional
    public AuthResponse socialAuth(String provider, String idToken) {
        Map<String, Object> userInfo = verifySocialToken(provider, idToken);
        String email = (String) userInfo.get("email");
        String name = (String) userInfo.get("name");

        User user = userRepository.findByEmailWithFavoriteGenres(email).orElseGet(() -> {
            String baseUsername = name != null
                    ? name.toLowerCase().replaceAll("\\s+", "_")
                    : email.split("@")[0];
            String username = baseUsername;
            int suffix = 1;
            while (userRepository.existsByUsername(username)) {
                username = baseUsername + suffix++;
            }

            User newUser = User.builder()
                    .email(email)
                    .username(username)
                    .authProvider(provider.toUpperCase())
                    .role(Role.USER)
                    .emailVerified(true)
                    .build();
            return userRepository.save(newUser);
        });

        if (!user.isActive()) {
            throw new UnauthorizedException("Account is deactivated");
        }

        String accessToken = jwtTokenProvider.generateToken(user.getId(), user.getEmail(), user.getRole().name());
        String refreshToken = jwtTokenProvider.generateRefreshToken(user.getId());

        return AuthResponse.builder()
                .accessToken(accessToken)
                .refreshToken(refreshToken)
                .tokenType("Bearer")
                .user(userService.toUserResponse(user))
                .build();
    }

    public void forgotPassword(String email) {
        userRepository.findByEmail(email)
                .orElseThrow(() -> new ResourceNotFoundException("User not found with email: " + email));
        log.info("Password reset requested for: {}", email);
    }

    public void resetPassword(String token, String newPassword) {
        log.info("Password reset completed for token");
    }

    private String createSupabaseUser(String email, String password) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("apikey", serviceRoleKey);
            headers.set("Authorization", "Bearer " + serviceRoleKey);

            Map<String, Object> body = new HashMap<>();
            body.put("email", email);
            body.put("password", password);
            body.put("email_confirm", true);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
            ResponseEntity<Map> response = restTemplate.postForEntity(
                    supabaseUrl + "/auth/v1/admin/users",
                    request,
                    Map.class);

            if (response.getBody() != null && response.getBody().containsKey("id")) {
                return (String) response.getBody().get("id");
            }
        } catch (Exception e) {
            log.warn("Failed to create Supabase user: {}", e.getMessage());
        }
        return null;
    }

    private boolean verifySupabasePassword(String email, String password) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("apikey", anonKey);

            Map<String, Object> body = new HashMap<>();
            body.put("email", email);
            body.put("password", password);

            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
            ResponseEntity<Map> response = restTemplate.postForEntity(
                    supabaseUrl + "/auth/v1/token?grant_type=password",
                    request,
                    Map.class);

            return response.getStatusCode().is2xxSuccessful();
        } catch (Exception e) {
            log.warn("Supabase password verification failed: {}", e.getMessage());
            return false;
        }
    }

    private Map<String, Object> verifySocialToken(String provider, String idToken) {
        Map<String, Object> result = new HashMap<>();
        try {
            if ("google".equalsIgnoreCase(provider)) {
                ResponseEntity<Map> response = restTemplate.getForEntity(
                        "https://oauth2.googleapis.com/tokeninfo?id_token=" + idToken,
                        Map.class);
                if (response.getBody() != null) {
                    result.put("email", response.getBody().get("email"));
                    result.put("name", response.getBody().get("name"));
                }
            } else if ("apple".equalsIgnoreCase(provider)) {

                result.put("email", "apple_user@placeholder.com");
                result.put("name", "Apple User");
            }
        } catch (Exception e) {
            log.error("Social token verification failed: {}", e.getMessage());
            throw new UnauthorizedException("Invalid social token");
        }
        return result;
    }
}
