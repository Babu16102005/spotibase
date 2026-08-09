package com.spotibase.service;
import org.springframework.test.util.ReflectionTestUtils;

import com.spotibase.dto.request.UpdateProfileRequest;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.UserResponse;
import com.spotibase.entity.Role;
import com.spotibase.entity.User;
import com.spotibase.exception.BadRequestException;
import com.spotibase.exception.DuplicateResourceException;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageRequest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link UserService}.
 */
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository userRepository;
    @Mock
    private StorageService storageService;
    @Mock
    private PasswordEncoder passwordEncoder;
    @Mock
    private EntityManager entityManager;

    @InjectMocks
    private UserService userService;

    private User user;

    @BeforeEach
    void setUp() {
        user = User.builder()
                .id("user-1")
                .email("alice@example.com")
                .username("alice")
                .passwordHash("encoded-hash")
                .role(Role.USER)
                .active(true)
                .build();
        // following/followers are NOT @Builder.Default — initialize explicitly
        user.setFollowing(new HashSet<>());
        user.setFollowers(new HashSet<>());
        ReflectionTestUtils.setField(userService, "entityManager", entityManager);
    }

    private void stubFollowerCounts(long followers, long following) {
        TypedQuery<Long> followerQuery = mock(TypedQuery.class);
        TypedQuery<Long> followingQuery = mock(TypedQuery.class);
        when(entityManager.createQuery(anyString(), eq(Long.class)))
                .thenReturn(followerQuery, followingQuery);
        when(followerQuery.getSingleResult()).thenReturn(followers);
        when(followingQuery.getSingleResult()).thenReturn(following);
    }

    // ---------- get me ----------

    @Test
    void getUserById_found_returnsUserResponse() {
        stubFollowerCounts(2, 3);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));

        UserResponse response = userService.getUserById("user-1");

        assertThat(response.getId()).isEqualTo("user-1");
        assertThat(response.getEmail()).isEqualTo("alice@example.com");
        assertThat(response.getUsername()).isEqualTo("alice");
        assertThat(response.getRole()).isEqualTo("USER");
        assertThat(response.getFollowerCount()).isEqualTo(2);
        assertThat(response.getFollowingCount()).isEqualTo(3);
    }

    @Test
    void getUserById_notFound_throwsResourceNotFoundException() {
        when(userRepository.findById("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> userService.getUserById("ghost"))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("User");
    }

    @Test
    void getCurrentUser_delegatesToGetUserById() {
        stubFollowerCounts(0, 0);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));

        UserResponse response = userService.getCurrentUser("user-1");

        assertThat(response.getId()).isEqualTo("user-1");
    }

    // ---------- update profile ----------

    @Test
    void updateProfile_changesBioCountryAndGenres() {
        stubFollowerCounts(0, 0);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userRepository.save(any(User.class))).thenReturn(user);

        UpdateProfileRequest request = UpdateProfileRequest.builder()
                .bio("new bio")
                .country("IN")
                .favoriteGenres(Set.of("rock", "jazz"))
                .build();

        UserResponse response = userService.updateProfile("user-1", request);

        assertThat(user.getBio()).isEqualTo("new bio");
        assertThat(user.getCountry()).isEqualTo("IN");
        assertThat(user.getFavoriteGenres()).containsExactlyInAnyOrder("rock", "jazz");
        assertThat(response.getBio()).isEqualTo("new bio");
        verify(userRepository).save(user);
    }

    @Test
    void updateProfile_newUsername_savesWhenFree() {
        stubFollowerCounts(0, 0);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userRepository.save(any(User.class))).thenReturn(user);
        when(userRepository.existsByUsername("alice2")).thenReturn(false);

        UpdateProfileRequest request = UpdateProfileRequest.builder().username("alice2").build();

        userService.updateProfile("user-1", request);

        assertThat(user.getUsername()).isEqualTo("alice2");
        verify(userRepository).save(user);
    }

    @Test
    void updateProfile_usernameTaken_throwsDuplicateResourceException() {
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userRepository.existsByUsername("taken")).thenReturn(true);

        UpdateProfileRequest request = UpdateProfileRequest.builder().username("taken").build();

        assertThatThrownBy(() -> userService.updateProfile("user-1", request))
                .isInstanceOf(DuplicateResourceException.class)
                .hasMessage("Username already taken");

        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void updateProfile_sameUsername_doesNotCheckDuplicate() {
        stubFollowerCounts(0, 0);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userRepository.save(any(User.class))).thenReturn(user);

        UpdateProfileRequest request = UpdateProfileRequest.builder().username("alice").build();

        userService.updateProfile("user-1", request);

        verify(userRepository, never()).existsByUsername(anyString());
        verify(userRepository).save(user);
    }

    @Test
    void updateProfile_emptyRequest_isNoOpSave() {
        stubFollowerCounts(0, 0);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userRepository.save(any(User.class))).thenReturn(user);

        UpdateProfileRequest request = UpdateProfileRequest.builder().build();

        userService.updateProfile("user-1", request);

        verify(userRepository).save(user);
    }

    // ---------- avatar / cover ----------

    @Test
    void updateAvatar_uploadsAndSaves() {
        MockMultipartFile file = new MockMultipartFile("file", "a.png", "image/png", new byte[]{1});
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(storageService.uploadAvatar(file, "user-1")).thenReturn("https://bucket/avatar.png");

        String url = userService.updateAvatar("user-1", file);

        assertThat(url).isEqualTo("https://bucket/avatar.png");
        assertThat(user.getAvatarUrl()).isEqualTo("https://bucket/avatar.png");
        verify(userRepository).save(user);
    }

    @Test
    void updateCover_uploadsAndSaves() {
        MockMultipartFile file = new MockMultipartFile("file", "c.png", "image/png", new byte[]{1});
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(storageService.uploadCover(file, "user-1")).thenReturn("https://bucket/cover.png");

        String url = userService.updateCover("user-1", file);

        assertThat(url).isEqualTo("https://bucket/cover.png");
        assertThat(user.getCoverUrl()).isEqualTo("https://bucket/cover.png");
        verify(userRepository).save(user);
    }

    // ---------- password ----------

    @Test
    void changePassword_correctOldPassword_encodesAndSaves() {
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("old-pass", "encoded-hash")).thenReturn(true);
        when(passwordEncoder.encode("new-pass")).thenReturn("new-encoded");

        userService.changePassword("user-1", "old-pass", "new-pass");

        assertThat(user.getPasswordHash()).isEqualTo("new-encoded");
        verify(userRepository).save(user);
    }

    @Test
    void changePassword_wrongOldPassword_throwsBadRequestException() {
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(passwordEncoder.matches("wrong", "encoded-hash")).thenReturn(false);

        assertThatThrownBy(() -> userService.changePassword("user-1", "wrong", "new-pass"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Current password is incorrect");

        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void changePassword_socialUserWithNullHash_skipsOldPasswordCheck() {
        user.setPasswordHash(null);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(passwordEncoder.encode("new-pass")).thenReturn("new-encoded");

        userService.changePassword("user-1", null, "new-pass");

        verify(passwordEncoder, never()).matches(anyString(), anyString());
        assertThat(user.getPasswordHash()).isEqualTo("new-encoded");
    }

    // ---------- delete account ----------

    @Test
    void deleteAccount_deactivatesInsteadOfDeleting() {
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));

        userService.deleteAccount("user-1");

        assertThat(user.isActive()).isFalse();
        verify(userRepository).save(user);
    }

    @Test
    void deleteAccount_notFound_throwsResourceNotFoundException() {
        when(userRepository.findById("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> userService.deleteAccount("ghost"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // ---------- stats ----------

    @Test
    void getUserStats_returnsCountsFromQueries() {
        stubFollowerCounts(7, 4);
        when(userRepository.existsById("user-1")).thenReturn(true);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        user.setTotalListeningTimeMs(5000);

        Map<String, Object> stats = userService.getUserStats("user-1");

        assertThat(stats).containsEntry("followerCount", 7L)
                .containsEntry("followingCount", 4L)
                .containsEntry("totalListeningTimeMs", 5000L);
    }

    @Test
    void getUserStats_unknownUser_throwsResourceNotFoundException() {
        when(userRepository.existsById("ghost")).thenReturn(false);

        assertThatThrownBy(() -> userService.getUserStats("ghost"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // ---------- follow / unfollow ----------

    @Test
    void followUser_success_addsToFollowing() {
        User target = User.builder().id("user-2").email("b@example.com").username("bob").build();
        target.setFollowing(new HashSet<>());
        target.setFollowers(new HashSet<>());
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userRepository.findById("user-2")).thenReturn(Optional.of(target));

        userService.followUser("user-1", "user-2");

        assertThat(user.getFollowing()).contains(target);
        verify(userRepository).save(user);
    }

    @Test
    void followUser_selfFollow_throwsBadRequestException() {
        assertThatThrownBy(() -> userService.followUser("user-1", "user-1"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Cannot follow yourself");
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void followUser_alreadyFollowing_throwsBadRequestException() {
        User target = User.builder().id("user-2").email("b@example.com").username("bob").build();
        user.getFollowing().add(target);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userRepository.findById("user-2")).thenReturn(Optional.of(target));

        assertThatThrownBy(() -> userService.followUser("user-1", "user-2"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Already following this user");
    }

    @Test
    void followUser_targetNotFound_throwsResourceNotFoundException() {
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userRepository.findById("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> userService.followUser("user-1", "ghost"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void unfollowUser_success_removesFromFollowing() {
        User target = User.builder().id("user-2").email("b@example.com").username("bob").build();
        target.setFollowing(new HashSet<>());
        target.setFollowers(new HashSet<>());
        user.getFollowing().add(target);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userRepository.findById("user-2")).thenReturn(Optional.of(target));

        userService.unfollowUser("user-1", "user-2");

        assertThat(user.getFollowing()).doesNotContain(target);
        verify(userRepository).save(user);
    }

    @Test
    void unfollowUser_notFollowing_throwsBadRequestException() {
        User target = User.builder().id("user-2").email("b@example.com").username("bob").build();
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(userRepository.findById("user-2")).thenReturn(Optional.of(target));

        assertThatThrownBy(() -> userService.unfollowUser("user-1", "user-2"))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Not following this user");
    }

    // ---------- followers / following pages ----------

    @Test
    void getFollowers_returnsPagedUsers() {
        User follower = User.builder().id("user-3").email("c@example.com").username("carol").build();
        follower.setFollowing(new HashSet<>());
        follower.setFollowers(new HashSet<>());
        when(userRepository.existsById("user-1")).thenReturn(true);
        TypedQuery<User> listQuery = mock(TypedQuery.class);
        TypedQuery<Long> countQuery = mock(TypedQuery.class);
        when(entityManager.createQuery(anyString(), eq(User.class))).thenReturn(listQuery);
        when(entityManager.createQuery(anyString(), eq(Long.class))).thenReturn(countQuery);
        when(listQuery.getResultList()).thenReturn(List.of(follower));
        when(countQuery.getSingleResult()).thenReturn(1L);

        PagedResponse<UserResponse> response = userService.getFollowers("user-1", PageRequest.of(0, 20));

        assertThat(response.getContent()).hasSize(1);
        assertThat(response.getContent().get(0).getId()).isEqualTo("user-3");
        assertThat(response.getTotalElements()).isEqualTo(1);
    }

    @Test
    void getFollowing_returnsPagedUsers() {
        User followed = User.builder().id("user-4").email("d@example.com").username("dave").build();
        followed.setFollowing(new HashSet<>());
        followed.setFollowers(new HashSet<>());
        when(userRepository.existsById("user-1")).thenReturn(true);
        TypedQuery<User> listQuery = mock(TypedQuery.class);
        TypedQuery<Long> countQuery = mock(TypedQuery.class);
        when(entityManager.createQuery(anyString(), eq(User.class))).thenReturn(listQuery);
        when(entityManager.createQuery(anyString(), eq(Long.class))).thenReturn(countQuery);
        when(listQuery.getResultList()).thenReturn(List.of(followed));
        when(countQuery.getSingleResult()).thenReturn(1L);

        PagedResponse<UserResponse> response = userService.getFollowing("user-1", PageRequest.of(0, 20));

        assertThat(response.getContent()).hasSize(1);
        assertThat(response.getContent().get(0).getId()).isEqualTo("user-4");
    }
}
