package com.spotibase.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotibase.dto.request.LoginRequest;
import com.spotibase.dto.request.RegisterRequest;
import com.spotibase.dto.response.AuthResponse;
import com.spotibase.dto.response.UserResponse;
import com.spotibase.service.AuthService;
import com.spotibase.support.BaseWebMvcTest;
import com.spotibase.support.TestSecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Web slice tests for {@link AuthController}.
 *
 * <p>{@code /api/v1/auth/**} is permitAll, so these endpoints are tested unauthenticated.
 */
@WebMvcTest(AuthController.class)
@Import(TestSecurityConfig.class)
class AuthControllerTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AuthService authService;

    private AuthResponse buildAuthResponse() {
        return AuthResponse.builder()
                .accessToken("access-token")
                .refreshToken("refresh-token")
                .tokenType("Bearer")
                .user(UserResponse.builder().id("user-1").email("alice@example.com").username("alice").build())
                .build();
    }

    @Test
    void register_validPayload_returns201WithTokenBody() throws Exception {
        when(authService.register(any(RegisterRequest.class))).thenReturn(buildAuthResponse());

        String body = objectMapper.writeValueAsString(RegisterRequest.builder()
                .email("alice@example.com")
                .username("alice")
                .password("password123")
                .build());

        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accessToken").value("access-token"))
                .andExpect(jsonPath("$.refreshToken").value("refresh-token"))
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.user.id").value("user-1"))
                .andExpect(jsonPath("$.user.email").value("alice@example.com"));
    }

    @Test
    void register_missingRequiredFields_returns400WithValidationErrors() throws Exception {
        String body = objectMapper.writeValueAsString(RegisterRequest.builder()
                .email("")
                .username("al")
                .password("short")
                .build());

        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.message").value("Invalid input parameters"))
                .andExpect(jsonPath("$.validationErrors.email").value("Email is required"))
                .andExpect(jsonPath("$.validationErrors.username").value("Username must be between 3 and 50 characters"))
                .andExpect(jsonPath("$.validationErrors.password").value("Password must be between 8 and 100 characters"));
    }

    @Test
    void register_invalidEmailFormat_returns400() throws Exception {
        String body = objectMapper.writeValueAsString(RegisterRequest.builder()
                .email("not-an-email")
                .username("alice")
                .password("password123")
                .build());

        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.validationErrors.email").value("Invalid email format"));
    }

    @Test
    void register_emptyBody_returns400() throws Exception {
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void login_validPayload_returns200() throws Exception {
        when(authService.login(any(LoginRequest.class))).thenReturn(buildAuthResponse());

        String body = objectMapper.writeValueAsString(LoginRequest.builder()
                .email("alice@example.com")
                .password("password123")
                .build());

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("access-token"))
                .andExpect(jsonPath("$.user.username").value("alice"));
    }

    @Test
    void login_missingFields_returns400() throws Exception {
        String body = objectMapper.writeValueAsString(LoginRequest.builder().build());

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.validationErrors.email").value("Email is required"))
                .andExpect(jsonPath("$.validationErrors.password").value("Password is required"));
    }

    @Test
    void login_wrongCredentials_delegatesToServiceAndReturns401() throws Exception {
        // Production behavior: service throws UnauthorizedException -> GlobalExceptionHandler -> 401
        org.mockito.Mockito.doThrow(new com.spotibase.exception.UnauthorizedException("Invalid email or password"))
                .when(authService).login(any(LoginRequest.class));

        String body = objectMapper.writeValueAsString(LoginRequest.builder()
                .email("alice@example.com")
                .password("wrong")
                .build());

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.message").value("Invalid email or password"));
    }

    @Test
    void refreshToken_validBody_returns200() throws Exception {
        when(authService.refreshToken("refresh-token")).thenReturn(buildAuthResponse());

        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"refresh-token\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("access-token"));
    }

    @Test
    void forgotPassword_existingEmail_returns200() throws Exception {
        mockMvc.perform(post("/api/v1/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"alice@example.com\"}"))
                .andExpect(status().isOk());

        verify(authService).forgotPassword("alice@example.com");
    }

    @Test
    void resetPassword_returns200() throws Exception {
        mockMvc.perform(post("/api/v1/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"t\",\"newPassword\":\"new-password-123\"}"))
                .andExpect(status().isOk());

        verify(authService).resetPassword(anyString(), anyString());
    }
}
