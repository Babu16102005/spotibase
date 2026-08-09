package com.spotibase.support;

import com.spotibase.entity.Role;
import com.spotibase.entity.User;
import com.spotibase.security.CustomUserDetails;

/**
 * Shared test fixtures for controller slice tests.
 */
public final class TestUsers {

    private TestUsers() {
    }

    public static CustomUserDetails userDetails(String id, Role role) {
        User user = User.builder()
                .id(id)
                .email(id + "@example.com")
                .username(id)
                .role(role)
                .active(true)
                .build();
        return new CustomUserDetails(user);
    }

    public static CustomUserDetails regularUser(String id) {
        return userDetails(id, Role.USER);
    }

    public static CustomUserDetails admin(String id) {
        return userDetails(id, Role.ADMIN);
    }

    public static CustomUserDetails artist(String id) {
        return userDetails(id, Role.ARTIST);
    }
}
