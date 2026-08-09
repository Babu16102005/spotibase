package com.spotibase.service;

import com.spotibase.dto.request.UpdateSettingsRequest;
import com.spotibase.dto.response.UserSettingsResponse;
import com.spotibase.entity.User;
import com.spotibase.entity.UserSetting;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.UserRepository;
import com.spotibase.repository.UserSettingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link SettingsService}.
 */
@ExtendWith(MockitoExtension.class)
class SettingsServiceTest {

    @Mock
    private UserSettingRepository userSettingRepository;
    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private SettingsService settingsService;

    private User user;
    private UserSetting settings;

    @BeforeEach
    void setUp() {
        user = User.builder().id("user-1").email("a@example.com").username("alice").build();
        settings = UserSetting.builder()
                .id("s-1")
                .user(user)
                .streamingQuality("HIGH")
                .theme("DARK")
                .build();
    }

    // ---------- get ----------

    @Test
    void getSettings_existingSettings_returnsResponse() {
        when(userSettingRepository.findByUserId("user-1")).thenReturn(Optional.of(settings));

        UserSettingsResponse response = settingsService.getSettings("user-1");

        assertThat(response.getStreamingQuality()).isEqualTo("HIGH");
        assertThat(response.getTheme()).isEqualTo("DARK");
        assertThat(response.isGaplessEnabled()).isTrue(); // builder default
    }

    @Test
    void getSettings_missingSettings_createsDefaultsForExistingUser() {
        when(userSettingRepository.findByUserId("user-1")).thenReturn(Optional.empty());
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userSettingRepository.save(any(UserSetting.class))).thenAnswer(inv -> inv.getArgument(0));

        UserSettingsResponse response = settingsService.getSettings("user-1");

        assertThat(response.getStreamingQuality()).isEqualTo("HIGH");
        assertThat(response.getTheme()).isEqualTo("DARK");
        verify(userSettingRepository).save(argThat(s -> s.getUser().getId().equals("user-1")));
    }

    @Test
    void getSettings_missingSettingsAndUser_throwsResourceNotFoundException() {
        when(userSettingRepository.findByUserId("ghost")).thenReturn(Optional.empty());
        when(userRepository.findById("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> settingsService.getSettings("ghost"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("User");
    }

    // ---------- update ----------

    @Test
    void updateSettings_appliesOnlyNonNullFields() {
        when(userSettingRepository.findByUserId("user-1")).thenReturn(Optional.of(settings));
        when(userSettingRepository.save(any(UserSetting.class))).thenAnswer(inv -> inv.getArgument(0));

        UpdateSettingsRequest request = UpdateSettingsRequest.builder()
                .streamingQuality("LOSSLESS")
                .theme("AMOLED")
                .crossfadeDuration(5)
                .build();

        UserSettingsResponse response = settingsService.updateSettings("user-1", request);

        assertThat(response.getStreamingQuality()).isEqualTo("LOSSLESS");
        assertThat(response.getTheme()).isEqualTo("AMOLED");
        assertThat(response.getCrossfadeDuration()).isEqualTo(5);
        // untouched field keeps its previous value
        assertThat(response.getLanguage()).isEqualTo("en");
        verify(userSettingRepository).save(settings);
    }

    @Test
    void updateSettings_emptyRequest_persistsUnchangedSettings() {
        when(userSettingRepository.findByUserId("user-1")).thenReturn(Optional.of(settings));
        when(userSettingRepository.save(any(UserSetting.class))).thenAnswer(inv -> inv.getArgument(0));

        UpdateSettingsRequest request = UpdateSettingsRequest.builder().build();

        UserSettingsResponse response = settingsService.updateSettings("user-1", request);

        assertThat(response.getStreamingQuality()).isEqualTo("HIGH");
        verify(userSettingRepository).save(settings);
    }

    @Test
    void updateSettings_missingSettings_createsThenUpdates() {
        when(userSettingRepository.findByUserId("user-1")).thenReturn(Optional.empty());
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userSettingRepository.save(any(UserSetting.class))).thenAnswer(inv -> inv.getArgument(0));

        UpdateSettingsRequest request = UpdateSettingsRequest.builder().theme("LIGHT").build();

        UserSettingsResponse response = settingsService.updateSettings("user-1", request);

        assertThat(response.getTheme()).isEqualTo("LIGHT");
        verify(userSettingRepository, times(2)).save(any(UserSetting.class)); // create + update
    }

    // ---------- theme ----------

    @Test
    void updateTheme_setsThemeAndSaves() {
        when(userSettingRepository.findByUserId("user-1")).thenReturn(Optional.of(settings));
        when(userSettingRepository.save(any(UserSetting.class))).thenAnswer(inv -> inv.getArgument(0));

        UserSettingsResponse response = settingsService.updateTheme("user-1", "LIGHT");

        assertThat(response.getTheme()).isEqualTo("LIGHT");
        verify(userSettingRepository).save(settings);
    }
}
