package com.spotibase.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.aop.interceptor.AsyncUncaughtExceptionHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.AsyncConfigurer;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * Bounded executor for fire-and-forget stream analytics
 * ({@code incrementPlayCount} / {@code recordPlayback}).
 *
 * <p>{@code @EnableAsync} lives on {@link com.spotibase.SpotiBaseApplication};
 * this config supplies the default executor so stream threads never block on
 * analytics DB writes, and analytics failures can never fail a stream —
 * they are logged via the uncaught-exception handler instead.
 */
@Slf4j
@Configuration
public class AsyncConfig implements AsyncConfigurer {

    @Override
    public Executor getAsyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(16);
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("analytics-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(10);
        // P0-3: AbortPolicy throws TaskRejectedException synchronously on the
        // stream thread when the queue is full (500s the stream). CallerRuns
        // runs the task on the caller thread instead — analytics degrade to
        // a short block, never a rejection.
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();
        return executor;
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (ex, method, params) -> log.error(
                "Async analytics failure in {}: {}", method.getName(), ex.getMessage());
    }
}
