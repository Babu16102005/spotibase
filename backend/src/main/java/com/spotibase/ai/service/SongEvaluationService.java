package com.spotibase.ai.service;

import com.spotibase.entity.Song;
import com.spotibase.repository.SongRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Post-upload Qwen listener-mindset evaluation.
 *
 * <p>Uploads save immediately with fast parameter-based tags (upload response
 * never waits for the AI). This service then asks the real Qwen model how
 * real-world crowds perceive the song and overwrites the tags when — and
 * only when — the verdict is a genuine LLM judgment
 * ({@code evaluated_by=qwen}). Rule fallbacks and failures never touch the
 * stored tags, so evaluation can only upgrade accuracy, never compromise it.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class SongEvaluationService {

    private final QwenClient qwenClient;
    private final SongRepository songRepository;

    /**
     * Fire-and-forget post-commit hook (see {@link #onSongUploaded}): upload
     * threads return 201 immediately and never block on the LLM. Failures
     * are logged, never propagated.
     */
    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSongUploaded(SongUploadedEvent event) {
        if (event == null || event.songId() == null || event.songId().isBlank()) return;
        try {
            Map<String, Object> verdict = evaluateNow(event.songId());
            log.info("Post-upload evaluation done for song {} -> {}", event.songId(), verdict.get("evaluated_by"));
        } catch (Exception e) {
            log.warn("Post-upload evaluation failed for song {}: {}", event.songId(), e.getMessage());
        }
    }

    /**
     * Synchronous Qwen evaluation of one song (admin re-evaluate endpoint +
     * async worker above). Persists the verdict only when it is a real LLM
     * judgment. Returns the verdict map including {@code evaluated_by}
     * ({@code qwen} or {@code rule}) and the model {@code reason}.
     */
    @Transactional
    public Map<String, Object> evaluateNow(String songId) {
        Song song = songRepository.findById(songId)
                .orElseThrow(() -> new com.spotibase.exception.ResourceNotFoundException("Song", songId));

        Map<String, Object> body = new HashMap<>();
        body.put("title", song.getName());
        body.put("artist", song.getPrimaryArtistName() != null ? song.getPrimaryArtistName()
                : (song.getArtist() != null ? song.getArtist().getName() : null));
        body.put("genre", song.getGenre() != null ? song.getGenre().getName() : null);
        body.put("language", song.getLanguage());
        if (song.getDurationMs() > 0) body.put("durationMs", song.getDurationMs());
        if (song.getBitrate() > 0) body.put("bitrate", song.getBitrate());
        if (song.getSampleRate() > 0) body.put("sampleRate", song.getSampleRate());
        if (song.getLyrics() != null && !song.getLyrics().isBlank()) {
            String lyrics = song.getLyrics();
            body.put("lyrics", lyrics.substring(0, Math.min(lyrics.length(), 2000)));
        }

        Optional<Map<String, Object>> verdict = qwenClient.evaluateSong(body);
        if (verdict.isEmpty() || !"qwen".equals(verdict.get().get("evaluated_by"))) {
            log.info("Song {} keeps parameter-based tags (no Qwen verdict)", songId);
            Map<String, Object> kept = currentTags(song);
            kept.put("evaluated_by", "rule");
            kept.put("reason", "");
            return kept;
        }

        applyVerdict(song, verdict.get());
        songRepository.save(song);
        log.info("Qwen re-tagged '{}' -> mood={} energy={} reason={}", song.getName(),
                verdict.get().get("mood_tags"), verdict.get().get("energy_score"), verdict.get().get("reason"));
        Map<String, Object> out = new HashMap<>(verdict.get());
        out.put("songId", songId);
        return out;
    }

    @SuppressWarnings("unchecked")
    private void applyVerdict(Song song, Map<String, Object> verdict) {
        Object moods = verdict.get("mood_tags");
        Object vibes = verdict.get("vibe_tags");
        Object acts = verdict.get("activity_tags");
        if (moods instanceof List<?> l && !l.isEmpty()) song.setMoodTags(new ArrayList<>((List<String>) l));
        if (vibes instanceof List<?> l && !l.isEmpty()) song.setVibeTags(new ArrayList<>((List<String>) l));
        if (acts instanceof List<?> l && !l.isEmpty()) song.setActivityTags(new ArrayList<>((List<String>) l));
        if (verdict.get("energy_score") instanceof Number n) song.setEnergyScore(n.floatValue());
        if (verdict.get("valence_score") instanceof Number n) song.setValenceScore(n.floatValue());
        if (verdict.get("bpm") instanceof Number n) song.setBpm(n.floatValue());
        song.setAiTagged(true);
        song.setAiTaggedAt(LocalDateTime.now());
    }

    private Map<String, Object> currentTags(Song song) {
        Map<String, Object> out = new HashMap<>();
        out.put("songId", song.getId());
        out.put("mood_tags", song.getMoodTags());
        out.put("vibe_tags", song.getVibeTags());
        out.put("activity_tags", song.getActivityTags());
        out.put("energy_score", song.getEnergyScore());
        out.put("valence_score", song.getValenceScore());
        out.put("bpm", song.getBpm());
        return out;
    }
}
