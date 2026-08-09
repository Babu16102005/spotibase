package com.spotibase.security;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link JwtTokenProvider}.
 *
 * <p>The provider is constructed directly with a Base64-encoded secret (>= 256 bits,
 * as required by HS256) and short expirations so that expiry behavior can be
 * exercised deterministically without waiting.
 */
class JwtTokenProviderTest {

    private static final String SECRET = Base64.getEncoder()
            .encodeToString("test-secret-key-which-is-long-enough-for-hs256-signing".getBytes());

    private JwtTokenProvider tokenProvider;

    @BeforeEach
    void setUp() {
        tokenProvider = new JwtTokenProvider(SECRET, 60_000L, 120_000L);
    }

    @Test
    void generateToken_createsTokenContainingSubjectEmailAndRole() {
        String token = tokenProvider.generateToken("user-123", "alice@example.com", "USER");

        assertThat(token).isNotBlank();
        assertThat(tokenProvider.getUserIdFromToken(token)).isEqualTo("user-123");
        assertThat(tokenProvider.getEmailFromToken(token)).isEqualTo("alice@example.com");
        assertThat(tokenProvider.validateToken(token)).isTrue();
    }

    @Test
    void urlSafeBase64Secret_isAccepted() {
        // Supabase JWT secrets are URL-safe base64 and may contain '-' and '_'
        String raw = "test-secret-key-which-is-long-enough-for-hs256-signing-0123456789";
        String urlSafeSecret = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(raw.getBytes());

        JwtTokenProvider urlSafeProvider = new JwtTokenProvider(urlSafeSecret, 60_000L, 60_000L);
        String token = urlSafeProvider.generateToken("user-42", "carol@example.com", "USER");

        assertThat(urlSafeProvider.validateToken(token)).isTrue();
        assertThat(urlSafeProvider.getUserIdFromToken(token)).isEqualTo("user-42");
    }

    @Test
    void shortUrlSafeSecret_below256Bits_isStretchedAndAccepted() {
        // Supabase's default project secret is 36 URL-safe base64 chars (216 bits),
        // below HS256's 256-bit minimum - the provider must still work.
        byte[] random27 = new byte[27];
        new java.security.SecureRandom().nextBytes(random27);
        String shortSecret = Base64.getUrlEncoder().withoutPadding().encodeToString(random27); // 36 chars
        assertThat(shortSecret).hasSize(36);
        assertThat(Base64.getUrlDecoder().decode(shortSecret)).hasSize(27);

        JwtTokenProvider provider = new JwtTokenProvider(shortSecret, 60_000L, 60_000L);
        String token = provider.generateToken("user-7", "dave@example.com", "PREMIUM_USER");

        assertThat(provider.validateToken(token)).isTrue();
        assertThat(provider.getEmailFromToken(token)).isEqualTo("dave@example.com");
        // A different provider with the same secret must also verify (deterministic)
        JwtTokenProvider clone = new JwtTokenProvider(shortSecret, 60_000L, 60_000L);
        assertThat(clone.validateToken(token)).isTrue();
    }

    @Test
    void generateRefreshToken_createsValidTokenWithUserIdSubject() {
        String token = tokenProvider.generateRefreshToken("user-456");

        assertThat(token).isNotBlank();
        assertThat(tokenProvider.validateToken(token)).isTrue();
        assertThat(tokenProvider.getUserIdFromToken(token)).isEqualTo("user-456");
    }

    @Test
    void validateToken_returnsFalseForNullToken() {
        assertThat(tokenProvider.validateToken(null)).isFalse();
    }

    @Test
    void validateToken_returnsFalseForEmptyToken() {
        assertThat(tokenProvider.validateToken("")).isFalse();
    }

    @Test
    void validateToken_returnsFalseForGarbageToken() {
        assertThat(tokenProvider.validateToken("not.a.jwt")).isFalse();
    }

    @Test
    void validateToken_returnsFalseForTamperedToken() {
        String token = tokenProvider.generateToken("user-123", "alice@example.com", "USER");
        // Corrupt the signature by flipping a character in the last (signature) segment
        String tampered = tamperSignature(token);

        assertThat(tampered).isNotEqualTo(token);
        assertThat(tokenProvider.validateToken(tampered)).isFalse();
    }

    @Test
    void getUserIdFromToken_returnsSubjectFromAccessToken() {
        String token = tokenProvider.generateToken("user-999", "bob@example.com", "ADMIN");

        assertThat(tokenProvider.getUserIdFromToken(token)).isEqualTo("user-999");
    }

    @Test
    void getEmailFromToken_returnsEmailClaim() {
        String token = tokenProvider.generateToken("user-999", "bob@example.com", "ADMIN");

        assertThat(tokenProvider.getEmailFromToken(token)).isEqualTo("bob@example.com");
    }

    @Test
    void tokensGeneratedByDifferentProvidersAreNotInterchangeable() {
        JwtTokenProvider otherProvider = new JwtTokenProvider(
                Base64.getEncoder().encodeToString("another-secret-key-which-is-long-enough-for-hs256".getBytes()),
                60_000L, 60_000L);

        String token = tokenProvider.generateToken("user-1", "a@b.com", "USER");

        assertThat(otherProvider.validateToken(token)).isFalse();
        assertThat(tokenProvider.validateToken(token)).isTrue();
    }

    @Test
    void expiredToken_isRejectedByValidate() {
        // Expiration already in the past
        JwtTokenProvider expiredProvider = new JwtTokenProvider(SECRET, -1000L, -1000L);
        String token = expiredProvider.generateToken("user-1", "a@b.com", "USER");

        assertThat(expiredProvider.validateToken(token)).isFalse();
    }

    @Test
    void expiredRefreshToken_isRejectedByValidate() {
        JwtTokenProvider expiredProvider = new JwtTokenProvider(SECRET, -1000L, -1000L);
        String token = expiredProvider.generateRefreshToken("user-1");

        assertThat(expiredProvider.validateToken(token)).isFalse();
    }

    private String tamperSignature(String token) {
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            return token + "x";
        }
        String signature = parts[2];
        char first = signature.charAt(0);
        char replacement = first == 'a' ? 'b' : 'a';
        return parts[0] + "." + parts[1] + "." + replacement + signature.substring(1);
    }
}
