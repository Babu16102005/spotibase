package com.spotibase.ai.service;

import com.spotibase.ai.AssistantAction;
import com.spotibase.ai.dto.AssistantCommand;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.regex.Pattern;

@Component
public class SimpleCommandDetector {

    private static final List<PatternAction> PATTERNS = List.of(
        new PatternAction(Pattern.compile("^\\s*(next|skip|next\\s+song)\\s*$", Pattern.CASE_INSENSITIVE), AssistantAction.NEXT),
        new PatternAction(Pattern.compile("^\\s*(pause|pause\\s+the\\s+song|pause\\s+music)\\s*$", Pattern.CASE_INSENSITIVE), AssistantAction.PAUSE),
        new PatternAction(Pattern.compile("^\\s*(resume|continue|play|resume\\s+the\\s+song)\\s*$", Pattern.CASE_INSENSITIVE), AssistantAction.RESUME),
        new PatternAction(Pattern.compile("^\\s*(previous|prev|go\\s+back|previous\\s+song)\\s*$", Pattern.CASE_INSENSITIVE), AssistantAction.PREVIOUS),
        new PatternAction(Pattern.compile("^\\s*like\\s*(this|song)?\\s*$", Pattern.CASE_INSENSITIVE), AssistantAction.LIKE_CURRENT),
        new PatternAction(Pattern.compile("^\\s*unlike.*$", Pattern.CASE_INSENSITIVE), AssistantAction.UNLIKE_CURRENT),
        new PatternAction(Pattern.compile(".*shuffle\\s+on.*", Pattern.CASE_INSENSITIVE), AssistantAction.SHUFFLE_ON),
        new PatternAction(Pattern.compile(".*shuffle\\s+off.*", Pattern.CASE_INSENSITIVE), AssistantAction.SHUFFLE_OFF)
    );

    private record PatternAction(Pattern pattern, AssistantAction action) {}

    /**
     * If text is a simple command, return single command. Else null -> needs LLM.
     */
    public Optional<AssistantCommand> detect(String text) {
        if (text == null) return Optional.empty();
        String t = text.trim();
        for (PatternAction pa : PATTERNS) {
            if (pa.pattern.matcher(t).matches()) {
                return Optional.of(AssistantCommand.builder()
                        .action(pa.action)
                        .parameters(Map.of())
                        .build());
            }
        }
        return Optional.empty();
    }
}
