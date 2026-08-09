package com.spotibase.exception;

public class ResourceNotFoundException extends RuntimeException {
    public ResourceNotFoundException(String resource, String id) {
        super(resource + " not found with id: " + id);
    }

    public ResourceNotFoundException(String message) {
        super(message);
    }
}
