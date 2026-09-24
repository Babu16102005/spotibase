package com.spotibase.exception;

/**
 * YouTube Data API v3 quota/rate-limit signal (HTTP 429 / quotaExceeded).
 * Never carries the API key. Callers fail open to cached or mock data.
 */
public class YoutubeQuotaExceededException extends RuntimeException {

    public YoutubeQuotaExceededException(String message) {
        super(message);
    }

    public YoutubeQuotaExceededException(String message, Throwable cause) {
        super(message, cause);
    }
}
