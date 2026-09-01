package com.spotibase.ai.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AssistantResponse {
    private String transcript;
    private List<AssistantCommand> actions;
    private String response;
    private List<Map<String, Object>> results;
    private boolean clarificationNeeded;
    private String clarificationQuestion;
}
