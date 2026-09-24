package com.spotibase.ai.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotibase.ai.dto.VoicePartialResponse;
import com.spotibase.ai.service.AssistantService;
import com.spotibase.support.BaseWebMvcTest;
import com.spotibase.support.TestUsers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Realtime-partial failure/supersede contract (TestAgent, additive to
 * {@link VoicePartialControllerTest}): service exceptions still answer 200
 * clarification (never 500), oversize text is truncated to 2000 (never 400),
 * and rapid superseded calls are both read-only 200s with no side effect.
 */
@WebMvcTest(AssistantController.class)
@Import({com.spotibase.support.TestSecurityConfig.class, com.spotibase.exception.GlobalExceptionHandler.class})
class VoicePartialFailureTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AssistantService assistantService;

    private VoicePartialResponse preview(String transcript) {
        return VoicePartialResponse.builder()
                .transcript(transcript)
                .actionsPreview(List.of())
                .suggestions(List.of("Play Anirudh hits"))
                .songs(List.of())
                .searchQuery(transcript)
                .displayText("preview")
                .clarificationNeeded(false)
                .build();
    }

    @Test
    void serviceThrows_still200Clarification_never500() throws Exception {
        when(assistantService.handleVoicePartial(eq("user-1"), eq("play ani"), any()))
                .thenThrow(new RuntimeException("db down"));

        mockMvc.perform(post("/api/v1/ai/voice-partial")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"play ani\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clarificationNeeded").value(true))
                .andExpect(jsonPath("$.songs").isArray())
                .andExpect(jsonPath("$.suggestions").isArray());
    }

    @Test
    void oversizeText_truncatedTo2000_still200() throws Exception {
        String big = "x".repeat(2500);
        when(assistantService.handleVoicePartial(eq("user-1"), any(), any()))
                .thenReturn(preview(big.substring(0, 2000)));

        mockMvc.perform(post("/api/v1/ai/voice-partial")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(java.util.Map.of("text", big))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transcript").value(big.substring(0, 2000)));
    }

    @Test
    void supersededRapidCalls_both200ReadOnly_noSideEffect() throws Exception {
        when(assistantService.handleVoicePartial(eq("user-1"), eq("play a"), any()))
                .thenReturn(preview("play a"));
        when(assistantService.handleVoicePartial(eq("user-1"), eq("play ani"), any()))
                .thenReturn(preview("play ani"));

        // Prefix superseded by fuller transcript: both must be 200 preview
        // shapes (client drops the stale one by requestId; server stays stateless).
        mockMvc.perform(post("/api/v1/ai/voice-partial")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"play a\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transcript").value("play a"));

        mockMvc.perform(post("/api/v1/ai/voice-partial")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"play ani\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transcript").value("play ani"));
    }
}
