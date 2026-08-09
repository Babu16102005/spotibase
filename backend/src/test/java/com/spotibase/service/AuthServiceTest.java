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
import io.jsonwebtoken.Jwts;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.PublicKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link AuthService}.
 */
@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private JwtTokenProvider jwtTokenProvider;
    @Mock
    private PasswordEncoder passwordEncoder;
    @Mock
    private RestTemplate restTemplate;
    @Mock
    private UserService userService;

    @InjectMocks
    private AuthService authService;

    private User buildUser(String id, String email, String username, String passwordHash, boolean active) {
        return User.builder()
                .id(id)
                .email(email)
                .username(username)
                .passwordHash(passwordHash)
                .role(Role.USER)
                .active(active)
                .build();
    }

    // ---------- register ----------

    @Test
    void register_success_returnsAuthResponseAndSavesUser() {
        RegisterRequest request = RegisterRequest.builder()
                .email("alice@example.com")
                .username("alice")
                .password("password123")
                .build();

        when(userRepository.existsByEmail("alice@example.com")).thenReturn(false);
        when(userRepository.existsByUsername("alice")).thenReturn(false);
        when(passwordEncoder.encode("password123")).thenReturn("encoded-hash");
        User saved = buildUser("user-1", "alice@example.com", "alice", "encoded-hash", true);
        when(userRepository.save(any(User.class))).thenReturn(saved);
        when(jwtTokenProvider.generateToken("user-1", "alice@example.com", "USER")).thenReturn("access-token");
        when(jwtTokenProvider.generateRefreshToken("user-1")).thenReturn("refresh-token");
        UserResponse userResponse = UserResponse.builder().id("user-1").email("alice@example.com").build();
        when(userService.toUserResponse(saved)).thenReturn(userResponse);

        AuthResponse response = authService.register(request);

        assertThat(response.getAccessToken()).isEqualTo("access-token");
        assertThat(response.getRefreshToken()).isEqualTo("refresh-token");
        assertThat(response.getTokenType()).isEqualTo("Bearer");
        assertThat(response.getUser()).isEqualTo(userResponse);
        // Supabase call attempted, but never fails the registration
        verify(userRepository).save(any(User.class));
    }

    @Test
    void register_duplicateEmail_throwsDuplicateResourceException() {
        RegisterRequest request = RegisterRequest.builder()
                .email("alice@example.com")
                .username("alice")
                .password("password123")
                .build();
        when(userRepository.existsByEmail("alice@example.com")).thenReturn(true);

        assertThatThrownBy(() -> authService.register(request))
                .isInstanceOf(DuplicateResourceException.class)
                .hasMessage("Email already registered");

        verify(userRepository, never()).save(any(User.class));
        verifyNoInteractions(restTemplate);
    }

    @Test
    void register_duplicateUsername_throwsDuplicateResourceException() {
        RegisterRequest request = RegisterRequest.builder()
                .email("bob@example.com")
                .username("taken")
                .password("password123")
                .build();
        when(userRepository.existsByEmail("bob@example.com")).thenReturn(false);
        when(userRepository.existsByUsername("taken")).thenReturn(true);

        assertThatThrownBy(() -> authService.register(request))
                .isInstanceOf(DuplicateResourceException.class)
                .hasMessage("Username already taken");

        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void register_preservesAuthProviderAndDefaultsRoleToUser() {
        RegisterRequest request = RegisterRequest.builder()
                .email("carol@example.com")
                .username("carol")
                .password("password123")
                .authProvider("GOOGLE")
                .build();

        when(userRepository.existsByEmail("carol@example.com")).thenReturn(false);
        when(userRepository.existsByUsername("carol")).thenReturn(false);
        when(passwordEncoder.encode(anyString())).thenReturn("hash");
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        authService.register(request);

        verify(userRepository).save(argThat(user ->
                "GOOGLE".equals(user.getAuthProvider()) && user.getRole() == Role.USER));
    }

    // ---------- login ----------

    @Test
    void login_success_returnsAuthResponse() {
        LoginRequest request = LoginRequest.builder()
                .email("alice@example.com")
                .password("password123")
                .build();
        User user = buildUser("user-1", "alice@example.com", "alice", "encoded-hash", true);

        when(userRepository.findByEmailWithFavoriteGenres("alice@example.com")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("password123", "encoded-hash")).thenReturn(true);
        when(jwtTokenProvider.generateToken("user-1", "alice@example.com", "USER")).thenReturn("access");
        when(jwtTokenProvider.generateRefreshToken("user-1")).thenReturn("refresh");
        when(userService.toUserResponse(user)).thenReturn(UserResponse.builder().id("user-1").build());

        AuthResponse response = authService.login(request);

        assertThat(response.getAccessToken()).isEqualTo("access");
        assertThat(response.getRefreshToken()).isEqualTo("refresh");
        assertThat(response.getTokenType()).isEqualTo("Bearer");
        verifyNoInteractions(restTemplate);
    }

    @Test
    void login_unknownEmail_throwsUnauthorizedException() {
        LoginRequest request = LoginRequest.builder()
                .email("ghost@example.com")
                .password("password123")
                .build();
        when(userRepository.findByEmailWithFavoriteGenres("ghost@example.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("Invalid email or password");
    }

    @Test
    void login_wrongPassword_throwsUnauthorizedException() {
        LoginRequest request = LoginRequest.builder()
                .email("alice@example.com")
                .password("wrong-password")
                .build();
        User user = buildUser("user-1", "alice@example.com", "alice", "encoded-hash", true);

        when(userRepository.findByEmailWithFavoriteGenres("alice@example.com")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("wrong-password", "encoded-hash")).thenReturn(false);
        // Supabase fallback verification fails
        when(restTemplate.postForEntity(anyString(), any(), eq(Map.class)))
                .thenThrow(new RuntimeException("network error"));

        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("Invalid email or password");
    }

    @Test
    void login_nullPasswordHash_fallsBackToSupabaseAndRejects() {
        LoginRequest request = LoginRequest.builder()
                .email("social@example.com")
                .password("whatever")
                .build();
        User user = buildUser("user-2", "social@example.com", "social", null, true);

        when(userRepository.findByEmailWithFavoriteGenres("social@example.com")).thenReturn(Optional.of(user));
        when(restTemplate.postForEntity(anyString(), any(), eq(Map.class)))
                .thenReturn(ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "invalid")));

        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("Invalid email or password");
    }

    @Test
    void login_nullPasswordHash_supabaseAccepts_passwordHashIsBypassed() {
        LoginRequest request = LoginRequest.builder()
                .email("social@example.com")
                .password("whatever")
                .build();
        User user = buildUser("user-2", "social@example.com", "social", null, true);

        when(userRepository.findByEmailWithFavoriteGenres("social@example.com")).thenReturn(Optional.of(user));
        when(restTemplate.postForEntity(anyString(), any(), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("access_token", "xyz")));
        when(jwtTokenProvider.generateToken("user-2", "social@example.com", "USER")).thenReturn("access");
        when(jwtTokenProvider.generateRefreshToken("user-2")).thenReturn("refresh");
        when(userService.toUserResponse(user)).thenReturn(UserResponse.builder().id("user-2").build());

        AuthResponse response = authService.login(request);

        assertThat(response.getAccessToken()).isEqualTo("access");
    }

    @Test
    void login_deactivatedAccount_throwsUnauthorizedException() {
        LoginRequest request = LoginRequest.builder()
                .email("alice@example.com")
                .password("password123")
                .build();
        User user = buildUser("user-1", "alice@example.com", "alice", "encoded-hash", false);

        when(userRepository.findByEmailWithFavoriteGenres("alice@example.com")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("password123", "encoded-hash")).thenReturn(true);

        assertThatThrownBy(() -> authService.login(request))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("Account is deactivated");
    }

    // ---------- refresh ----------

    @Test
    void refreshToken_validToken_issuesNewTokenPair() {
        when(jwtTokenProvider.validateToken("refresh-token")).thenReturn(true);
        when(jwtTokenProvider.getUserIdFromToken("refresh-token")).thenReturn("user-1");
        User user = buildUser("user-1", "alice@example.com", "alice", "hash", true);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(jwtTokenProvider.generateToken("user-1", "alice@example.com", "USER")).thenReturn("new-access");
        when(jwtTokenProvider.generateRefreshToken("user-1")).thenReturn("new-refresh");
        when(userService.toUserResponse(user)).thenReturn(UserResponse.builder().id("user-1").build());

        AuthResponse response = authService.refreshToken("refresh-token");

        assertThat(response.getAccessToken()).isEqualTo("new-access");
        assertThat(response.getRefreshToken()).isEqualTo("new-refresh");
        assertThat(response.getTokenType()).isEqualTo("Bearer");
    }

    @Test
    void refreshToken_invalidToken_throwsUnauthorizedException() {
        when(jwtTokenProvider.validateToken("bad-token")).thenReturn(false);

        assertThatThrownBy(() -> authService.refreshToken("bad-token"))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("Invalid refresh token");
    }

    @Test
    void refreshToken_userNotFound_throwsUnauthorizedException() {
        when(jwtTokenProvider.validateToken("refresh-token")).thenReturn(true);
        when(jwtTokenProvider.getUserIdFromToken("refresh-token")).thenReturn("missing-user");
        when(userRepository.findById("missing-user")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.refreshToken("refresh-token"))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("User not found");
    }

    // ---------- social auth ----------

    @Test
    void socialAuth_googleNewUser_createsAccountAndReturnsTokens() {
        when(restTemplate.getForEntity(anyString(), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("email", "google@example.com", "name", "Google User")));
        when(userRepository.findByEmailWithFavoriteGenres("google@example.com")).thenReturn(Optional.empty());
        when(userRepository.existsByUsername("google_user")).thenReturn(false);
        User created = buildUser("user-g", "google@example.com", "google_user", null, true);
        when(userRepository.save(any(User.class))).thenReturn(created);
        when(jwtTokenProvider.generateToken("user-g", "google@example.com", "USER")).thenReturn("access");
        when(jwtTokenProvider.generateRefreshToken("user-g")).thenReturn("refresh");
        when(userService.toUserResponse(created)).thenReturn(UserResponse.builder().id("user-g").build());

        AuthResponse response = authService.socialAuth("google", "google-id-token");

        assertThat(response.getAccessToken()).isEqualTo("access");
        assertThat(response.getRefreshToken()).isEqualTo("refresh");
        verify(userRepository).save(argThat(u ->
                "GOOGLE".equals(u.getAuthProvider()) && u.isEmailVerified() && u.getPasswordHash() == null));
    }

    @Test
    void socialAuth_existingUser_doesNotCreateNewAccount() {
        User existing = buildUser("user-1", "google@example.com", "google_user", null, true);
        when(restTemplate.getForEntity(anyString(), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("email", "google@example.com", "name", "Google User")));
        when(userRepository.findByEmailWithFavoriteGenres("google@example.com")).thenReturn(Optional.of(existing));
        when(jwtTokenProvider.generateToken("user-1", "google@example.com", "USER")).thenReturn("access");
        when(jwtTokenProvider.generateRefreshToken("user-1")).thenReturn("refresh");
        when(userService.toUserResponse(existing)).thenReturn(UserResponse.builder().id("user-1").build());

        AuthResponse response = authService.socialAuth("google", "id-token");

        assertThat(response.getAccessToken()).isEqualTo("access");
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void socialAuth_googleUsernameTaken_generatesUniqueSuffix() {
        when(restTemplate.getForEntity(anyString(), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("email", "new@example.com", "name", "New User")));
        when(userRepository.findByEmailWithFavoriteGenres("new@example.com")).thenReturn(Optional.empty());
        when(userRepository.existsByUsername("new_user")).thenReturn(true);
        when(userRepository.existsByUsername("new_user1")).thenReturn(false);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        when(jwtTokenProvider.generateToken(any(), any(), any())).thenReturn("access");
        when(jwtTokenProvider.generateRefreshToken(any())).thenReturn("refresh");

        authService.socialAuth("google", "id-token");

        verify(userRepository).save(argThat(u -> "new_user1".equals(u.getUsername())));
    }

    @Test
    void socialAuth_apple_notConfigured_throwsUnauthorizedException() {
        // APPLE_CLIENT_ID not set: appleClientId stays null in the unit test
        assertThatThrownBy(() -> authService.socialAuth("apple", "apple-id-token"))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("Apple sign-in not configured");
        verifyNoInteractions(restTemplate);
    }

    @Test
    void socialAuth_apple_malformedToken_throwsUnauthorizedException() {
        ReflectionTestUtils.setField(authService, "appleClientId", "com.example.spotibase");
        KeyPair keyPair = generateRsaKeyPair();
        when(restTemplate.getForObject(anyString(), eq(Map.class)))
                .thenReturn(
                        Map.of("jwks_uri", "https://appleid.apple.com/auth/keys"),
                        Map.of("keys", List.of(buildJwk(keyPair.getPublic(), "apple-test-key-1"))));

        assertThatThrownBy(() -> authService.socialAuth("apple", "not-a-jwt"))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("Invalid social token");
        verifyNoInteractions(userRepository);
    }

    @Test
    void socialAuth_apple_tokenSignedByDifferentKey_throwsUnauthorizedException() {
        ReflectionTestUtils.setField(authService, "appleClientId", "com.example.spotibase");
        KeyPair jwksKeyPair = generateRsaKeyPair();
        KeyPair attackerKeyPair = generateRsaKeyPair();
        when(restTemplate.getForObject(anyString(), eq(Map.class)))
                .thenReturn(
                        Map.of("jwks_uri", "https://appleid.apple.com/auth/keys"),
                        Map.of("keys", List.of(buildJwk(jwksKeyPair.getPublic(), "apple-test-key-1"))));

        // Forged token: signed with a key that is NOT in the JWKS
        String forgedToken = buildAppleIdToken(attackerKeyPair, "apple-test-key-1", "evil@example.com");

        assertThatThrownBy(() -> authService.socialAuth("apple", forgedToken))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("Invalid social token");
        verifyNoInteractions(userRepository);
    }

    @Test
    void socialAuth_apple_validToken_createsAccountAndReturnsTokens() {
        ReflectionTestUtils.setField(authService, "appleClientId", "com.example.spotibase");
        KeyPair keyPair = generateRsaKeyPair();
        when(restTemplate.getForObject(anyString(), eq(Map.class)))
                .thenReturn(
                        Map.of("jwks_uri", "https://appleid.apple.com/auth/keys"),
                        Map.of("keys", List.of(buildJwk(keyPair.getPublic(), "apple-test-key-1"))));
        when(userRepository.findByEmailWithFavoriteGenres("apple-real@example.com")).thenReturn(Optional.empty());
        when(userRepository.existsByUsername("apple_real_user")).thenReturn(false);
        User created = buildUser("user-a", "apple-real@example.com", "apple_real_user", null, true);
        when(userRepository.save(any(User.class))).thenReturn(created);
        when(jwtTokenProvider.generateToken("user-a", "apple-real@example.com", "USER")).thenReturn("access");
        when(jwtTokenProvider.generateRefreshToken("user-a")).thenReturn("refresh");
        when(userService.toUserResponse(created)).thenReturn(UserResponse.builder().id("user-a").build());

        String idToken = buildAppleIdToken(keyPair, "apple-test-key-1", "apple-real@example.com");
        AuthResponse response = authService.socialAuth("apple", idToken);

        assertThat(response.getAccessToken()).isEqualTo("access");
        verify(userRepository).save(argThat(u ->
                "APPLE".equals(u.getAuthProvider())
                        && "apple-real@example.com".equals(u.getEmail())
                        && u.isEmailVerified()));
    }

    @Test
    void socialAuth_googleNetworkFailure_throwsUnauthorizedException() {
        when(restTemplate.getForEntity(anyString(), eq(Map.class)))
                .thenThrow(new RuntimeException("network down"));

        assertThatThrownBy(() -> authService.socialAuth("google", "id-token"))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("Invalid social token");
    }

    @Test
    void socialAuth_deactivatedAccount_throwsUnauthorizedException() {
        User inactive = buildUser("user-1", "google@example.com", "google_user", null, false);
        when(restTemplate.getForEntity(anyString(), eq(Map.class)))
                .thenReturn(ResponseEntity.ok(Map.of("email", "google@example.com", "name", "Google User")));
        when(userRepository.findByEmailWithFavoriteGenres("google@example.com")).thenReturn(Optional.of(inactive));

        assertThatThrownBy(() -> authService.socialAuth("google", "id-token"))
                .isInstanceOf(UnauthorizedException.class)
                .hasMessage("Account is deactivated");
    }

    // ---------- password reset ----------

    @Test
    void forgotPassword_existingEmail_doesNotThrow() {
        when(userRepository.findByEmail("alice@example.com"))
                .thenReturn(Optional.of(buildUser("user-1", "alice@example.com", "alice", "hash", true)));

        authService.forgotPassword("alice@example.com");
    }

    @Test
    void forgotPassword_unknownEmail_throwsResourceNotFoundException() {
        when(userRepository.findByEmail("ghost@example.com")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> authService.forgotPassword("ghost@example.com"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("ghost@example.com");
    }

    @Test
    void resetPassword_isNoOpAndDoesNotThrow() {
        authService.resetPassword("some-token", "new-password-123");
    }

    // ---------- helpers (Apple verification) ----------

    private KeyPair generateRsaKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("RSA algorithm unavailable", e);
        }
    }

    private Map<String, Object> buildJwk(PublicKey publicKey, String kid) {
        RSAPublicKey rsaKey = (RSAPublicKey) publicKey;
        Map<String, Object> jwk = new HashMap<>();
        jwk.put("kty", "RSA");
        jwk.put("kid", kid);
        jwk.put("use", "sig");
        jwk.put("alg", "RS256");
        jwk.put("n", Base64.getUrlEncoder().withoutPadding().encodeToString(rsaKey.getModulus().toByteArray()));
        jwk.put("e", Base64.getUrlEncoder().withoutPadding().encodeToString(rsaKey.getPublicExponent().toByteArray()));
        return jwk;
    }

    private String buildAppleIdToken(KeyPair keyPair, String kid, String email) {
        return Jwts.builder()
                .header().keyId(kid).and()
                .issuer("https://appleid.apple.com")
                .claim("aud", "com.example.spotibase")
                .subject("001234.56789.abcdef")
                .claim("email", email)
                .claim("name", "Apple Real User")
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + 300_000))
                .signWith(keyPair.getPrivate())
                .compact();
    }
}
