package com.spotibase.controller;

import com.spotibase.dto.response.QueueResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.service.QueueService;
import com.spotibase.support.BaseWebMvcTest;
import com.spotibase.support.TestSecurityConfig;
import com.spotibase.support.TestUsers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Web slice tests for {@link QueueController}.
 */
@WebMvcTest(QueueController.class)
@Import(TestSecurityConfig.class)
class QueueControllerTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private QueueService queueService;

    private QueueResponse buildQueueResponse() {
        return QueueResponse.builder()
                .songs(List.of(SongResponse.builder().id("song-1").title("Hit Song").build()))
                .currentSong(SongResponse.builder().id("song-1").title("Hit Song").build())
                .currentPosition(0)
                .totalSongs(1)
                .totalDurationMs(180000)
                .build();
    }

    @Test
    void getQueue_authenticated_returns200() throws Exception {
        when(queueService.getQueue("user-1")).thenReturn(buildQueueResponse());

        mockMvc.perform(get("/api/v1/queue")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.songs[0].id").value("song-1"))
                .andExpect(jsonPath("$.currentPosition").value(0))
                .andExpect(jsonPath("$.totalSongs").value(1));
    }

    @Test
    void getQueue_unauthenticated_isRejected() throws Exception {
        mockMvc.perform(get("/api/v1/queue"))
                .andExpect(status().isForbidden());
    }

    @Test
    void addToQueue_returns201_defaultSource() throws Exception {
        mockMvc.perform(post("/api/v1/queue")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"songId\":\"song-1\"}"))
                .andExpect(status().isCreated());

        verify(queueService).addToQueue("user-1", "song-1", "QUEUE");
    }

    @Test
    void addToQueue_withSource_passesItThrough() throws Exception {
        mockMvc.perform(post("/api/v1/queue")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"songId\":\"song-1\",\"source\":\"SEARCH\"}"))
                .andExpect(status().isCreated());

        verify(queueService).addToQueue("user-1", "song-1", "SEARCH");
    }

    @Test
    void playNext_returns201() throws Exception {
        mockMvc.perform(post("/api/v1/queue/play-next")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"songId\":\"song-2\",\"source\":\"ALBUM\"}"))
                .andExpect(status().isCreated());

        verify(queueService).playNext("user-1", "song-2", "ALBUM");
    }

    @Test
    void removeFromQueue_returns204() throws Exception {
        mockMvc.perform(delete("/api/v1/queue/item-1")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isNoContent());

        verify(queueService).removeFromQueue("item-1", "user-1");
    }

    @Test
    void moveInQueue_returns200() throws Exception {
        mockMvc.perform(put("/api/v1/queue/item-1/move")
                        .with(user(TestUsers.regularUser("user-1")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"newPosition\":3}"))
                .andExpect(status().isOk());

        verify(queueService).moveInQueue("item-1", 3, "user-1");
    }

    @Test
    void clearQueue_returns204() throws Exception {
        mockMvc.perform(delete("/api/v1/queue")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isNoContent());

        verify(queueService).clearQueue("user-1");
    }

    @Test
    void saveQueue_returns200() throws Exception {
        mockMvc.perform(post("/api/v1/queue/save")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk());

        verify(queueService).saveQueue("user-1");
    }

    @Test
    void restoreQueue_returns200() throws Exception {
        when(queueService.restoreQueue("user-1")).thenReturn(buildQueueResponse());

        mockMvc.perform(post("/api/v1/queue/restore")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalSongs").value(1));
    }
}
