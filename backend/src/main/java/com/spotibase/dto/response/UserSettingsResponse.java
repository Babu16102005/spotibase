package com.spotibase.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserSettingsResponse {
    private String streamingQuality;
    private String downloadQuality;
    private int crossfadeDuration;
    private boolean gaplessEnabled;
    private boolean normalizeVolume;
    private boolean explicitFilter;
    private boolean monoAudio;
    private int bassBoost;
    private int treble;
    private String theme;
    private String language;
    private boolean wifiOnlyDownload;
    private boolean smartDownloads;
    private boolean autoPlay;
    private int sleepTimerMinutes;
}
