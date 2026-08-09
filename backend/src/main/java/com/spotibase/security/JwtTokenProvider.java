package com.spotibase.security;

import io.jsonwebtoken.*;
import io.jsonwebtoken.io.DecodingException;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.util.Date;

@Slf4j
@Component
public class JwtTokenProvider {

    private final SecretKey jwtSecret;
    private final long jwtExpiration;
    private final long refreshExpiration;

    public JwtTokenProvider(
            @Value("${supabase.jwt-secret}") String jwtSecretString,
            @Value("${jwt.expiration}") long jwtExpiration,
            @Value("${jwt.refresh-expiration}") long refreshExpiration) {
        // Supabase JWT secrets are URL-safe base64; fall back to standard
        // base64 so secrets containing '-' or '_' decode correctly.
        byte[] keyBytes = decodeJwtSecret(jwtSecretString);
        this.jwtSecret = Keys.hmacShaKeyFor(ensureHmacKeySize(keyBytes));
        this.jwtExpiration = jwtExpiration;
        this.refreshExpiration = refreshExpiration;
    }

    private byte[] decodeJwtSecret(String secret) {
        try {
            return Decoders.BASE64URL.decode(secret);
        } catch (DecodingException urlSafeFailure) {
            return Decoders.BASE64.decode(secret);
        }
    }

    /**
     * HS256 requires a key of at least 256 bits. Supabase project secrets are
     * often only 216 bits after decoding, so deterministically stretch the key
     * with SHA-256 when needed. Tokens are issued and verified by this
     * application only, so the derivation is consistent on both sides.
     */
    private byte[] ensureHmacKeySize(byte[] keyBytes) {
        if (keyBytes.length >= 32) {
            return keyBytes;
        }
        try {
            return java.security.MessageDigest.getInstance("SHA-256").digest(keyBytes);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    public String generateToken(String userId, String email, String role) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + jwtExpiration);

        return Jwts.builder()
                .subject(userId)
                .claim("email", email)
                .claim("role", role)
                .issuedAt(now)
                .expiration(expiryDate)
                .signWith(jwtSecret)
                .compact();
    }

    public String generateRefreshToken(String userId) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + refreshExpiration);

        return Jwts.builder()
                .subject(userId)
                .claim("type", "refresh")
                .issuedAt(now)
                .expiration(expiryDate)
                .signWith(jwtSecret)
                .compact();
    }

    public String getUserIdFromToken(String token) {
        Claims claims = Jwts.parser()
                .verifyWith(jwtSecret)
                .build()
                .parseSignedClaims(token)
                .getPayload();
        return claims.getSubject();
    }

    public String getEmailFromToken(String token) {
        Claims claims = Jwts.parser()
                .verifyWith(jwtSecret)
                .build()
                .parseSignedClaims(token)
                .getPayload();
        return claims.get("email", String.class);
    }

    public boolean validateToken(String token) {
        try {
            Jwts.parser().verifyWith(jwtSecret).build().parseSignedClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            log.error("Invalid JWT token: {}", e.getMessage());
            return false;
        }
    }
}
