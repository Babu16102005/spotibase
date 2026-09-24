package com.spotibase.ai.controller;

import com.spotibase.ai.dto.AssistantContext;
import com.spotibase.ai.dto.AssistantRequest;
import com.spotibase.ai.dto.AssistantResponse;
import com.spotibase.ai.dto.VoiceJsonRequest;
import com.spotibase.ai.dto.VoicePartialRequest;
import com.spotibase.ai.dto.VoicePartialResponse;
import com.spotibase.ai.service.AssistantService;
import com.spotibase.exception.ErrorResponse;
import com.spotibase.security.CurrentUser;
import com.spotibase.security.CustomUserDetails;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

@RestController
@RequestMapping("/api/v1/ai")
@RequiredArgsConstructor
@Slf4j
public class AssistantController {

    private final AssistantService assistantService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final long MAX_VOICE_BYTES = 15L * 1024 * 1024;

    /**
     * P0: voice-only URI scope. Local voice handlers (415 override + generic
     * catch-all + multipart guards) must ONLY apply to the exact voice path.
     * Used with {@code startsWith} so {@code /api/v1/ai/voice} and its
     * sub-paths match, while {@code /api/v1/ai/text} and {@code /ai/health}
     * never do. Never use {@code contains("/ai/")} here — that misroutes
     * {@code /ai/text} multipart/validation failures to the voice 200 shape.
     */
    private static final String VOICE_PATH = "/api/v1/ai/voice";

    private static boolean isVoiceUri(String uri) {
        return uri != null && uri.startsWith(VOICE_PATH);
    }

    private static final String VOICE_PARTIAL_PATH = "/api/v1/ai/voice-partial";

    private static boolean isVoicePartialUri(String uri) {
        return uri != null && uri.startsWith(VOICE_PARTIAL_PATH);
    }

    private static final java.util.Set<String> ALLOWED_AUDIO_TYPES = java.util.Set.of(
            "audio/m4a", "audio/x-m4a", "audio/mp4", "audio/aac",
            "audio/webm", "audio/ogg", "audio/wav", "audio/x-wav",
            "audio/mpeg", "audio/mp3");

    @PostMapping(value = "/text", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<AssistantResponse> handleText(
            @CurrentUser CustomUserDetails user,
            @Valid @RequestBody AssistantRequest request) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        String userId = user.getId();
        log.info("AI text from {}: {}", userId, request.getText());
        AssistantResponse resp = assistantService.handleText(userId, request.getText(), request.getContext());
        return ResponseEntity.ok(resp);
    }

    @PostMapping(value = "/voice", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<AssistantResponse> handleVoice(
            @CurrentUser CustomUserDetails user,
            @RequestParam("audio") MultipartFile audio,
            @RequestParam(value = "transcript_fallback", required = false) String transcriptFallback,
            @RequestParam(value = "context", required = false) String contextJson,
            @RequestParam(value = "currentSongId", required = false) String currentSongId,
            @RequestParam(value = "currentArtist", required = false) String currentArtist,
            @RequestParam(value = "playing", required = false) Boolean playing) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        String userId = user.getId();
        try {
            if (audio == null || audio.isEmpty()) {
                log.warn("AI voice missing/empty audio user={} fallbackPresent={}",
                        userId, transcriptFallback != null && !transcriptFallback.isBlank());
                return ResponseEntity.ok(voiceFailure(transcriptFallback,
                        "Missing audio file (field 'audio' is required)"));
            }
            // P0: check size BEFORE getBytes() to avoid loading oversized uploads into memory.
            if (audio.getSize() > MAX_VOICE_BYTES) {
                log.warn("AI voice too large user={} size={}", userId, audio.getSize());
                return ResponseEntity.ok(voiceFailure(transcriptFallback,
                        "Audio too large (max 15MB)"));
            }
            if (!isAllowedAudio(audio.getContentType(), audio.getOriginalFilename())) {
                String received = audio.getContentType() != null && !audio.getContentType().isBlank()
                        ? audio.getContentType().split(";")[0].trim()
                        : (audio.getOriginalFilename() != null ? audio.getOriginalFilename() : "unknown");
                log.warn("AI voice unsupported type user={} contentType={} file={}",
                        userId, audio.getContentType(), audio.getOriginalFilename());
                return ResponseEntity.ok(voiceFailure(transcriptFallback,
                        "Unsupported audio type '" + received + "' (use m4a/mp4/aac/webm/ogg/wav/mp3)"));
            }
            byte[] bytes = audio.getBytes();
            String filename = normalizeAudioFilename(audio.getOriginalFilename(), audio.getContentType());
            log.info("AI voice from {} file={} contentType={} size={} fallback='{}' hasContextJson={}",
                    userId, filename, audio.getContentType(), bytes.length, transcriptFallback, contextJson != null);

            if (bytes.length > MAX_VOICE_BYTES) {
                log.warn("AI voice too large after read user={} size={}", userId, bytes.length);
                return ResponseEntity.ok(voiceFailure(transcriptFallback,
                        "Audio too large (max 15MB)"));
            }

            AssistantContext ctx = parseContext(contextJson, currentSongId, currentArtist, playing);

            AssistantResponse resp = assistantService.handleVoice(userId, bytes, filename, transcriptFallback, ctx);
            // Echo transcript_fallback when service left transcript blank (mobile contract)
            if ((resp.getTranscript() == null || resp.getTranscript().isBlank())
                    && transcriptFallback != null && !transcriptFallback.isBlank()) {
                resp.setTranscript(transcriptFallback);
            }
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            // Full stack stays server-side; client gets a sanitized 200 clarification (never 500 generic).
            log.error("AI voice failed user={} fallbackPresent={}", userId,
                    transcriptFallback != null && !transcriptFallback.isBlank(), e);
            return ResponseEntity.ok(voiceFailure(transcriptFallback, sanitizeVoiceError(e)));
        }
    }

    /**
     * JSON fallback overload for {@code POST /ai/voice}.
     *
     * <p>Consumes {@code application/json} (vs the multipart overload above).
     * Used when the client has no audio bytes but does have a
     * {@code transcriptFallback}/{@code transcript_fallback} plus optional
     * {@code context} object and/or flat fields
     * ({@code currentSongId/currentArtist/playing/...}). Flat fields win when present.
     *
     * <p>Contract parity: every failure answers 200 with the same
     * {@code voiceFailure} clarification shape
     * ({@code clarificationQuestion = "Voice processing failed: <specific>"});
     * never 415/500 generic. When a non-blank fallback transcript is present the
     * request is handled via the text path (same as the voice-service fallback).
     */
    @PostMapping(value = "/voice", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<AssistantResponse> handleVoiceJson(
            @CurrentUser CustomUserDetails user,
            @RequestBody(required = false) VoiceJsonRequest body) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        String userId = user.getId();
        try {
            if (body == null) {
                log.warn("AI voice JSON missing body user={}", userId);
                return ResponseEntity.ok(voiceFailure("",
                        "Missing audio file (field 'audio' is required)"));
            }
            String transcriptFallback = body.getTranscriptFallback();
            AssistantContext ctx = mergeJsonContext(body);
            log.info("AI voice JSON from {} fallbackPresent={} hasContext={}",
                    userId, transcriptFallback != null && !transcriptFallback.isBlank(),
                    body.getContext() != null);
            if (transcriptFallback == null || transcriptFallback.isBlank()) {
                return ResponseEntity.ok(voiceFailure(transcriptFallback,
                        "Missing audio file (field 'audio' is required)"));
            }
            AssistantResponse resp = assistantService.handleText(userId, transcriptFallback, ctx);
            // Echo transcript_fallback when service left transcript blank (mobile contract)
            if ((resp.getTranscript() == null || resp.getTranscript().isBlank())
                    && !transcriptFallback.isBlank()) {
                resp.setTranscript(transcriptFallback);
            }
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            String fallback = body != null ? body.getTranscriptFallback() : "";
            log.error("AI voice JSON failed user={} fallbackPresent={}", userId,
                    fallback != null && !fallback.isBlank(), e);
            return ResponseEntity.ok(voiceFailure(fallback, sanitizeVoiceError(e)));
        }
    }

    /**
     * Realtime partial preview for {@code POST /api/v1/ai/voice-partial}.
     *
     * <p>Body: {@code {text, context?}} JSON (device-side partial transcript,
     * no audio bytes). Forwards to FastAPI {@code POST /speech/partial} with
     * the 800ms partial budget, then attaches a read-only top-5
     * {@code songs[]} preview plus fast {@code suggestions}.
     *
     * <p>Read-only by construction: the service layer never dispatches,
     * queues, likes, edits playlists, or pushes realtime events on this path.
     * The full {@code POST /api/v1/ai/voice} (3s) executes the real actions
     * and is unchanged.
     *
     * <p>Contract: every failure (blank text, AI timeout, search error,
     * unexpected exception) answers 200 with {@code clarificationNeeded=true}
     * and a specific {@code clarificationQuestion} — never 400/500 generic.
     * Auth failures stay 401 (null-user path).
     */
    @PostMapping(value = "/voice-partial", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<VoicePartialResponse> handleVoicePartial(
            @CurrentUser CustomUserDetails user,
            @RequestBody(required = false) VoicePartialRequest body) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        String userId = user.getId();
        try {
            if (body == null || body.getText() == null || body.getText().isBlank()) {
                log.info("AI voice-partial blank user={}", userId);
                return ResponseEntity.ok(partialClarification("", "Keep speaking — I didn't catch that yet."));
            }
            String text = body.getText().trim();
            if (text.length() > 2000) {
                text = text.substring(0, 2000);
            }
            log.info("AI voice-partial from {} text='{}'", userId,
                    text.length() > 80 ? text.substring(0, 80) : text);
            VoicePartialResponse resp = assistantService.handleVoicePartial(userId, text, body.getContext());
            return ResponseEntity.ok(resp);
        } catch (Exception e) {
            log.error("AI voice-partial failed user={}", userId, e);
            String transcript = body != null && body.getText() != null ? body.getText() : "";
            return ResponseEntity.ok(partialClarification(transcript, sanitizeVoiceError(e)));
        }
    }

    /**
     * 200-clarification shape for {@code /ai/voice-partial} failures.
     * Mirrors {@link #voiceFailure} but targets the preview contract
     * ({@code actions_preview / suggestions / songs[]}).
     */
    private VoicePartialResponse partialClarification(String transcript, String specific) {
        String detail = (specific != null && !specific.isBlank()) ? specific.trim() : "unknown error";
        return VoicePartialResponse.builder()
                .transcript(transcript != null ? transcript : "")
                .actionsPreview(java.util.List.of())
                .suggestions(java.util.List.of(
                        "Play calm Tamil songs", "Play Anirudh hits", "Play 90s melodies"))
                .songs(java.util.List.of())
                .searchQuery("")
                .displayText("Voice preview failed: " + detail)
                .clarificationNeeded(true)
                .clarificationQuestion("Voice preview failed: " + detail)
                .build();
    }

    /**
     * Voice contract: EVERY /ai/voice failure answers 200 with
     * {@code clarificationQuestion = "Voice processing failed: <specific>"} so the
     * mobile client never sees the generic 500 "An unexpected error occurred".
     * Full stack traces are logged server-side only and never sent to the client.
     */
    private AssistantResponse voiceFailure(String transcriptFallback, String specific) {
        String detail = (specific != null && !specific.isBlank()) ? specific.trim() : "unknown error";
        return AssistantResponse.builder()
                .transcript(transcriptFallback != null ? transcriptFallback : "")
                .actions(java.util.List.of())
                .clarificationNeeded(true)
                .clarificationQuestion("Voice processing failed: " + detail)
                .build();
    }

    /**
     * Strip anything leak-worthy (newlines, control chars, unbounded length) from
     * an exception message before echoing it to the client. Never includes the
     * stack trace — that goes to the server log only.
     */
    private String sanitizeVoiceError(Throwable t) {
        if (t == null) {
            return "unknown error";
        }
        String msg = t.getMessage();
        if (msg == null || msg.isBlank()) {
            Throwable cause = t.getCause();
            while (cause != null && (cause.getMessage() == null || cause.getMessage().isBlank())) {
                cause = cause.getCause();
            }
            msg = cause != null ? cause.getMessage() : null;
        }
        if (msg == null || msg.isBlank()) {
            return "unknown error";
        }
        String singleLine = msg.replaceAll("[\\r\\n\\t\\x00-\\x1F]+", " ").trim();
        if (singleLine.isBlank()) {
            return "unknown error";
        }
        if (singleLine.length() > 200) {
            singleLine = singleLine.substring(0, 200).trim() + "\u2026";
        }
        return singleLine;
    }

    /**
     * Mobile -&gt; Spring contract: clients may send EITHER a JSON {@code context}
     * form field ({@code {"currentSongId":"...","currentArtist":"...","playing":true,...}})
     * OR flat fields (currentSongId/currentArtist/playing). Flat fields win when present.
     */
    private AssistantContext parseContext(String contextJson, String currentSongId,
                                           String currentArtist, Boolean playing) {
        AssistantContext ctx = AssistantContext.builder().build();
        if (contextJson != null && !contextJson.isBlank()) {
            try {
                AssistantContext parsed = objectMapper.readValue(contextJson, AssistantContext.class);
                if (parsed != null) ctx = parsed;
            } catch (Exception e) {
                log.warn("Invalid context JSON, falling back to flat fields: {}", e.getMessage());
            }
        }
        if (currentSongId != null) ctx.setCurrentSongId(currentSongId);
        if (currentArtist != null) ctx.setCurrentArtist(currentArtist);
        if (playing != null) ctx.setPlaying(playing);
        return ctx;
    }

    /**
     * Merge a {@link VoiceJsonRequest} nested {@code context} object with its flat
     * fields. Flat fields win when present — same precedence as the multipart
     * overload's {@code parseContext}.
     */
    private AssistantContext mergeJsonContext(VoiceJsonRequest body) {
        AssistantContext ctx = body.getContext() != null
                ? body.getContext()
                : AssistantContext.builder().build();
        if (body.getCurrentSongId() != null) ctx.setCurrentSongId(body.getCurrentSongId());
        if (body.getCurrentArtist() != null) ctx.setCurrentArtist(body.getCurrentArtist());
        if (body.getCurrentAlbum() != null) ctx.setCurrentAlbum(body.getCurrentAlbum());
        if (body.getCurrentPlaylist() != null) ctx.setCurrentPlaylist(body.getCurrentPlaylist());
        if (body.getPlaying() != null) ctx.setPlaying(body.getPlaying());
        if (body.getQueueSize() != null) ctx.setQueueSize(body.getQueueSize());
        if (body.getLastMood() != null) ctx.setLastMood(body.getLastMood());
        if (body.getLastSearch() != null) ctx.setLastSearch(body.getLastSearch());
        return ctx;
    }

    private String normalizeAudioFilename(String original, String contentType) {
        String lower = original != null ? original.toLowerCase() : "";
        if (lower.endsWith(".m4a") || lower.endsWith(".mp4") || lower.endsWith(".aac")
                || lower.endsWith(".webm") || lower.endsWith(".ogg") || lower.endsWith(".wav")
                || lower.endsWith(".mp3")) {
            return original;
        }
        String ct = contentType != null ? contentType.toLowerCase() : "";
        if (ct.contains("mp4") || ct.contains("m4a") || ct.contains("aac") || ct.contains("x-m4a")) {
            return "audio.m4a";
        }
        if (ct.contains("ogg")) return "audio.ogg";
        if (ct.contains("wav")) return "audio.wav";
        if (ct.contains("mpeg") || ct.contains("mp3")) return "audio.mp3";
        return "audio.webm";
    }

    private boolean isAllowedAudio(String contentType, String filename) {
        String fn = filename != null ? filename.toLowerCase() : "";
        if (fn.endsWith(".m4a") || fn.endsWith(".mp4") || fn.endsWith(".aac")
                || fn.endsWith(".webm") || fn.endsWith(".ogg") || fn.endsWith(".wav")
                || fn.endsWith(".mp3")) {
            return true;
        }
        if (contentType == null) return false;
        String ct = contentType.toLowerCase().split(";")[0].trim();
        return ALLOWED_AUDIO_TYPES.contains(ct);
    }

    @ExceptionHandler(MissingServletRequestPartException.class)
    public ResponseEntity<?> handleMissingAudio(MissingServletRequestPartException ex,
                                                HttpServletRequest request) {
        // Voice-only: missing 'audio' part answers 200 voice shape. Non-voice
        // URIs return the global 400 shape directly (a rethrow would be
        // resolved by DefaultHandlerExceptionResolver with an empty body).
        String uri = request != null ? request.getRequestURI() : "";
        if (!isVoiceUri(uri)) {
            String part = ex.getRequestPartName() != null ? ex.getRequestPartName() : "file";
            return ResponseEntity.badRequest().body(ErrorResponse.builder()
                    .timestamp(java.time.LocalDateTime.now())
                    .status(HttpStatus.BAD_REQUEST.value())
                    .error(HttpStatus.BAD_REQUEST.getReasonPhrase())
                    .message("Required file part '" + part + "' is not present")
                    .build());
        }
        // Missing 'audio' part is thrown before handleVoice() runs: answer 200 voice shape, never 500 generic.
        log.warn("AI voice missing part: {}", ex.getMessage());
        String part = ex.getRequestPartName() != null ? ex.getRequestPartName() : "audio";
        return ResponseEntity.ok(AssistantResponse.builder()
                .transcript("")
                .actions(java.util.List.of())
                .clarificationNeeded(true)
                .clarificationQuestion("Voice processing failed: Missing audio file (field '" + part + "' is required)")
                .build());
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<?> handleVoiceMaxUpload(MaxUploadSizeExceededException ex,
                                                  HttpServletRequest request) {
        // Voice-only: container size guard answers 200 voice shape. Non-voice
        // returns the global 413 shape directly (never 500 generic).
        String uri = request != null ? request.getRequestURI() : "";
        if (!isVoiceUri(uri)) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(ErrorResponse.builder()
                    .timestamp(java.time.LocalDateTime.now())
                    .status(HttpStatus.PAYLOAD_TOO_LARGE.value())
                    .error(HttpStatus.PAYLOAD_TOO_LARGE.getReasonPhrase())
                    .message("File size exceeds maximum limit")
                    .build());
        }
        // Container-level size guard fires before handleVoice(): answer 200 voice shape, never 500/413 generic.
        log.warn("AI voice upload too large: {}", ex.getMessage(), ex);
        return ResponseEntity.ok(AssistantResponse.builder()
                .transcript("")
                .actions(java.util.List.of())
                .clarificationNeeded(true)
                .clarificationQuestion("Voice processing failed: Audio too large (max 15MB)")
                .build());
    }

    @ExceptionHandler(MultipartException.class)
    public ResponseEntity<?> handleVoiceMultipart(MultipartException ex,
                                                  HttpServletRequest request) {
        // Voice-only: malformed multipart answers 200 voice shape. Non-voice
        // returns the global 400 shape directly (MaxUploadSizeExceeded is a
        // MultipartException subtype but has its own handler above).
        String uri = request != null ? request.getRequestURI() : "";
        if (!isVoiceUri(uri)) {
            log.warn("Multipart failure (non-voice) uri={}: {}", uri, ex.getMessage());
            return ResponseEntity.badRequest().body(ErrorResponse.builder()
                    .timestamp(java.time.LocalDateTime.now())
                    .status(HttpStatus.BAD_REQUEST.value())
                    .error(HttpStatus.BAD_REQUEST.getReasonPhrase())
                    .message("Invalid multipart request")
                    .build());
        }
        // Malformed multipart / unreadable upload: answer 200 voice shape with a sanitized specific.
        log.warn("AI voice multipart failure: {}", ex.getMessage(), ex);
        return ResponseEntity.ok(voiceFailure("", "Invalid audio upload (" + sanitizeVoiceError(ex) + ")"));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<?> handleVoiceMediaType(HttpMediaTypeNotSupportedException ex,
                                                  HttpServletRequest request) {
        // Explicit 415 override: /ai/voice NEVER surfaces 415/500 generic —
        // any unsupported Content-Type answers 200 with the voice clarification shape.
        // /ai/text stays strict JSON-only and keeps the 415 ErrorResponse.
        // P0: voice scope is the exact path (startsWith VOICE_PATH), never contains("/ai/").
        String uri = request != null ? request.getRequestURI() : "";
        String ct = request != null ? request.getContentType() : "";
        boolean isVoice = isVoiceUri(uri);
        if (!isVoice) {
            log.warn("AI unsupported media type uri={} contentType={}: {}", uri, ct, ex.getMessage());
            return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).body(ErrorResponse.builder()
                    .timestamp(java.time.LocalDateTime.now())
                    .status(HttpStatus.UNSUPPORTED_MEDIA_TYPE.value())
                    .error(HttpStatus.UNSUPPORTED_MEDIA_TYPE.getReasonPhrase())
                    .message(ex.getMessage() != null ? ex.getMessage() : "Unsupported media type")
                    .build());
        }
        String received = ct != null && !ct.isBlank() ? ct.split(";")[0].trim() : "unknown";
        log.warn("AI voice unsupported media type uri={} contentType={}: {}", uri, ct, ex.getMessage());
        if (isVoicePartialUri(uri)) {
            return ResponseEntity.ok(partialClarification("",
                    "Unsupported media type '" + received + "' (use application/json)"));
        }
        return ResponseEntity.ok(voiceFailure("",
                "Unsupported media type '" + received + "' (use multipart audio or application/json)"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> handleVoiceGeneric(Exception ex, HttpServletRequest request) {
        // P0-1/P0-2: catch-all is voice-only. /ai/text validation failures
        // (MethodArgumentNotValid / HttpMessageNotReadable / MissingParam) are
        // delegated to the global 400 shape here (same status/message as
        // GlobalExceptionHandler) — never the 500 generic. Direct return (not
        // rethrow) is used because a rethrow from a controller-local handler
        // is resolved by DefaultHandlerExceptionResolver with an empty 400
        // body, bypassing the global ErrorResponse shape.
        // Auth failures never become 200 voice shape (null-user 401 path stays 401).
        // P0-2: voice scope is the exact path (startsWith VOICE_PATH). The old
        // multipart carve-out (multipart + contains("/ai/") => voice 200) is
        // removed: multipart to /ai/text must stay 415, not voice 200.
        String uri = request != null ? request.getRequestURI() : "";
        String ct = request != null ? request.getContentType() : "";
        if (ex instanceof org.springframework.security.access.AccessDeniedException) {
            log.warn("AI forbidden uri={}: {}", uri, ex.getMessage());
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(ErrorResponse.builder()
                    .timestamp(java.time.LocalDateTime.now())
                    .status(HttpStatus.FORBIDDEN.value())
                    .error(HttpStatus.FORBIDDEN.getReasonPhrase())
                    .message("Access denied")
                    .build());
        }
        if (ex instanceof org.springframework.security.core.AuthenticationException
                || ex instanceof org.springframework.security.authentication.BadCredentialsException
                || ex instanceof com.spotibase.exception.UnauthorizedException) {
            log.warn("AI unauthorized uri={}: {}", uri, ex.getMessage());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        boolean isVoice = isVoiceUri(uri);
        if (!isVoice) {
            // Delegate client-error types to the global 400 shape (same contract).
            if (ex instanceof MethodArgumentNotValidException validationEx) {
                java.util.Map<String, String> errors = new java.util.HashMap<>();
                validationEx.getBindingResult().getAllErrors().forEach(error -> {
                    String fieldName = error instanceof org.springframework.validation.FieldError fe
                            ? fe.getField() : error.getObjectName();
                    errors.put(fieldName, error.getDefaultMessage());
                });
                return ResponseEntity.badRequest().body(ErrorResponse.builder()
                        .timestamp(java.time.LocalDateTime.now())
                        .status(HttpStatus.BAD_REQUEST.value())
                        .error(HttpStatus.BAD_REQUEST.getReasonPhrase())
                        .message("Invalid input parameters")
                        .validationErrors(errors)
                        .build());
            }
            if (ex instanceof HttpMessageNotReadableException) {
                return ResponseEntity.badRequest().body(ErrorResponse.builder()
                        .timestamp(java.time.LocalDateTime.now())
                        .status(HttpStatus.BAD_REQUEST.value())
                        .error(HttpStatus.BAD_REQUEST.getReasonPhrase())
                        .message("Malformed request body")
                        .build());
            }
            if (ex instanceof MissingServletRequestParameterException missingParam) {
                return ResponseEntity.badRequest().body(ErrorResponse.builder()
                        .timestamp(java.time.LocalDateTime.now())
                        .status(HttpStatus.BAD_REQUEST.value())
                        .error(HttpStatus.BAD_REQUEST.getReasonPhrase())
                        .message("Required request parameter '" + missingParam.getParameterName() + "' is not present")
                        .build());
            }
            if (ex instanceof MissingServletRequestPartException missingPart) {
                String part = missingPart.getRequestPartName() != null ? missingPart.getRequestPartName() : "file";
                return ResponseEntity.badRequest().body(ErrorResponse.builder()
                        .timestamp(java.time.LocalDateTime.now())
                        .status(HttpStatus.BAD_REQUEST.value())
                        .error(HttpStatus.BAD_REQUEST.getReasonPhrase())
                        .message("Required file part '" + part + "' is not present")
                        .build());
            }
            if (ex instanceof MultipartException) {
                // MaxUploadSizeExceeded is handled locally for voice; for
                // non-voice mirror the global 400 (global 413 only for the
                // dedicated MaxUpload handler when it applies).
                if (ex instanceof MaxUploadSizeExceededException) {
                    return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(ErrorResponse.builder()
                            .timestamp(java.time.LocalDateTime.now())
                            .status(HttpStatus.PAYLOAD_TOO_LARGE.value())
                            .error(HttpStatus.PAYLOAD_TOO_LARGE.getReasonPhrase())
                            .message("File size exceeds maximum limit")
                            .build());
                }
                return ResponseEntity.badRequest().body(ErrorResponse.builder()
                        .timestamp(java.time.LocalDateTime.now())
                        .status(HttpStatus.BAD_REQUEST.value())
                        .error(HttpStatus.BAD_REQUEST.getReasonPhrase())
                        .message("Invalid multipart request")
                        .build());
            }
            log.error("Unexpected error on {}: ", uri, ex);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(ErrorResponse.builder()
                    .timestamp(java.time.LocalDateTime.now())
                    .status(HttpStatus.INTERNAL_SERVER_ERROR.value())
                    .error(HttpStatus.INTERNAL_SERVER_ERROR.getReasonPhrase())
                    .message("An unexpected error occurred")
                    .build());
        }
        log.error("AI voice unhandled failure uri={} contentType={}: ", uri, ct, ex);
        if (isVoicePartialUri(uri)) {
            return ResponseEntity.ok(partialClarification("", sanitizeVoiceError(ex)));
        }
        return ResponseEntity.ok(voiceFailure("", sanitizeVoiceError(ex)));
    }

    @GetMapping(value = "/health", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> health() {
        return ResponseEntity.ok(java.util.Map.of("status", "ok", "service", "spotibase-ai-orchestrator"));
    }
}
