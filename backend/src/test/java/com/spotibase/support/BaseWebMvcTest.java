package com.spotibase.support;

import com.spotibase.security.JwtTokenProvider;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.security.core.userdetails.UserDetailsService;

/**
 * Base class for {@code @WebMvcTest} slices.
 *
 * <p>The production {@code JwtAuthenticationFilter} is a {@code Filter} bean and
 * therefore gets picked up by {@code @WebMvcTest} filtering. It needs a
 * {@link JwtTokenProvider} and a {@link UserDetailsService} at construction time.
 * These mocked beans (inherited by every subclass) satisfy those dependencies so the
 * slice context starts without a full application / database / Redis stack.
 */
public abstract class BaseWebMvcTest {

    @MockBean
    protected JwtTokenProvider jwtTokenProvider;

    @MockBean
    protected UserDetailsService userDetailsService;
}