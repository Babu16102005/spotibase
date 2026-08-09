package com.spotibase.security;

import com.spotibase.entity.Role;
import com.spotibase.entity.User;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link JwtAuthenticationFilter}.
 */
@ExtendWith(MockitoExtension.class)
class JwtAuthenticationFilterTest {

    @Mock
    private JwtTokenProvider jwtTokenProvider;

    @Mock
    private UserDetailsService userDetailsService;

    @InjectMocks
    private JwtAuthenticationFilter filter;

    private MockHttpServletRequest request;
    private MockHttpServletResponse response;
    private FilterChain filterChain;

    @BeforeEach
    void setUp() {
        request = new MockHttpServletRequest();
        response = new MockHttpServletResponse();
        filterChain = mock(FilterChain.class);
        SecurityContextHolder.clearContext();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void validToken_setsAuthenticationInSecurityContext() throws Exception {
        String token = "valid.jwt.token";
        CustomUserDetails userDetails = buildUserDetails("ROLE_USER");

        request.addHeader("Authorization", "Bearer " + token);
        when(jwtTokenProvider.validateToken(token)).thenReturn(true);
        when(jwtTokenProvider.getUserIdFromToken(token)).thenReturn("user-1");
        when(userDetailsService.loadUserByUsername("user-1")).thenReturn(userDetails);

        filter.doFilter(request, response, filterChain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNotNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication().getPrincipal())
                .isSameAs(userDetails);
        assertThat(SecurityContextHolder.getContext().getAuthentication().getAuthorities())
                .extracting("authority")
                .containsExactly("ROLE_USER");
        verify(filterChain).doFilter(request, response);
    }

    @Test
    void missingToken_leavesSecurityContextEmpty() throws Exception {
        filter.doFilter(request, response, filterChain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verify(jwtTokenProvider, never()).validateToken(anyString());
        verify(userDetailsService, never()).loadUserByUsername(anyString());
        verify(filterChain).doFilter(request, response);
    }

    @Test
    void malformedAuthorizationHeader_leavesSecurityContextEmpty() throws Exception {
        request.addHeader("Authorization", "Basic abc123");

        filter.doFilter(request, response, filterChain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verify(jwtTokenProvider, never()).validateToken(anyString());
        verify(filterChain).doFilter(request, response);
    }

    @Test
    void invalidToken_leavesSecurityContextEmpty() throws Exception {
        request.addHeader("Authorization", "Bearer invalid.token.value");
        when(jwtTokenProvider.validateToken(anyString())).thenReturn(false);

        filter.doFilter(request, response, filterChain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verify(jwtTokenProvider, never()).getUserIdFromToken(anyString());
        verify(userDetailsService, never()).loadUserByUsername(anyString());
        verify(filterChain).doFilter(request, response);
    }

    @Test
    void invalidTokenWithEmptySubject_doesNotSetAuthentication() throws Exception {
        request.addHeader("Authorization", "Bearer token-with-empty-subject");
        when(jwtTokenProvider.validateToken(anyString())).thenReturn(true);
        when(jwtTokenProvider.getUserIdFromToken(anyString())).thenReturn(null);

        filter.doFilter(request, response, filterChain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verify(filterChain).doFilter(request, response);
    }

    @Test
    void exceptionDuringUserLookup_clearsContextAndContinuesChain() throws Exception {
        request.addHeader("Authorization", "Bearer valid.jwt.token");
        when(jwtTokenProvider.validateToken(anyString())).thenReturn(true);
        when(jwtTokenProvider.getUserIdFromToken(anyString())).thenReturn("user-1");
        when(userDetailsService.loadUserByUsername("user-1"))
                .thenThrow(new RuntimeException("lookup failed"));

        filter.doFilter(request, response, filterChain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verify(filterChain).doFilter(request, response);
    }

    @Test
    void validateTokenThrows_doesNotPropagateAndContinuesChain() throws Exception {
        request.addHeader("Authorization", "Bearer valid.jwt.token");
        when(jwtTokenProvider.validateToken(anyString())).thenThrow(new RuntimeException("boom"));

        filter.doFilter(request, response, filterChain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verify(filterChain).doFilter(request, response);
    }

    @Test
    void filterIsOnlyAppliedOncePerRequest() throws Exception {
        String token = "valid.jwt.token";
        request.addHeader("Authorization", "Bearer " + token);
        when(jwtTokenProvider.validateToken(token)).thenReturn(true);
        when(jwtTokenProvider.getUserIdFromToken(token)).thenReturn("user-1");
        when(userDetailsService.loadUserByUsername("user-1")).thenReturn(buildUserDetails("ROLE_USER"));

        filter.doFilter(request, response, filterChain);
        filter.doFilter(request, response, filterChain);

        // The second pass must not re-authenticate over the existing context
        verify(jwtTokenProvider, times(2)).validateToken(token);
        verify(filterChain, times(2)).doFilter(request, response);
    }

    @Test
    void bearerTokenWithLowerCasePrefix_isTreatedAsMissing() throws Exception {
        request.addHeader("Authorization", "bearer lowercase.prefix");

        filter.doFilter(request, response, filterChain);

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verify(jwtTokenProvider, never()).validateToken(anyString());
    }

    private CustomUserDetails buildUserDetails(String role) {
        User user = User.builder()
                .id("user-1")
                .email("user@example.com")
                .username("user-1")
                .role(Role.valueOf(role.replace("ROLE_", "")))
                .active(true)
                .build();
        return new CustomUserDetails(user);
    }
}
