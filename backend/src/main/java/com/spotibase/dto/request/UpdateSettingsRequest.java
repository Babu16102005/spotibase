package com.spotibase.dto.request;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UpdateSettingsRequest {
    private String streamingQuality;
    private String downloadQuality;
    private Integer crossfadeDuration;
    private Boolean gaplessEnabled;
    private Boolean normalizeVolume;
    private Boolean explicitFilter;
    private Boolean monoAudio;
    private Integer bassBoost;
    private Integer treble;
    private String theme;
    private String language;
    private Boolean wifiOnlyDownload;
    private Boolean smartDownloads;
    private Boolean autoPlay;
    private Integer sleepTimerMinutes;
}
