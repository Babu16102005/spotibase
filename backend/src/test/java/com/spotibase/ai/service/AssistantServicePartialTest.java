package com.spotibase.ai.service;

import com.spotibase.ai.AssistantAction;
import com.spotibase.ai.dto.AssistantCommand;
import com.spotibase.ai.dto.AssistantContext;
import com.spotibase.ai.dto.VoicePartialResponse;
import com.spotibase.dto.response.SongResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Realtime-partial read-only contract for {@code handleVoicePartial} (TestAgent).
 *
 * Covers: SEARCH-only allow-list (belt-and-braces over FastAPI), never
 * dispatches/queues/likes (superseded calls have no side effect), read-only
 * top-5 voice search, 401 stays at controller layer, every failure is a
 * 200-shape clarification (never throws).
 */
@ExtendWith(MockitoExtension.class)
class AssistantServicePartialTest {

    @Mock SimpleCommandDetector simpleDetector;
    @Mock QwenClient qwenClient;
    @Mock ActionDispatcher dispatcher;
    @Mock com.spotibase.service.SearchService searchService;

    @InjectMocks AssistantService assistantService;

    private AssistantCommand cmd(AssistantAction action) {
        return AssistantCommand.builder().action(action).parameters(Map.of()).build();
    }

    private QwenClient.PartialQwenResponse partialResp(List<AssistantCommand> preview,
                                                       String searchQuery, List<String> suggestions) {
        return new QwenClient.PartialQwenResponse(preview, "", false, null, suggestions, searchQuery);
    }

    private SongResponse song(String id) {
        return SongResponse.builder().id(id).title("T" + id).build();
    }

    @Test
    void blankText_returnsClarification_withoutTouchingAiOrSearch() {
        VoicePartialResponse out = assistantService.handleVoicePartial("u1", "   ", null);

        assertThat(out.isClarificationNeeded()).isTrue();
        assertThat(out.getActionsPreview()).isEmpty();
        assertThat(out.getSongs()).isEmpty();
        assertThat(out.getSuggestions()).isNotEmpty();
        verifyNoInteractions(qwenClient, searchService, dispatcher);
    }

    @Test
    void nonSearchPreviewActions_areFiltered_neverDispatched() {
        when(qwenClient.understandVoicePartialText(eq("play ani"), any()))
                .thenReturn(Optional.of(partialResp(
                        List.of(cmd(AssistantAction.SEARCH_ARTIST),
                                cmd(AssistantAction.ADD_TO_QUEUE),
                                cmd(AssistantAction.LIKE_CURRENT),
                                cmd(AssistantAction.PLAY_BY_MOOD),
                                cmd(AssistantAction.NEXT)),
                        "ani", List.of("Play Anirudh hits"))));
        when(searchService.searchSongsForVoice(eq("ani"), eq("u1")))
                .thenReturn(List.of(song("s1")));

        VoicePartialResponse out = assistantService.handleVoicePartial("u1", "play ani", null);

        assertThat(out.getActionsPreview())
                .extracting(c -> c.getAction())
                .containsExactly(AssistantAction.SEARCH_ARTIST);
        // Superseded/no-side-effect: read-only path never dispatches, queues,
        // likes, or pushes realtime events.
        verifyNoInteractions(dispatcher);
        verify(searchService).searchSongsForVoice("ani", "u1");
    }

    @Test
    void qwenTimeout_returnsClarificationPreview_withTranscriptAsQuery_noDispatch() {
        when(qwenClient.understandVoicePartialText(anyString(), any()))
                .thenReturn(Optional.empty());
        when(searchService.searchSongsForVoice(eq("play anv"), eq("u1")))
                .thenReturn(List.of(song("s1"), song("s2")));

        VoicePartialResponse out = assistantService.handleVoicePartial("u1", "play anv", null);

        assertThat(out.isClarificationNeeded()).isTrue();
        assertThat(out.getActionsPreview()).isEmpty();
        assertThat(out.getSearchQuery()).isEqualTo("play anv");
        assertThat(out.getSuggestions()).contains("play anv");
        assertThat(out.getSongs()).hasSize(2);
        verifyNoInteractions(dispatcher);
    }

    @Test
    void searchFailure_degradesToEmptySongs_notThrow() {
        when(qwenClient.understandVoicePartialText(anyString(), any()))
                .thenReturn(Optional.of(partialResp(
                        List.of(cmd(AssistantAction.SEARCH_SONG)), "hello", List.of("s"))));
        when(searchService.searchSongsForVoice(anyString(), anyString()))
                .thenThrow(new RuntimeException("db down"));

        VoicePartialResponse out = assistantService.handleVoicePartial("u1", "hello", null);

        assertThat(out.getSongs()).isEmpty();
        assertThat(out.getTranscript()).isEqualTo("hello");
        verifyNoInteractions(dispatcher);
    }

    @Test
    void top5_comesFromSearchService_neverMoreThanVoiceLimit() {
        // Service passes through the voice search (SearchService caps at 5 via
        // page 0 size 5); assert lookup uses the searchQuery and stays small.
        when(qwenClient.understandVoicePartialText(eq("ani"), any()))
                .thenReturn(Optional.of(partialResp(
                        List.of(cmd(AssistantAction.SEARCH_ARTIST)), "ani", List.of("s"))));
        List<SongResponse> five = List.of(song("s1"), song("s2"), song("s3"), song("s4"), song("s5"));
        when(searchService.searchSongsForVoice(eq("ani"), eq("u1"))).thenReturn(five);

        VoicePartialResponse out = assistantService.handleVoicePartial("u1", "ani", null);

        assertThat(out.getSongs()).hasSizeLessThanOrEqualTo(5);
        verify(searchService).searchSongsForVoice("ani", "u1");
        verifyNoInteractions(dispatcher);
    }

    @Test
    void contextPassedThrough_andNullContextOk() {
        AssistantContext ctx = AssistantContext.builder().lastMood("CALM").playing(true).build();
        when(qwenClient.understandVoicePartialText(eq("ani"), eq(ctx)))
                .thenReturn(Optional.of(partialResp(List.of(), "ani", List.of("s"))));
        when(searchService.searchSongsForVoice(anyString(), anyString())).thenReturn(List.of());

        VoicePartialResponse out = assistantService.handleVoicePartial("u1", "ani", ctx);

        assertThat(out.isClarificationNeeded()).isTrue();
        verify(qwenClient).understandVoicePartialText("ani", ctx);
        verifyNoInteractions(dispatcher);
    }
}
