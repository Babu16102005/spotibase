package com.spotibase.ai.service;

import com.spotibase.ai.AssistantAction;
import com.spotibase.ai.dto.AssistantCommand;
import com.spotibase.dto.response.SearchResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.service.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * QA coverage for Jarvis voice dispatch (TestAgent).
 * Covers: top-5 voice path, blank-query NO_RESULTS shapes ("play song"
 * clarification), SEARCH_ARTIST autoplay queue+displayText, failure degrade.
 */
@ExtendWith(MockitoExtension.class)
class ActionDispatcherTest {

    @Mock RealtimeService realtimeService;
    @Mock SearchService searchService;
    @Mock RecommendationService recommendationService;
    @Mock QueueService queueService;
    @Mock LikeService likeService;
    @Mock PlaylistService playlistService;
    @Mock SongService songService;

    @InjectMocks ActionDispatcher dispatcher;

    private AssistantCommand cmd(AssistantAction action, Map<String, Object> params) {
        return AssistantCommand.builder().action(action).parameters(params).build();
    }

    private SongResponse song(String id, String title) {
        return SongResponse.builder().id(id).title(title).build();
    }

    // ---------- blank-query clarification shapes ----------

    @Test
    void searchSong_blankQuery_returnsNoResultsAsksWhatToSearch() {
        var out = dispatcher.dispatch("u1", cmd(AssistantAction.SEARCH_SONG, Map.of()), Map.of());
        assertThat(out.get("status")).isEqualTo("NO_RESULTS");
        assertThat((String) out.get("displayText")).contains("What should I search for?");
    }

    @Test
    void searchArtist_blankQuery_returnsNoResults() {
        var out = dispatcher.dispatch("u1", cmd(AssistantAction.SEARCH_ARTIST, Map.of()), Map.of());
        assertThat(out.get("status")).isEqualTo("NO_RESULTS");
    }

    @Test
    void play_blankQuery_returnsNoResultsAsksWhatToPlay() {
        var out = dispatcher.dispatch("u1", cmd(AssistantAction.PLAY, Map.of()), Map.of());
        assertThat(out.get("status")).isEqualTo("NO_RESULTS");
        assertThat((String) out.get("displayText")).contains("What should I play?");
    }

    // ---------- SEARCH_SONG top-5 voice path ----------

    @Test
    void searchSong_usesTop5VoicePath_andReturnsSearch() {
        var s1 = song("s1", "Munbe Vaa");
        // SEARCH_SONG uses generic query-first extraction: song wins when both
        // song+artist present (concat is PLAY/SEARCH_ARTIST only).
        when(searchService.search(eq("Munbe Vaa"), eq(List.of("song")),
                eq(0), eq(5), isNull(), isNull(), isNull(), eq("relevance"), eq("u1")))
                .thenReturn(SearchResponse.builder().songs(List.of(s1)).build());

        var out = dispatcher.dispatch("u1",
                cmd(AssistantAction.SEARCH_SONG,
                        Map.of("song", "Munbe Vaa", "artist", "A R Rahman")),
                Map.of());

        assertThat(out.get("status")).isEqualTo("SEARCH");
        assertThat((List<String>) out.get("songs")).containsExactly("s1");
        verify(searchService).search(eq("Munbe Vaa"), eq(List.of("song")),
                eq(0), eq(5), isNull(), isNull(), isNull(), eq("relevance"), eq("u1"));
    }

    @Test
    void searchSong_noResults_returnsNoResults() {
        when(searchService.search(anyString(), anyList(), anyInt(), anyInt(),
                isNull(), isNull(), isNull(), anyString(), anyString()))
                .thenReturn(SearchResponse.builder().songs(List.of()).build());

        var out = dispatcher.dispatch("u1",
                cmd(AssistantAction.SEARCH_SONG, Map.of("query", "zzz-no-match")),
                Map.of());

        assertThat(out.get("status")).isEqualTo("NO_RESULTS");
    }

    @Test
    void searchSong_serviceThrows_returnsFailedNot500() {
        when(searchService.search(anyString(), anyList(), anyInt(), anyInt(),
                any(), any(), any(), anyString(), anyString()))
                .thenThrow(new RuntimeException("db down"));

        var out = dispatcher.dispatch("u1",
                cmd(AssistantAction.SEARCH_SONG, Map.of("query", "hello")),
                Map.of());

        assertThat(out.get("status")).isEqualTo("FAILED");
        assertThat(out).containsKey("error");
    }

    // ---------- SEARCH_ARTIST autoplay (Anirudh/ARR top-1 path) ----------

    @Test
    void searchArtist_queuesTopHits_andSaysPlayingHits() {
        var s1 = song("s1", "Song 1");
        var s2 = song("s2", "Song 2");
        when(searchService.search(eq("Anirudh"), eq(List.of("artist", "song")),
                eq(0), eq(5), isNull(), isNull(), isNull(), eq("relevance"), eq("u1")))
                .thenReturn(SearchResponse.builder().songs(List.of(s1, s2)).build());

        var out = dispatcher.dispatch("u1",
                cmd(AssistantAction.SEARCH_ARTIST, Map.of("artist", "Anirudh")),
                Map.of());

        assertThat(out.get("status")).isEqualTo("QUEUED");
        assertThat(out.get("artist")).isEqualTo("Anirudh");
        assertThat((String) out.get("displayText")).isEqualTo("Playing Anirudh hits");
        assertThat((List<String>) out.get("songs")).containsExactly("s1", "s2");
        verify(queueService).addToQueue("u1", "s1", "AI_ARTIST");
        verify(queueService).addToQueue("u1", "s2", "AI_ARTIST");
        verify(realtimeService).pushQueueUpdate(eq("u1"), anyMap());
    }

    @Test
    void searchArtist_noSongs_returnsNoResults() {
        when(searchService.search(anyString(), anyList(), anyInt(), anyInt(),
                any(), any(), any(), anyString(), anyString()))
                .thenReturn(SearchResponse.builder().songs(List.of()).build());

        var out = dispatcher.dispatch("u1",
                cmd(AssistantAction.SEARCH_ARTIST, Map.of("artist", "Anirudh")),
                Map.of());

        assertThat(out.get("status")).isEqualTo("NO_RESULTS");
        verify(queueService, never()).addToQueue(anyString(), anyString(), anyString());
    }

    // ---------- PLAY direct top-1 ----------

    @Test
    void play_queuesFirstVoiceResult() {
        var s1 = song("s1", "Munbe Vaa");
        when(searchService.searchSongsForVoice("Munbe Vaa A R Rahman", "u1"))
                .thenReturn(List.of(s1, song("s2", "Other")));

        var out = dispatcher.dispatch("u1",
                cmd(AssistantAction.PLAY,
                        Map.of("song", "Munbe Vaa", "artist", "A R Rahman")),
                Map.of());

        assertThat(out.get("status")).isEqualTo("QUEUED");
        assertThat((List<String>) out.get("songs")).containsExactly("s1", "s2");
        verify(queueService).addToQueue("u1", "s1", "AI_PLAY");
    }

    // ---------- simple playback passthrough ----------

    @Test
    void next_pushesPlayerCommand() {
        var out = dispatcher.dispatch("u1", cmd(AssistantAction.NEXT, Map.of()), Map.of());
        assertThat(out.get("status")).isEqualTo("SENT");
        assertThat(out.get("action")).isEqualTo("NEXT");
        assertThat(out).containsKey("commandId");
        verify(realtimeService).pushEvent(eq("u1"), eq("ai-player"), anyMap());
    }
}
