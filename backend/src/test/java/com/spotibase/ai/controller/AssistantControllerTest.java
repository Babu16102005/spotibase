package com.spotibase.ai.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotibase.ai.dto.AssistantResponse;
import com.spotibase.ai.service.AssistantService;
import com.spotibase.support.BaseWebMvcTest;
import com.spotibase.support.TestSecurityConfig;
import com.spotibase.support.TestUsers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 415 regression: POST /api/v1/ai/voice must NEVER return 415.
 * JSON fallback -&gt; 200 voice shape; multipart missing audio -&gt; 200;
 * valid multipart -&gt; 200; /ai/text JSON stays 200 strict-JSON.
 */
@WebMvcTest(AssistantController.class)
@Import({TestSecurityConfig.class, com.spotibase.exception.GlobalExceptionHandler.class})
class AssistantControllerTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AssistantService assistantService;

    private AssistantResponse okVoice(String transcript) {
        return AssistantResponse.builder()
                .transcript(transcript)
                .actions(List.of())
                .response("ok")
                .results(List.of())
                .clarificationNeeded(false)
                .build();
    }

    @Test
    void voiceJson_withFallback_returns200VoiceShape_not415() throws Exception {
        when(assistantService.handleText(eq("user-1"), eq("play calm tamil"), any()))
                .thenReturn(okVoice("play calm tamil"));

        mockMvc.perform(post("/api/v1/ai/voice")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"transcriptFallback\":\"play calm tamil\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transcript").value("play calm tamil"));
    }

    @Test
    void voiceJson_snakeCaseAlias_returns200VoiceShape() throws Exception {
        when(assistantService.handleText(eq("user-1"), eq("play calm tamil"), any()))
                .thenReturn(okVoice("play calm tamil"));

        mockMvc.perform(post("/api/v1/ai/voice")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"transcript_fallback\":\"play calm tamil\",\"context\":{\"currentSongId\":\"s1\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transcript").value("play calm tamil"));
    }

    @Test
    void voiceJson_missingFallback_returns200Clarification_not415() throws Exception {
        mockMvc.perform(post("/api/v1/ai/voice")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clarificationNeeded").value(true))
                .andExpect(jsonPath("$.clarificationQuestion").value(
                        org.hamcrest.Matchers.containsString("Voice processing failed: Missing audio")));
    }

    @Test
    void voiceMultipart_missingAudio_returns200VoiceShape() throws Exception {
        mockMvc.perform(multipart("/api/v1/ai/voice")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clarificationNeeded").value(true))
                .andExpect(jsonPath("$.clarificationQuestion").value(
                        org.hamcrest.Matchers.containsString("Voice processing failed: Missing audio")));
    }

    @Test
    void voiceMultipart_validAudio_returns200() throws Exception {
        AssistantResponse resp = AssistantResponse.builder()
                .transcript("play calm tamil")
                .actions(List.of())
                .response("Done")
                .results(List.of(Map.of("ok", true)))
                .clarificationNeeded(false)
                .build();
        when(assistantService.handleVoice(eq("user-1"), any(byte[].class), any(), any(), any()))
                .thenReturn(resp);

        MockMultipartFile audio = new MockMultipartFile(
                "audio", "audio.m4a", "audio/mp4", new byte[]{1, 2, 3});

        mockMvc.perform(multipart("/api/v1/ai/voice")
                        .file(audio)
                        .param("transcript_fallback", "play calm tamil")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transcript").value("play calm tamil"));
    }

    @Test
    void voiceMultipart_unsupportedAudioType_returns200Clarification() throws Exception {
        MockMultipartFile audio = new MockMultipartFile(
                "audio", "audio.txt", "text/plain", "hello".getBytes());

        mockMvc.perform(multipart("/api/v1/ai/voice")
                        .file(audio)
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clarificationNeeded").value(true))
                .andExpect(jsonPath("$.clarificationQuestion").value(
                        org.hamcrest.Matchers.containsString("Voice processing failed: Unsupported audio type")));
    }

    @Test
    void textJson_valid_returns200() throws Exception {
        when(assistantService.handleText(eq("user-1"), eq("pause"), any()))
                .thenReturn(okVoice("pause"));

        mockMvc.perform(post("/api/v1/ai/text")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"pause\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transcript").value("pause"));
    }

    // P0: text/plain to /ai/voice must answer 200 voice shape, never 415.
    @Test
    void voiceTextPlain_returns200VoiceShape_not415() throws Exception {
        mockMvc.perform(post("/api/v1/ai/voice")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("hello"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clarificationNeeded").value(true))
                .andExpect(jsonPath("$.clarificationQuestion").value(
                        org.hamcrest.Matchers.containsString("Voice processing failed")));
    }

    // P0: multipart to /ai/text must stay 415 strict-JSON, never voice 200.
    @Test
    void textMultipart_returns415_notVoice200() throws Exception {
        mockMvc.perform(multipart("/api/v1/ai/text")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.status").value(415));
    }

    // P0: /ai/text validation failures must be 400 via global handler, never 500 hijack.
    @Test
    void textJson_missingText_returns400_not500() throws Exception {
        mockMvc.perform(post("/api/v1/ai/text")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void textJson_malformedBody_returns400_not500() throws Exception {
        mockMvc.perform(post("/api/v1/ai/text")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{bad json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }

    // P0: unauthenticated voice/text must stay 401, never 200 voice shape.
    @Test
    void voiceJson_unauth_returns401() throws Exception {
        mockMvc.perform(post("/api/v1/ai/voice")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"transcriptFallback\":\"hi\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void textJson_unauth_returns401() throws Exception {
        mockMvc.perform(post("/api/v1/ai/text")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"hi\"}"))
                .andExpect(status().isUnauthorized());
    }
}
