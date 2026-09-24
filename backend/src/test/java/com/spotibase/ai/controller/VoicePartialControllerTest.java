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
 * Realtime-partial contract: {@code POST /api/v1/ai/voice-partial} is
 * read-only ({@code actions_preview / suggestions / songs[]}) and every
 * failure answers 200 clarification — never 415/500 generic. Auth stays 401.
 */
@WebMvcTest(AssistantController.class)
@Import({com.spotibase.support.TestSecurityConfig.class, com.spotibase.exception.GlobalExceptionHandler.class})
class VoicePartialControllerTest extends BaseWebMvcTest {

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
    void voicePartial_validText_returns200PreviewShape() throws Exception {
        when(assistantService.handleVoicePartial(eq("user-1"), eq("play ani"), any()))
                .thenReturn(preview("play ani"));

        mockMvc.perform(post("/api/v1/ai/voice-partial")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"play ani\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transcript").value("play ani"))
                .andExpect(jsonPath("$.suggestions").isArray())
                .andExpect(jsonPath("$.songs").isArray())
                .andExpect(jsonPath("$.actionsPreview").isArray());
    }

    @Test
    void voicePartial_blankText_returns200Clarification() throws Exception {
        mockMvc.perform(post("/api/v1/ai/voice-partial")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"   \"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clarificationNeeded").value(true))
                .andExpect(jsonPath("$.suggestions").isArray())
                .andExpect(jsonPath("$.songs").isArray());
    }

    @Test
    void voicePartial_missingBody_returns200Clarification_not500() throws Exception {
        mockMvc.perform(post("/api/v1/ai/voice-partial")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clarificationNeeded").value(true));
    }

    @Test
    void voicePartial_wrongContentType_returns200PartialShape_not415() throws Exception {
        mockMvc.perform(post("/api/v1/ai/voice-partial")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("hello"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clarificationNeeded").value(true))
                .andExpect(jsonPath("$.songs").isArray());
    }

    @Test
    void voicePartial_unauth_returns401() throws Exception {
        mockMvc.perform(post("/api/v1/ai/voice-partial")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"hi\"}"))
                .andExpect(status().isUnauthorized());
    }
}
