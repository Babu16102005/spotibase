package com.spotibase.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Test-only security configuration mirroring {@code com.spotibase.security.SecurityConfig}
 * rules, but without the {@code JwtAuthenticationFilter} / {@code AuthenticationManager}
 * dependencies so that {@code @WebMvcTest} slices start without a full application context.
 *
 * <p>Matches production behavior: CSRF disabled, stateless sessions, permitAll for
 * {@code /api/v1/auth/**} and song streaming, ADMIN role for {@code /api/v1/admin/**},
 * everything else authenticated, method security enabled.
 */
@TestConfiguration
@EnableMethodSecurity
public class TestSecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/api/v1/auth/**").permitAll()
                        .requestMatchers("/api/v1/public/**").permitAll()
                        .requestMatchers("/ws/**").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/songs/*/stream").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/search/suggestions",
                                "/api/v1/search/trending", "/api/v1/playlists/featured").permitAll()
                        .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
                        .anyRequest().authenticated());
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
