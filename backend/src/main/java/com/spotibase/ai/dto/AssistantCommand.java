package com.spotibase.ai.dto;

import com.spotibase.ai.AssistantAction;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AssistantCommand {
    private AssistantAction action;
    private Map<String, Object> parameters;
}
