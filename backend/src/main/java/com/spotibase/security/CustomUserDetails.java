package com.spotibase.security;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.spotibase.entity.User;
import lombok.Getter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.Collections;

import java.io.Serial;
import java.io.Serializable;

@Getter
public class CustomUserDetails implements UserDetails {

    @Serial
    private static final long serialVersionUID = 1L;

    private final String id;
    private final String email;
    private final String username;
    private final String role;
    private final boolean active;

    public CustomUserDetails(User user) {
        this(user.getId(), user.getEmail(), user.getUsername(), user.getRole().name(), user.isActive());
    }

    @JsonCreator
    public CustomUserDetails(
            @JsonProperty("id") String id,
            @JsonProperty("email") String email,
            @JsonProperty("username") String username,
            @JsonProperty("role") String role,
            @JsonProperty("active") boolean active) {
        this.id = id;
        this.email = email;
        this.username = username;
        this.role = role;
        this.active = active;
    }

    @Override
    @JsonIgnore
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return Collections.singletonList(new SimpleGrantedAuthority("ROLE_" + role));
    }

    @Override
    public String getPassword() {
        return null; // We use Supabase for password validation
    }

    @Override
    public String getUsername() {
        return id;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return active;
    }
}
