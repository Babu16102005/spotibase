package com.spotibase.service;

/**
 * Ordered home tiers to stop rushing/crash: clients load CRITICAL first,
 * then SECONDARY, then HEAVY. {@code ALL} preserves the legacy single-shot
 * feed shape.
 */
public enum HomeTier {
    CRITICAL,
    SECONDARY,
    HEAVY,
    ALL;

    /**
     * Fail-open parse: null/blank/unknown values fall back to {@code ALL}
     * so the feed never 400s on a bad {@code tier} param.
     */
    public static HomeTier fromString(String raw) {
        if (raw == null || raw.isBlank()) {
            return ALL;
        }
        try {
            return HomeTier.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return ALL;
        }
    }
}
