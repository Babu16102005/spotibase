package com.spotibase.exception;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link GlobalExceptionHandler}: every exception type maps to the
 * expected HTTP status and an {@link ErrorResponse} body with consistent shape.
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    private void assertBodyShape(ResponseEntity<ErrorResponse> response, HttpStatus status, String message) {
        assertThat(response.getStatusCode()).isEqualTo(status);
        ErrorResponse body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.getStatus()).isEqualTo(status.value());
        assertThat(body.getError()).isEqualTo(status.getReasonPhrase());
        assertThat(body.getMessage()).isEqualTo(message);
        assertThat(body.getTimestamp()).isNotNull();
        assertThat(body.getPath()).isNull();
        assertThat(body.getValidationErrors()).isNull();
    }

    @Test
    void resourceNotFound_mapsTo404() {
        ResponseEntity<ErrorResponse> response =
                handler.handleResourceNotFound(new ResourceNotFoundException("Song", "abc"));

        assertBodyShape(response, HttpStatus.NOT_FOUND, "Song not found with id: abc");
    }

    @Test
    void resourceNotFound_singleMessageConstructor_usesMessage() {
        ResponseEntity<ErrorResponse> response =
                handler.handleResourceNotFound(new ResourceNotFoundException("Song not found in playlist"));

        assertBodyShape(response, HttpStatus.NOT_FOUND, "Song not found in playlist");
    }

    @Test
    void badRequest_mapsTo400() {
        ResponseEntity<ErrorResponse> response =
                handler.handleBadRequest(new BadRequestException("One or more songs not found"));

        assertBodyShape(response, HttpStatus.BAD_REQUEST, "One or more songs not found");
    }

    @Test
    void unauthorized_mapsTo401() {
        ResponseEntity<ErrorResponse> response =
                handler.handleUnauthorized(new UnauthorizedException("Invalid email or password"));

        assertBodyShape(response, HttpStatus.UNAUTHORIZED, "Invalid email or password");
    }

    @Test
    void accessDenied_mapsTo403WithGenericMessage() {
        ResponseEntity<ErrorResponse> response =
                handler.handleAccessDenied(new AccessDeniedException("nope"));

        assertBodyShape(response, HttpStatus.FORBIDDEN, "Access denied");
    }

    @Test
    void badCredentials_mapsTo401WithGenericMessage() {
        ResponseEntity<ErrorResponse> response =
                handler.handleBadCredentials(new BadCredentialsException("bad creds"));

        assertBodyShape(response, HttpStatus.UNAUTHORIZED, "Invalid credentials");
    }

    @Test
    void duplicateResource_mapsTo409() {
        ResponseEntity<ErrorResponse> response =
                handler.handleDuplicate(new DuplicateResourceException("Email already registered"));

        assertBodyShape(response, HttpStatus.CONFLICT, "Email already registered");
    }

    @Test
    void maxUploadSizeExceeded_mapsTo413() {
        ResponseEntity<ErrorResponse> response =
                handler.handleMaxUpload(new MaxUploadSizeExceededException(1024L));

        assertBodyShape(response, HttpStatus.PAYLOAD_TOO_LARGE, "File size exceeds maximum limit");
    }

    @Test
    void validationError_mapsTo400WithFieldErrors() {
        MethodArgumentNotValidException ex = mock(MethodArgumentNotValidException.class);
        BindingResult bindingResult = new BeanPropertyBindingResult(new Object(), "request");
        bindingResult.addError(new FieldError("request", "email", "Email is required"));
        bindingResult.addError(new FieldError("request", "password", "Password is required"));
        when(ex.getBindingResult()).thenReturn(bindingResult);

        ResponseEntity<ErrorResponse> response = handler.handleValidation(ex);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        ErrorResponse body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.getStatus()).isEqualTo(400);
        assertThat(body.getError()).isEqualTo("Bad Request");
        assertThat(body.getMessage()).isEqualTo("Invalid input parameters");
        assertThat(body.getValidationErrors())
                .containsEntry("email", "Email is required")
                .containsEntry("password", "Password is required");
    }

    @Test
    void validationError_emptyErrors_stillReturns400() {
        MethodArgumentNotValidException ex = mock(MethodArgumentNotValidException.class);
        BindingResult bindingResult = new BeanPropertyBindingResult(new Object(), "request");
        when(ex.getBindingResult()).thenReturn(bindingResult);

        ResponseEntity<ErrorResponse> response = handler.handleValidation(ex);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody().getValidationErrors()).isEmpty();
    }

    @Test
    void generalException_mapsTo500WithGenericMessage() {
        org.springframework.mock.web.MockHttpServletResponse servletResponse =
                new org.springframework.mock.web.MockHttpServletResponse();
        ResponseEntity<ErrorResponse> response =
                handler.handleGeneral(new IllegalStateException("boom"), servletResponse);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(servletResponse.getContentType()).isEqualTo("application/json");
        assertBodyShape(response, HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred");
    }
}
