package com.spotibase.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.spotibase.config.YoutubeConfig;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Minimal {@link YoutubeClient} budget coverage: the Bs/Bh split derived from
 * {@link YoutubeConfig} never exceeds the total, hydration stays capped, and
 * Reactor block timeouts are recognised for fail-open logging.
 */
class YoutubeClientTest {

    private YoutubeConfig configWith(int total, int search, int hydration, int maxIds) {
        YoutubeConfig config = new YoutubeConfig();
        ReflectionTestUtils.setField(config, "timeoutSeconds", total);
        ReflectionTestUtils.setField(config, "searchTimeoutSeconds", search);
        ReflectionTestUtils.setField(config, "hydrationTimeoutSeconds", hydration);
        ReflectionTestUtils.setField(config, "hydrationMaxIds", maxIds);
        return config;
    }

    @Test
    void budgetSplit_searchPlusHydrationWithinTotalAndCapTwenty() {
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
    void hydrationCap_clampedAndRespected() {
        assertThat(configWith(5, -1, -1, 20).getEffectiveHydrationMaxIds()).isEqualTo(20);
        assertThat(configWith(5, -1, -1, 0).getEffectiveHydrationMaxIds()).isEqualTo(1);
        assertThat(configWith(5, -1, -1, 99).getEffectiveHydrationMaxIds()).isEqualTo(25);
    }

    @Test
    void blockTimeout_recognisesReactorSignalAndWraps() {
        assertThat(YoutubeClient.isBlockTimeout(
                new IllegalStateException("Timeout on blocking read for 3000000000 nanos")))
                .isTrue();
        assertThat(YoutubeClient.isBlockTimeout(
                new IllegalStateException("Timeout on blocking read for 3000000000 nanos",
                        new java.util.concurrent.TimeoutException("timeout"))))
                .isTrue();
        assertThat(YoutubeClient.isBlockTimeout(new RuntimeException("network down"))).isFalse();
        assertThat(YoutubeClient.isBlockTimeout(
                new RuntimeException("wrapped",
                        new IllegalStateException("Timeout on blocking read for 1000 nanos"))))
                .isTrue();
    }

    @Test
    void nextPageToken_blankOrMissingMapsToNull() {
        assertThat(YoutubeClient.parseNextPageToken(null)).isNull();
        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        assertThat(YoutubeClient.parseNextPageToken(mapper.createObjectNode())).isNull();
        com.fasterxml.jackson.databind.node.ObjectNode blank =
                mapper.createObjectNode().put("nextPageToken", "   ");
        assertThat(YoutubeClient.parseNextPageToken(blank)).isNull();
        com.fasterxml.jackson.databind.node.ObjectNode token =
                mapper.createObjectNode().put("nextPageToken", "CAE QAA");
        assertThat(YoutubeClient.parseNextPageToken(token)).isEqualTo("CAE QAA");
    }
}
