package com.spotibase.service;

import com.spotibase.dto.request.UpdateSettingsRequest;
import com.spotibase.dto.response.UserSettingsResponse;
import com.spotibase.entity.User;
import com.spotibase.entity.UserSetting;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.UserRepository;
import com.spotibase.repository.UserSettingRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class SettingsService {

    private final UserSettingRepository userSettingRepository;
    private final UserRepository userRepository;

    public UserSettingsResponse getSettings(String userId) {
        UserSetting settings = userSettingRepository.findByUserId(userId)
                .orElseGet(() -> createDefaultSettings(userId));
        return toSettingsResponse(settings);
    }

    @Transactional
    public UserSettingsResponse updateSettings(String userId, UpdateSettingsRequest request) {
        UserSetting settings = userSettingRepository.findByUserId(userId)
                .orElseGet(() -> createDefaultSettings(userId));

        if (request.getStreamingQuality() != null)
            settings.setStreamingQuality(request.getStreamingQuality());
        if (request.getDownloadQuality() != null)
            settings.setDownloadQuality(request.getDownloadQuality());
        if (request.getCrossfadeDuration() != null)
            settings.setCrossfadeDuration(request.getCrossfadeDuration());
        if (request.getGaplessEnabled() != null)
            settings.setGaplessEnabled(request.getGaplessEnabled());
        if (request.getNormalizeVolume() != null)
            settings.setNormalizeVolume(request.getNormalizeVolume());
        if (request.getExplicitFilter() != null)
            settings.setExplicitFilter(request.getExplicitFilter());
        if (request.getMonoAudio() != null)
            settings.setMonoAudio(request.getMonoAudio());
        if (request.getBassBoost() != null)
            settings.setBassBoost(request.getBassBoost());
        if (request.getTreble() != null)
            settings.setTreble(request.getTreble());
        if (request.getTheme() != null)
            settings.setTheme(request.getTheme());
        if (request.getLanguage() != null)
            settings.setLanguage(request.getLanguage());
        if (request.getWifiOnlyDownload() != null)
            settings.setWifiOnlyDownload(request.getWifiOnlyDownload());
        if (request.getSmartDownloads() != null)
            settings.setSmartDownloads(request.getSmartDownloads());
        if (request.getAutoPlay() != null)
            settings.setAutoPlay(request.getAutoPlay());
        if (request.getSleepTimerMinutes() != null)
            settings.setSleepTimerMinutes(request.getSleepTimerMinutes());

        userSettingRepository.save(settings);
        log.info("Settings updated for user: {}", userId);
        return toSettingsResponse(settings);
    }

    @Transactional
    public UserSettingsResponse updateTheme(String userId, String theme) {
        UserSetting settings = userSettingRepository.findByUserId(userId)
                .orElseGet(() -> createDefaultSettings(userId));
        settings.setTheme(theme);
        userSettingRepository.save(settings);
        return toSettingsResponse(settings);
    }

    private UserSetting createDefaultSettings(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        UserSetting settings = UserSetting.builder()
                .user(user)
                .build();
        return userSettingRepository.save(settings);
    }

    private UserSettingsResponse toSettingsResponse(UserSetting settings) {
        return UserSettingsResponse.builder()
                .streamingQuality(settings.getStreamingQuality())
                .downloadQuality(settings.getDownloadQuality())
                .crossfadeDuration(settings.getCrossfadeDuration())
                .gaplessEnabled(settings.isGaplessEnabled())
                .normalizeVolume(settings.isNormalizeVolume())
                .explicitFilter(settings.isExplicitFilter())
                .monoAudio(settings.isMonoAudio())
                .bassBoost(settings.getBassBoost())
                .treble(settings.getTreble())
                .theme(settings.getTheme())
                .language(settings.getLanguage())
                .wifiOnlyDownload(settings.isWifiOnlyDownload())
                .smartDownloads(settings.isSmartDownloads())
                .autoPlay(settings.isAutoPlay())
                .sleepTimerMinutes(settings.getSleepTimerMinutes())
                .build();
    }
}
