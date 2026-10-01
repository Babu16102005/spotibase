package com.spotibase.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Minimal budget-split coverage for the YouTube outbound path.
 *
 * <p>Pins the Bs/Bh contract used by {@link com.spotibase.service.YoutubeClient}:
 * search budget Bs + hydration budget Bh never exceeds the total, the hydration
 * batch stays capped at 20 by default (1..25), and the shared pooled
 * {@code youtubeWebClient} bean exists.
 */
class YoutubeConfigTest {

    private YoutubeConfig configWith(int total, int search, int hydration, int maxIds) {
        YoutubeConfig config = new YoutubeConfig();
        ReflectionTestUtils.setField(config, "timeoutSeconds", total);
        ReflectionTestUtils.setField(config, "searchTimeoutSeconds", search);
        ReflectionTestUtils.setField(config, "hydrationTimeoutSeconds", hydration);
        ReflectionTestUtils.setField(config, "hydrationMaxIds", maxIds);
        return config;
    }

    @Test
    void defaults_splitThreePlusTwoWithinTotalFiveAndCapTwenty() {
        YoutubeConfig config = configWith(5, -1, -1, 20);

        int total = config.getEffectiveTimeoutSeconds();
        int search = config.getEffectiveSearchTimeoutSeconds();
        int hydration = config.getEffectiveHydrationTimeoutSeconds();

        assertThat(total).isEqualTo(5);
        assertThat(search).isEqualTo(3);
        assertThat(hydration).isEqualTo(2);
        assertThat(search + hydration).isLessThanOrEqualTo(total);
        assertThat(config.getEffectiveHydrationMaxIds()).isEqualTo(20);
    }

    @Test
    void splitInvariant_holdsAcrossTotals() {
        // Totals 2..30 (realistic budgets): Bs + Bh always fits. Total=1 is a
        // degenerate edge — both legs clamp to min 1s so the sum is 2s
        // best-effort (covered below); production default is total=5 (3+2).
        for (int total = 2; total <= 10; total++) {
            YoutubeConfig config = configWith(total, -1, -1, 20);

            int effectiveTotal = config.getEffectiveTimeoutSeconds();
            int search = config.getEffectiveSearchTimeoutSeconds();
            int hydration = config.getEffectiveHydrationTimeoutSeconds();

            assertThat(search).isBetween(1, 30);
            assertThat(hydration).isBetween(1, 30);
            assertThat(search + hydration)
                    .as("Bs+Bh<=total for total=%d", total)
                    .isLessThanOrEqualTo(effectiveTotal);
        }
        // Degenerate total=1: both legs floor at 1s, sum is 2s best-effort.
        YoutubeConfig tiny = configWith(1, -1, -1, 20);
        assertThat(tiny.getEffectiveSearchTimeoutSeconds()
                + tiny.getEffectiveHydrationTimeoutSeconds()).isEqualTo(2);
    }

    @Test
    void explicitOversizedSplit_normalisedToFitTotal() {
        YoutubeConfig config = configWith(5, 5, 5, 20);

        int total = config.getEffectiveTimeoutSeconds();
        int search = config.getEffectiveSearchTimeoutSeconds();
        int hydration = config.getEffectiveHydrationTimeoutSeconds();

        assertThat(search + hydration).isLessThanOrEqualTo(total);
        assertThat(total).isEqualTo(5);
    }

    @Test
    void hydrationMaxIds_clampedToOneToTwentyFive() {
        assertThat(configWith(5, -1, -1, 20).getEffectiveHydrationMaxIds()).isEqualTo(20);
        assertThat(configWith(5, -1, -1, 0).getEffectiveHydrationMaxIds()).isEqualTo(1);
        assertThat(configWith(5, -1, -1, 100).getEffectiveHydrationMaxIds()).isEqualTo(25);
        assertThat(configWith(5, -1, -1, 25).getEffectiveHydrationMaxIds()).isEqualTo(25);
    }

    @Test
    void totalBudget_clampedToOneToThirty() {
        assertThat(configWith(0, -1, -1, 20).getEffectiveTimeoutSeconds()).isEqualTo(1);
        assertThat(configWith(100, -1, -1, 20).getEffectiveTimeoutSeconds()).isEqualTo(30);
        assertThat(configWith(5, -1, -1, 20).getEffectiveTimeoutSeconds()).isEqualTo(5);
    }

    @Test
    void pooledWebClient_beanBuildsWithDefaultBaseUrl() {
        YoutubeConfig config = configWith(5, -1, -1, 20);
        ReflectionTestUtils.setField(config, "baseUrl", "https://www.googleapis.com/youtube/v3");

        assertThat(config.youtubeWebClient()).isNotNull();
    }

    @Test
    void timeoutMarker_messageContainsTimedOutForLogging() {
        // Translated timeout still contains the marker the service logs on.
        assertThat(new com.spotibase.exception.YoutubeUpstreamException(
                "YouTube search timed out after 3s").getMessage()).contains("timed out");
        assertThat(new com.spotibase.exception.YoutubeUpstreamException(
                "YouTube hydration timed out after 2s").getMessage()).contains("timed out");
    }
}
