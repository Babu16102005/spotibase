package com.spotibase.ai.config;

import io.netty.channel.ChannelOption;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;

@Configuration
public class AiConfig {

    @Value("${ai.service-url:http://localhost:7860}")
    private String aiServiceUrl;

    @Value("${ai.enabled:true}")
    private boolean aiEnabled;

    /**
     * FastAPI (Qwen/STT) WebClient budgets:
     *  - 800ms connect timeout (partial / fast-fail budget for voice)
     *  - 10s response timeout (backs the 9s voice-full budget: CF 4s + 1s
     *    retry + mock fallback + understand cache; text path fails fast at
     *    its own 3s per-request timeout)
     */
    @Bean
    public WebClient aiWebClient() {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 800)
                .responseTimeout(Duration.ofSeconds(10));
        return WebClient.builder()
                .baseUrl(aiServiceUrl)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .codecs(c -> c.defaultCodecs().maxInMemorySize(4 * 1024 * 1024))
                .build();
    }
}
