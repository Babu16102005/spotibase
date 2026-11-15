package com.spotibase.ai.service;

import com.spotibase.entity.Song;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
public class AiTaggingService {

    public AiTaggingService() {
    }

    public record TagResult(
        List<String> moodTags,
        List<String> vibeTags,
        List<String> activityTags,
        float energyScore,
        float valenceScore,
        float bpm,
        boolean aiTagged
    ) {}

    /**
     * Called on every song upload (single + bulk). Evaluates mood/energy/vibe
     * locally from the song's own parameters — title/artist/genre/language
     * metadata plus measured file parameters (duration, bitrate, sample
     * rate). No LLM call: uploaded-song tagging is a deterministic,
     * parameter-based evaluation (keyword inference for labels, measured
     * parameters for scores), so uploads never block on, or fail from, an
     * AI service round-trip.
     */
    public TagResult tag(Song song, String title, String artistName, String genreName, String language, Long durationMs, Integer bitrate, Integer sampleRate) {
        return evaluateFromParameters(title, artistName, genreName, language, durationMs, bitrate, sampleRate);
    }

    /** Backwards-compatible overload (no sample rate measured). */
    public TagResult tag(Song song, String title, String artistName, String genreName, String language, Long durationMs, Integer bitrate) {
        return evaluateFromParameters(title, artistName, genreName, language, durationMs, bitrate, null);
    }

    /**
     * Parameter-based evaluation. Labels come from title/artist/genre/
     * language keyword inference (the only semantic signal available without
     * DSP); energy/valence/bpm start from the genre base, the keyword branch
     * may override on strong title/artist signal, and measured file
     * parameters always adjust the scores (see {@link #applyMeasuredAdjustments}).
     */
    private TagResult evaluateFromParameters(String title, String artistName, String genreName, String language, Long durationMs, Integer bitrate, Integer sampleRate) {
        String t = (title != null ? title.toLowerCase() : "");
        String a = (artistName != null ? artistName.toLowerCase() : "");
        String g = (genreName != null ? genreName.toLowerCase() : "");
        String lang = (language != null ? language.toLowerCase() : "");

        // Defaults
        List<String> mood = List.of("CALM");
        List<String> vibe = List.of("CHILL");
        List<String> activity = List.of("LISTENING");
        float energy = 0.45f, valence = 0.6f, bpm = 92f;

        // Hiphop / Conquest - energetic
        if (t.contains("conquest") || t.contains("hiphop") || a.contains("hiphop") || t.contains("mass") || t.contains("kuthu") || t.contains("power")) {
            mood = List.of("ENERGETIC", "FOCUSED", "MOTIVATED"); vibe = List.of("INTENSE", "FOCUSED"); energy = 0.88f; valence = 0.65f; bpm = 128f; activity = List.of("WORKOUT", "FOCUSED");
        } else if (t.contains("love") || t.contains("kadhal") || t.contains("pyar") || t.contains("uyire") || a.contains("a r rahman") || a.contains("rahman")) {
            mood = List.of("ROMANTIC", "CALM"); vibe = List.of("DREAMY", "CHILL"); energy = 0.38f; valence = 0.72f; bpm = 82f; activity = List.of("ROMANCE", "CHILL");
        } else if (t.contains("sad") || t.contains("sogam") || t.contains("kanneer") || t.contains("alone") || t.contains("broken") || t.contains("mazhai") && t.contains("sogam")) {
            mood = List.of("SAD", "MELANCHOLIC"); vibe = List.of("DARK", "PEACEFUL"); energy = 0.28f; valence = 0.25f; bpm = 74f; activity = List.of("SLEEP", "CHILL");
        } else if (t.contains("happy") || t.contains("celebration") || t.contains("dance") || t.contains("party") || t.contains("kolaveri") || t.contains("vaathi")) {
            mood = List.of("HAPPY", "PARTY"); vibe = List.of("FEEL_GOOD", "PARTY"); energy = 0.82f; valence = 0.85f; bpm = 118f; activity = List.of("PARTY", "DANCE");
        } else if (a.contains("yuvan")) {
            // Yuvan: romantic/nostalgic
            mood = List.of("ROMANTIC", "NOSTALGIC"); vibe = List.of("DREAMY", "NOSTALGIC"); energy = 0.52f; valence = 0.62f; bpm = 88f; activity = List.of("CHILL", "TRAVEL");
        } else if (a.contains("anirudh")) {
            mood = List.of("ENERGETIC", "HAPPY"); vibe = List.of("PARTY", "FEEL_GOOD"); energy = 0.78f; valence = 0.75f; bpm = 110f; activity = List.of("PARTY", "DRIVING");
        } else if (t.contains("calm") || t.contains("peace") || g.contains("classical") || g.contains("raga")) {
            mood = List.of("CALM", "FOCUSED"); vibe = List.of("PEACEFUL", "CHILL"); energy = 0.32f; valence = 0.68f; bpm = 76f; activity = List.of("STUDY", "SLEEP");
        }
        // Language nudges
        if ("tamil".equals(lang) && energy > 0.7) vibe = List.of("INTENSE", "PARTY");
        // Every keyword branch above moves energy off the 0.45 default, so a
        // changed energy (or mood) means a branch matched and its scores stand.
        boolean matched = energy != 0.45f || valence != 0.6f || bpm != 92f || !mood.equals(List.of("CALM"));
        // No keyword branch matched: seed scores from the configured genre base
        // so the numbers still reflect a configured parameter (not defaults).
        if (!matched) {
            float[] base = genreBase(g);
            energy = base[0];
            valence = base[1];
            bpm = base[2];
        }
        // Measured file parameters always shape the final scores.
        float[] adjusted = applyMeasuredAdjustments(energy, valence, bpm, durationMs, bitrate, sampleRate);
        energy = adjusted[0];
        valence = adjusted[1];
        bpm = adjusted[2];

        log.info("tag (parameters) for '{}' by '{}' -> mood={} energy={} bpm={}", title, artistName, mood, energy, bpm);
        return new TagResult(mood, vibe, activity, energy, valence, bpm, true);
    }

    /**
     * Configured genre base scores (mirrors the upload genre table:
     * ROCK/METAL, POP/DANCE, HIP-HOP/RAP, MELODY/CLASSICAL/JAZZ/BLUES,
     * CHILL/AMBIENT/LOFI, default). Returns {energy, valence, bpm}.
     */
    private float[] genreBase(String genreLower) {
        String g = genreLower != null ? genreLower : "";
        if (g.contains("rock") || g.contains("metal")) return new float[]{0.85f, 0.45f, 125f};
        if (g.contains("pop") || g.contains("dance")) return new float[]{0.80f, 0.75f, 120f};
        if (g.contains("hip") || g.contains("hop") || g.contains("rap")) return new float[]{0.75f, 0.60f, 95f};
        if (g.contains("melody") || g.contains("classical") || g.contains("jazz") || g.contains("blues") || g.contains("raga")) return new float[]{0.30f, 0.40f, 80f};
        if (g.contains("chill") || g.contains("ambient") || g.contains("lofi") || g.contains("lo-fi")) return new float[]{0.25f, 0.50f, 75f};
        return new float[]{0.50f, 0.50f, 100f};
    }

    /**
     * Adjusts scores from measured file parameters:
     * - bitrate (fidelity): >=320kbps hi-fi punch (energy +0.03);
     *   <128kbps thin/low-fi (energy -0.08, valence -0.03).
     * - duration: >5min long-form calms down (energy -0.08, bpm -4);
     *   <2min short cuts run hotter (energy +0.04, bpm +2).
     * - sample rate: >=48kHz hi-res (energy +0.02); <22.05kHz (energy -0.05).
     * Energy/valence clamp 0.05-0.99, bpm clamps 60-180.
     */
    private float[] applyMeasuredAdjustments(float energy, float valence, float bpm, Long durationMs, Integer bitrate, Integer sampleRate) {
        if (bitrate != null) {
            if (bitrate >= 320) {
                energy += 0.03f;
            } else if (bitrate < 128) {
                energy -= 0.08f;
                valence -= 0.03f;
            }
        }
        if (durationMs != null) {
            if (durationMs > 300000) {
                energy -= 0.08f;
                bpm -= 4f;
            } else if (durationMs < 120000) {
                energy += 0.04f;
                bpm += 2f;
            }
        }
        if (sampleRate != null) {
            if (sampleRate >= 48000) {
                energy += 0.02f;
            } else if (sampleRate < 22050) {
                energy -= 0.05f;
            }
        }
        energy = Math.min(0.99f, Math.max(0.05f, energy));
        valence = Math.min(0.99f, Math.max(0.05f, valence));
        bpm = Math.min(180f, Math.max(60f, bpm));
        return new float[]{energy, valence, bpm};
    }
}
