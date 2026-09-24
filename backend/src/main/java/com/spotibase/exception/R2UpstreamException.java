package com.spotibase.exception;

/**
 * The R2/S3 upstream call failed in a way that is not the client's fault
 * (timeouts, 5xx, connectivity) — maps to HTTP 502 Bad Gateway.
 */
public class R2UpstreamException extends RuntimeException {

    public R2UpstreamException(String message, Throwable cause) {
        super(message, cause);
    }

    public R2UpstreamException(String message) {
        super(message);
    }
}
