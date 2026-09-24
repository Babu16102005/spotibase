package com.spotibase.security;

import com.spotibase.entity.User;
import com.spotibase.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    /**
     * Loads auth state straight from the DB on every call (no cache).
     *
     * <p>Previously {@code @Cacheable("auth-users")} with
     * GenericJackson2JsonRedisSerializer: on a cache HIT Redis returned a
     * LinkedHashMap (type info lost), not CustomUserDetails, causing
     * ClassCastException in JwtAuthenticationFilter and 401 on every
     * authenticated request. Correctness over speed until a type-safe
     * local cache is added.
     *
     * <p>TODO: add Caffeine local cache of User DTO (not UserDetails) with
     * short TTL, rebuilding CustomUserDetails on hit.
     */
    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String userId) throws UsernameNotFoundException {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UsernameNotFoundException("User not found with id: " + userId));
        return new CustomUserDetails(user);
    }

    /**
     * No-op retained for callers (UserService, AdminService). Previously
     * evicted the {@code auth-users} Redis entry; caching is removed so
     * there is nothing to evict. Kept to avoid touching call sites.
     */
    public void evictUser(String userId) {
        // No-op: auth caching removed (see loadUserByUsername javadoc).
    }
}
