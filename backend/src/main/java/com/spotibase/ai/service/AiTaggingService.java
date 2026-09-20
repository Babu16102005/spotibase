package com.spotibase.ai.service;

import com.spotibase.entity.Song;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.*;

@Service
@Slf4j
public class AiTaggingService {

    private final WebClient aiWebClient;

    @Value("${ai.enabled:true}")
    private boolean aiEnabled;

    @Value("${ai.service-url:http://localhost:7860}")
    private String aiServiceUrl;

    public AiTaggingService(WebClient aiWebClient) {
        this.aiWebClient = aiWebClient;
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
     * Called on every song upload (single + bulk). Returns accurate mood/energy/vibe.
     * Tries FastAPI /audio/tag for Qwen-based inference, falls back to rule-based.
     */
    public TagResult tag(Song song, String title, String artistName, String genreName, String language, Long durationMs, Integer bitrate) {
        // Try FastAPI first (if up) - more accurate via Qwen
        if (aiEnabled) {
            try {
                Map<String, Object> body = new HashMap<>();
                body.put("title", title);
                body.put("artist", artistName);
                body.put("genre", genreName);
                body.put("language", language);
                body.put("durationMs", durationMs);
                body.put("bitrate", bitrate);
                Map resp = aiWebClient.post()
                    .uri("/audio/tag")
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();
                if (resp != null && resp.containsKey("mood_tags")) {
                    List<String> moods = (List<String>) resp.getOrDefault("mood_tags", List.of("CALM"));
                    List<String> vibes = (List<String>) resp.getOrDefault("vibe_tags", List.of("CHILL"));
                    List<String> activities = (List<String>) resp.getOrDefault("activity_tags", List.of("LISTENING"));
                    Number energy = (Number) resp.getOrDefault("energy_score", 0.5);
                    Number valence = (Number) resp.getOrDefault("valence_score", 0.6);
                    Number bpm = (Number) resp.getOrDefault("bpm", 90);
                    log.info("AI tag (FastAPI) for '{}' -> mood={} energy={}", title, moods, energy);
                    return new TagResult(moods, vibes, activities, energy.floatValue(), valence.floatValue(), bpm.floatValue(), true);
                }
            } catch (Exception e) {
                log.warn("AI tag FastAPI failed for '{}', fallback to rule: {}", title, e.getMessage());
            }
        }
        // Rule-based fallback - accurate for Tamil + known artists
        return ruleBased(title, artistName, genreName, language, durationMs, bitrate);
    }

    private TagResult ruleBased(String title, String artist, String genre, String language, Long durationMs, Integer bitrate) {
        String t = (title != null ? title.toLowerCase() : "");
        String a = (artist != null ? artist.toLowerCase() : "");
        String g = (genre != null ? genre.toLowerCase() : "");
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
        // Duration/bitrate nudges: long + low bitrate -> calm
        if (durationMs != null && durationMs > 300000 && bitrate != null && bitrate < 200) {
            energy = Math.min(energy, 0.4f);
            mood = List.of("CALM", "NOSTALGIC");
        }

        log.info("AI tag (rule) for '{}' by '{}' -> mood={} energy={} bpm={}", title, artist, mood, energy, bpm);
        return new TagResult(mood, vibe, activity, energy, valence, bpm, true);
    }
}
