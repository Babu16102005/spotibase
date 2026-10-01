package com.spotibase.exception;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleResourceNotFound(ResourceNotFoundException ex) {
        return buildErrorResponse(HttpStatus.NOT_FOUND, ex.getMessage());
    }

    @ExceptionHandler(BadRequestException.class)
    public ResponseEntity<ErrorResponse> handleBadRequest(BadRequestException ex) {
        return buildErrorResponse(HttpStatus.BAD_REQUEST, ex.getMessage());
    }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<ErrorResponse> handleUnauthorized(UnauthorizedException ex) {
        return buildErrorResponse(HttpStatus.UNAUTHORIZED, ex.getMessage());
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ErrorResponse> handleAccessDenied(AccessDeniedException ex) {
        return buildErrorResponse(HttpStatus.FORBIDDEN, "Access denied");
    }

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ErrorResponse> handleBadCredentials(BadCredentialsException ex) {
        return buildErrorResponse(HttpStatus.UNAUTHORIZED, "Invalid credentials");
    }

    @ExceptionHandler(DuplicateResourceException.class)
    public ResponseEntity<ErrorResponse> handleDuplicate(DuplicateResourceException ex) {
        return buildErrorResponse(HttpStatus.CONFLICT, ex.getMessage());
    }

    @ExceptionHandler(R2UpstreamException.class)
    public ResponseEntity<ErrorResponse> handleR2Upstream(R2UpstreamException ex) {
        log.error("R2 upstream failure: {}", ex.getMessage());
        return buildErrorResponse(HttpStatus.BAD_GATEWAY, "Audio storage temporarily unavailable");
    }

    @ExceptionHandler(YoutubeQuotaExceededException.class)
    public ResponseEntity<ErrorResponse> handleYoutubeQuota(YoutubeQuotaExceededException ex) {
        // Fail-closed safety net: YoutubeService normally fails open to mock
        // data, so this only fires if quota escapes the service layer.
        log.warn("YouTube quota exceeded: {}", ex.getMessage());
        return buildErrorResponse(HttpStatus.SERVICE_UNAVAILABLE, "YouTube quota exceeded, retry later");
    }

    @ExceptionHandler(YoutubeUpstreamException.class)
    public ResponseEntity<ErrorResponse> handleYoutubeUpstream(YoutubeUpstreamException ex) {
        // Fail-closed safety net: YoutubeService normally fails open to mock
        // data, so this only fires if an upstream 400 escapes the service layer.
        log.warn("YouTube upstream failure: {}", ex.getMessage());
        return buildErrorResponse(HttpStatus.BAD_GATEWAY, "YouTube service temporarily unavailable");
    }

    @ExceptionHandler(InvalidRangeException.class)
    public ResponseEntity<ErrorResponse> handleInvalidRange(InvalidRangeException ex) {
        // Safety net: the stream path answers 416 directly with a Content-Range
        // header; this covers any other caller that surfaces a bad range.
        ResponseEntity.BodyBuilder builder =
                ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                        .header("Accept-Ranges", "bytes");
        if (ex.getObjectSize() >= 0) {
            builder.header("Content-Range", "bytes */" + ex.getObjectSize());
        }
        ErrorResponse response = ErrorResponse.builder()
                .timestamp(LocalDateTime.now())
                .status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE.value())
                .error(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE.getReasonPhrase())
                .message(ex.getMessage() != null ? ex.getMessage() : "Requested range not satisfiable")
                .build();
        return builder.body(response);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ErrorResponse> handleMaxUpload(MaxUploadSizeExceededException ex) {
        return buildErrorResponse(HttpStatus.PAYLOAD_TOO_LARGE, "File size exceeds maximum limit");
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    public ResponseEntity<ErrorResponse> handleMissingPart(MissingServletRequestPartException ex) {
        // NOTE: /ai/voice overrides this locally in AssistantController with a 200
        // AssistantResponse ("Voice processing failed: Missing audio file ...") so the
        // mobile client never sees this generic shape. This handler covers non-voice uploads.
        String part = ex.getRequestPartName() != null ? ex.getRequestPartName() : "file";
        return buildErrorResponse(HttpStatus.BAD_REQUEST,
                "Required file part '" + part + "' is not present");
    }

    @ExceptionHandler(MultipartException.class)
    public ResponseEntity<ErrorResponse> handleMultipart(MultipartException ex) {
        // NOTE: /ai/voice overrides this locally with a 200 voice shape. This covers other uploads.
        // MaxUploadSizeExceededException (a MultipartException subtype) still routes to handleMaxUpload.
        log.warn("Multipart failure: {}", ex.getMessage());
        return buildErrorResponse(HttpStatus.BAD_REQUEST, "Invalid multipart request");
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex) {
        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getAllErrors().forEach(error -> {
            String fieldName;
            String errorMessage = error.getDefaultMessage();
            if (error instanceof FieldError fieldError) {
                fieldName = fieldError.getField();
            } else {
                fieldName = error.getObjectName() != null ? error.getObjectName() : "request";
            }
            errors.put(fieldName, errorMessage);
        });
        ErrorResponse response = ErrorResponse.builder()
                .timestamp(LocalDateTime.now())
                .status(HttpStatus.BAD_REQUEST.value())
                .error(HttpStatus.BAD_REQUEST.getReasonPhrase())
                .message("Invalid input parameters")
                .validationErrors(errors)
                .build();
        return ResponseEntity.badRequest().body(response);
    }

    @ExceptionHandler(org.springframework.web.bind.MissingServletRequestParameterException.class)
    public ResponseEntity<ErrorResponse> handleMissingParam(
            org.springframework.web.bind.MissingServletRequestParameterException ex) {
        return buildErrorResponse(HttpStatus.BAD_REQUEST,
                "Required request parameter '" + ex.getParameterName() + "' is not present");
    }

    @ExceptionHandler(org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleTypeMismatch(
            org.springframework.web.method.annotation.MethodArgumentTypeMismatchException ex) {
        String name = ex.getName() != null ? ex.getName() : "parameter";
        return buildErrorResponse(HttpStatus.BAD_REQUEST,
                "Query parameter '" + name + "' has an invalid type");
    }

    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleNotReadable(
            org.springframework.http.converter.HttpMessageNotReadableException ex) {
        return buildErrorResponse(HttpStatus.BAD_REQUEST, "Malformed request body");
    }

    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMethodNotSupported(
            org.springframework.web.HttpRequestMethodNotSupportedException ex) {
        return buildErrorResponse(HttpStatus.METHOD_NOT_ALLOWED,
                ex.getMessage() != null ? ex.getMessage() : "Method not allowed");
    }

    @ExceptionHandler(org.springframework.web.HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<?> handleMediaTypeNotSupported(
            org.springframework.web.HttpMediaTypeNotSupportedException ex,
            jakarta.servlet.http.HttpServletRequest request) {
        // P0-415: HttpMediaTypeNotSupported is thrown during handler-mapping
        // lookup (no consumes match), so controller-local handlers do NOT apply
        // when Handler is null. Handle it globally with voice-aware scope:
        // exact /api/v1/ai/voice (startsWith) => 200 voice clarification shape
        // (never 415/500); /ai/text and others => 415 ErrorResponse.
        String uri = request != null ? request.getRequestURI() : "";
        String ct = request != null ? request.getContentType() : "";
        if (uri != null && uri.startsWith("/api/v1/ai/voice-partial")) {
            // Realtime-partial keeps its own preview contract even here:
            // 200 VoicePartialResponse (actions_preview/suggestions/songs[]),
            // never the /voice AssistantResponse shape.
            String received = ct != null && !ct.isBlank() ? ct.split(";")[0].trim() : "unknown";
            log.warn("AI voice-partial unsupported media type (global) uri={} contentType={}: {}", uri, ct, ex.getMessage());
            com.spotibase.ai.dto.VoicePartialResponse partialBody =
                    com.spotibase.ai.dto.VoicePartialResponse.builder()
                            .transcript("")
                            .actionsPreview(java.util.List.of())
                            .suggestions(java.util.List.of(
                                    "Play calm Tamil songs", "Play Anirudh hits", "Play 90s melodies"))
                            .songs(java.util.List.of())
                            .searchQuery("")
                            .displayText("Voice preview failed: Unsupported media type '"
                                    + received + "' (use application/json)")
                            .clarificationNeeded(true)
                            .clarificationQuestion("Voice preview failed: Unsupported media type '"
                                    + received + "' (use application/json)")
                            .build();
            return ResponseEntity.ok(partialBody);
        }
        if (uri != null && uri.startsWith("/api/v1/ai/voice")) {
            String received = ct != null && !ct.isBlank() ? ct.split(";")[0].trim() : "unknown";
            log.warn("AI voice unsupported media type (global) uri={} contentType={}: {}", uri, ct, ex.getMessage());
            com.spotibase.ai.dto.AssistantResponse voiceBody =
                    com.spotibase.ai.dto.AssistantResponse.builder()
                            .transcript("")
                            .actions(java.util.List.of())
                            .clarificationNeeded(true)
                            .clarificationQuestion("Voice processing failed: Unsupported media type '"
                                    + received + "' (use multipart audio or application/json)")
                            .build();
            return ResponseEntity.ok(voiceBody);
        }
        log.warn("Unsupported media type uri={} contentType={}: {}", uri, ct, ex.getMessage());
        return buildErrorResponse(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                ex.getMessage() != null ? ex.getMessage() : "Unsupported media type");
    }

    @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handleNoResourceFound(
            org.springframework.web.servlet.resource.NoResourceFoundException ex) {
        return buildErrorResponse(HttpStatus.NOT_FOUND, ex.getMessage());
    }

    @ExceptionHandler({org.apache.catalina.connector.ClientAbortException.class,
            org.springframework.web.context.request.async.AsyncRequestNotUsableException.class})
    public void handleClientAbort(Exception ex) {
        log.debug("Client aborted connection: {}", ex.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGeneral(Exception ex, jakarta.servlet.http.HttpServletResponse response) {
        // Full stack stays server-side; client gets a generic message (never leak internals).
        // NOTE: /ai/voice never reaches here for expected failures — AssistantController
        // answers 200 with clarificationQuestion "Voice processing failed: <specific>" via its
        // in-method catch plus local handlers (MissingPart / MaxUpload / Multipart).
        log.error("Unexpected error: ", ex);
        response.setContentType("application/json");
        return buildErrorResponse(HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred");
    }

    private ResponseEntity<ErrorResponse> buildErrorResponse(HttpStatus status, String message) {
        ErrorResponse response = ErrorResponse.builder()
                .timestamp(LocalDateTime.now())
                .status(status.value())
                .error(status.getReasonPhrase())
                .message(message)
                .build();
        return ResponseEntity.status(status).body(response);
    }
}
