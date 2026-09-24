package com.spotibase.exception;

/**
 * Unsatisfiable or malformed {@code Range} request — maps to HTTP 416.
 * Carries the object size so callers can emit a {@code Content-Range} header
 * of the form {@code bytes} {@code *}/{@code size}.
 * A negative size means the size is unknown (e.g. validation failed before HEAD).
 */
public class InvalidRangeException extends RuntimeException {

    private final long objectSize;

    public InvalidRangeException(String message, long objectSize) {
        super(message);
        this.objectSize = objectSize;
    }

    public InvalidRangeException(String message) {
        this(message, -1L);
    }

    public long getObjectSize() {
        return objectSize;
    }
}
