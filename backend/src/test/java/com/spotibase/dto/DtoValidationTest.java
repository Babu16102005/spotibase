package com.spotibase.dto;

import com.spotibase.dto.request.CreatePlaylistRequest;
import com.spotibase.dto.request.CreateSongRequest;
import com.spotibase.dto.request.LoginRequest;
import com.spotibase.dto.request.RegisterRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Jakarta Bean Validation tests for request DTOs.
 */
class DtoValidationTest {

    private static ValidatorFactory validatorFactory;
    private static Validator validator;

    @BeforeAll
    static void setUp() {
        validatorFactory = Validation.buildDefaultValidatorFactory();
        validator = validatorFactory.getValidator();
    }

    @AfterAll
    static void tearDown() {
        validatorFactory.close();
    }

    private Set<String> violationMessages(Object dto) {
        return validator.validate(dto).stream()
                .map(ConstraintViolation::getMessage)
                .collect(Collectors.toSet());
    }

    // ---------- RegisterRequest ----------

    @Test
    void registerRequest_validInput_passes() {
        RegisterRequest request = RegisterRequest.builder()
                .email("alice@example.com")
                .username("alice")
                .password("password123")
                .build();

        assertThat(validator.validate(request)).isEmpty();
    }

    @Test
    void registerRequest_blankFields_areRejected() {
        RegisterRequest request = RegisterRequest.builder()
                .email("")
                .username("  ")
                .password(null)
                .build();

        Set<String> messages = violationMessages(request);

        assertThat(messages)
                .contains("Email is required", "Username is required", "Password is required");
    }

    @Test
    void registerRequest_invalidEmailFormat_isRejected() {
        RegisterRequest request = RegisterRequest.builder()
                .email("not-an-email")
                .username("alice")
                .password("password123")
                .build();

        assertThat(violationMessages(request)).contains("Invalid email format");
    }

    @Test
    void registerRequest_shortUsernameAndPassword_areRejected() {
        RegisterRequest request = RegisterRequest.builder()
                .email("alice@example.com")
                .username("ab")
                .password("short")
                .build();

        Set<String> messages = violationMessages(request);

        assertThat(messages)
                .contains("Username must be between 3 and 50 characters")
                .contains("Password must be between 8 and 100 characters");
    }

    @Test
    void registerRequest_optionalFields_areAllowed() {
        RegisterRequest request = RegisterRequest.builder()
                .email("alice@example.com")
                .username("alice")
                .password("password123")
                .authProvider("GOOGLE")
                .idToken("token")
                .build();

        assertThat(validator.validate(request)).isEmpty();
    }

    // ---------- LoginRequest ----------

    @Test
    void loginRequest_validInput_passes() {
        LoginRequest request = LoginRequest.builder()
                .email("alice@example.com")
                .password("password123")
                .build();

        assertThat(validator.validate(request)).isEmpty();
    }

    @Test
    void loginRequest_blankFields_areRejected() {
        LoginRequest request = LoginRequest.builder().build();

        Set<String> messages = violationMessages(request);

        assertThat(messages).contains("Email is required", "Password is required");
    }

    // ---------- CreatePlaylistRequest ----------

    @Test
    void createPlaylistRequest_validName_passes() {
        CreatePlaylistRequest request = CreatePlaylistRequest.builder().name("Road Trip").build();

        assertThat(validator.validate(request)).isEmpty();
    }

    @Test
    void createPlaylistRequest_blankName_isRejected() {
        CreatePlaylistRequest request = CreatePlaylistRequest.builder().build();

        assertThat(violationMessages(request)).contains("Playlist name is required");
    }

    @Test
    void createPlaylistRequest_defaults_arePublicNonCollaborative() {
        CreatePlaylistRequest request = CreatePlaylistRequest.builder().name("X").build();

        assertThat(request.isPublic()).isTrue();
        assertThat(request.isCollaborative()).isFalse();
    }

    // ---------- CreateSongRequest ----------

    @Test
    void createSongRequest_validInput_passes() {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("Song")
                .artistId("artist-1")
                .releaseDate(LocalDate.of(2025, 1, 1))
                .build();

        assertThat(validator.validate(request)).isEmpty();
    }

    @Test
    void createSongRequest_missingTitleAndReleaseDate_areRejected() {
        CreateSongRequest request = CreateSongRequest.builder()
                .build();

        Set<String> messages = violationMessages(request);

        assertThat(messages)
                .contains("Song title is required", "Release date is required");
    }

    @Test
    void createSongRequest_missingReleaseDate_isRejected() {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("Song")
                .artistId("artist-1")
                .build();

        assertThat(violationMessages(request)).contains("Release date is required");
    }
}
