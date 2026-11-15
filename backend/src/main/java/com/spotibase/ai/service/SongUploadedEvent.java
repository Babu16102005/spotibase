package com.spotibase.ai.service;

/**
 * Published after a song row is committed (single + bulk upload). Triggers
 * the async Qwen listener-mindset evaluation — never on the upload hot path.
 */
public record SongUploadedEvent(String songId) {}
