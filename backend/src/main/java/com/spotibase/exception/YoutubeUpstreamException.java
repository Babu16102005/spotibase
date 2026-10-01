package com.spotibase.exception;

/**
 * YouTube Data API v3 upstream rejection (e.g. HTTP 400 invalid request).
 * Never carries the API key. Maps to HTTP 502 Bad Gateway via
 * {@link GlobalExceptionHandler}; {@code YoutubeService} normally fails
 * open to mock data so this only surfaces when upstream escapes the
 * service layer.
 */
public class YoutubeUpstreamException extends RuntimeException {

    public YoutubeUpstreamException(String message) {
        super(message);
    }

    public YoutubeUpstreamException(String message, Throwable cause) {
        super(message, cause);
    }
}
