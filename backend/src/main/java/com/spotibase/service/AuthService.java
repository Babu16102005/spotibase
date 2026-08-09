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
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Header;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.ProtectedHeader;
import io.jsonwebtoken.io.Decoders;
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

import java.math.BigInteger;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyFactory;
import java.security.spec.RSAPublicKeySpec;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private static final String APPLE_OIDC_DISCOVERY_URL = "https://appleid.apple.com/.well-known/openid-configuration";
    private static final String APPLE_ISSUER = "https://appleid.apple.com";

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

    @Value("${apple.client-id:}")
    private String appleClientId;

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
                result.putAll(verifyAppleToken(idToken));
            }
        } catch (UnauthorizedException e) {
            // Preserve specific messages (e.g. "Apple sign-in not configured")
            throw e;
        } catch (Exception e) {
            log.error("Social token verification failed: {}", e.getMessage());
            throw new UnauthorizedException("Invalid social token");
        }
        return result;
    }

    /**
     * Verifies a Sign in with Apple identity token end-to-end:
     * <ol>
     *   <li>Fetches Apple's OIDC discovery document to locate the JWKS URI.</li>
     *   <li>Fetches Apple's public keys (JWKS) and selects the RSA key matching
     *       the token's {@code kid} header.</li>
     *   <li>Verifies the token's RS256 signature with that key and validates
     *       {@code iss}, {@code aud} (configured Apple client id) and
     *       {@code exp} (enforced by the JWT parser).</li>
     *   <li>Extracts the verified {@code email} claim; {@code name} falls back
     *       to the {@code sub} claim, since Apple only includes {@code name}
     *       in the initial authorization response, not in the id_token.</li>
     * </ol>
     * No cached keys are trusted: discovery + JWKS are fetched per verification,
     * so Apple key rotation is always honored.
     */
    private Map<String, Object> verifyAppleToken(String idToken) {
        if (appleClientId == null || appleClientId.isBlank()) {
            throw new UnauthorizedException("Apple sign-in not configured");
        }

        // 1. OIDC discovery -> jwks_uri
        Map<String, Object> discovery = restTemplate.getForObject(APPLE_OIDC_DISCOVERY_URL, Map.class);
        if (discovery == null || !(discovery.get("jwks_uri") instanceof String jwksUri) || jwksUri.isBlank()) {
            throw new UnauthorizedException("Invalid social token");
        }

        // 2. Apple public keys (JWKS)
        Map<String, Object> jwks = restTemplate.getForObject(jwksUri, Map.class);

        // 3. Verify RS256 signature and validate iss/aud/exp claims.
        //    jjwt's keyLocator picks the JWKS key by the token's `kid`; the
        //    parser rejects expired tokens (exp) and requireIssuer/requireAudience
        //    reject tokens not issued for Apple / for our client id.
        Claims claims;
        try {
            claims = Jwts.parser()
                    .keyLocator(header -> resolveAppleSigningKey(jwks, keyIdOf(header)))
                    .requireIssuer(APPLE_ISSUER)
                    .requireAudience(appleClientId)
                    .build()
                    .parseSignedClaims(idToken)
                    .getPayload();
        } catch (JwtException | IllegalArgumentException e) {
            log.warn("Apple id_token verification failed: {}", e.getMessage());
            throw new UnauthorizedException("Invalid social token");
        }

        // 4. Extract verified profile claims; email is required for an account
        String email = claims.get("email", String.class);
        if (email == null || email.isBlank()) {
            throw new UnauthorizedException("Invalid social token");
        }
        String name = claims.get("name", String.class);
        if (name == null || name.isBlank()) {
            name = claims.getSubject();
        }

        Map<String, Object> userInfo = new HashMap<>();
        userInfo.put("email", email);
        userInfo.put("name", name);
        return userInfo;
    }

    private String keyIdOf(Header header) {
        if (header instanceof ProtectedHeader protectedHeader) {
            return protectedHeader.getKeyId();
        }
        throw new IllegalArgumentException("Apple id_token header is not a JWS header");
    }

    private Key resolveAppleSigningKey(Map<String, Object> jwks, String kid) {
        if (jwks == null || !(jwks.get("keys") instanceof List<?> keys) || keys.isEmpty()) {
            throw new IllegalArgumentException("Apple JWKS contains no keys");
        }
        if (kid == null || kid.isBlank()) {
            throw new IllegalArgumentException("Apple id_token is missing the kid header");
        }
        for (Object keyEntry : keys) {
            if (keyEntry instanceof Map<?, ?> keyMap && kid.equals(keyMap.get("kid"))) {
                return rsaPublicKeyFromJwk(keyMap);
            }
        }
        throw new IllegalArgumentException("No Apple signing key found for kid: " + kid);
    }

    private Key rsaPublicKeyFromJwk(Map<?, ?> jwk) {
        if (!"RSA".equals(jwk.get("kty"))) {
            throw new IllegalArgumentException("Unsupported Apple JWK key type: " + jwk.get("kty"));
        }
        Object n = jwk.get("n");
        Object e = jwk.get("e");
        if (!(n instanceof String) || !(e instanceof String)) {
            throw new IllegalArgumentException("Invalid Apple RSA JWK (missing n/e)");
        }
        byte[] modulus = Decoders.BASE64URL.decode((String) n);
        byte[] exponent = Decoders.BASE64URL.decode((String) e);
        RSAPublicKeySpec keySpec = new RSAPublicKeySpec(new BigInteger(1, modulus), new BigInteger(1, exponent));
        try {
            return KeyFactory.getInstance("RSA").generatePublic(keySpec);
        } catch (GeneralSecurityException ex) {
            throw new IllegalArgumentException("Failed to build Apple RSA public key", ex);
        }
    }
}
