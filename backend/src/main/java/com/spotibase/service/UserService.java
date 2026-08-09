package com.spotibase.service;

import com.spotibase.dto.request.UpdateProfileRequest;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.UserResponse;
import com.spotibase.entity.User;
import com.spotibase.exception.BadRequestException;
import com.spotibase.exception.DuplicateResourceException;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.TypedQuery;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final StorageService storageService;
    private final PasswordEncoder passwordEncoder;

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(readOnly = true)
    public UserResponse getUserById(String id) {
        User user = userRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("User", id));
        return toUserResponse(user);
    }

    @Transactional(readOnly = true)
    public UserResponse getCurrentUser(String userId) {
        return getUserById(userId);
    }

    @Transactional
    public UserResponse updateProfile(String userId, UpdateProfileRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        if (request.getUsername() != null && !request.getUsername().equals(user.getUsername())) {
            if (userRepository.existsByUsername(request.getUsername())) {
                throw new DuplicateResourceException("Username already taken");
            }
            user.setUsername(request.getUsername());
        }
        if (request.getBio() != null) {
            user.setBio(request.getBio());
        }
        if (request.getCountry() != null) {
            user.setCountry(request.getCountry());
        }
        if (request.getFavoriteGenres() != null) {
            user.setFavoriteGenres(request.getFavoriteGenres());
        }

        user = userRepository.save(user);
        log.info("Profile updated for user: {}", userId);
        return toUserResponse(user);
    }

    @Transactional
    public String updateAvatar(String userId, MultipartFile file) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        String avatarUrl = storageService.uploadAvatar(file, userId);
        user.setAvatarUrl(avatarUrl);
        userRepository.save(user);

        log.info("Avatar updated for user: {}", userId);
        return avatarUrl;
    }

    @Transactional
    public String updateCover(String userId, MultipartFile file) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        String coverUrl = storageService.uploadCover(file, userId);
        user.setCoverUrl(coverUrl);
        userRepository.save(user);

        log.info("Cover updated for user: {}", userId);
        return coverUrl;
    }

    @Transactional
    public void changePassword(String userId, String oldPassword, String newPassword) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));

        if (user.getPasswordHash() != null
                && !passwordEncoder.matches(oldPassword, user.getPasswordHash())) {
            throw new BadRequestException("Current password is incorrect");
        }

        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        log.info("Password changed for user: {}", userId);
    }

    @Transactional
    public void deleteAccount(String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));
        user.setActive(false);
        userRepository.save(user);
        log.info("Account deactivated: {}", userId);
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getUserStats(String userId) {
        if (!userRepository.existsById(userId)) {
            throw new ResourceNotFoundException("User", userId);
        }

        long followerCount = getFollowerCount(userId);
        long followingCount = getFollowingCount(userId);

        User user = userRepository.findById(userId).orElseThrow();
        long totalListeningTimeMs = user.getTotalListeningTimeMs();

        Map<String, Object> stats = new HashMap<>();
        stats.put("followerCount", followerCount);
        stats.put("followingCount", followingCount);
        stats.put("totalListeningTimeMs", totalListeningTimeMs);
        return stats;
    }

    @Transactional
    public void followUser(String userId, String targetUserId) {
        if (userId.equals(targetUserId)) {
            throw new BadRequestException("Cannot follow yourself");
        }

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));
        User target = userRepository.findById(targetUserId)
                .orElseThrow(() -> new ResourceNotFoundException("User", targetUserId));

        if (user.getFollowing().contains(target)) {
            throw new BadRequestException("Already following this user");
        }

        user.getFollowing().add(target);
        userRepository.save(user);
        log.info("User {} followed user {}", userId, targetUserId);
    }

    @Transactional
    public void unfollowUser(String userId, String targetUserId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));
        User target = userRepository.findById(targetUserId)
                .orElseThrow(() -> new ResourceNotFoundException("User", targetUserId));

        if (!user.getFollowing().contains(target)) {
            throw new BadRequestException("Not following this user");
        }

        user.getFollowing().remove(target);
        userRepository.save(user);
        log.info("User {} unfollowed user {}", userId, targetUserId);
    }

    @Transactional(readOnly = true)
    public PagedResponse<UserResponse> getFollowers(String userId, Pageable pageable) {
        if (!userRepository.existsById(userId)) {
            throw new ResourceNotFoundException("User", userId);
        }

        TypedQuery<User> query = entityManager.createQuery(
                "SELECT f FROM User f JOIN f.following u WHERE u.id = :userId ORDER BY f.createdAt DESC",
                User.class);
        query.setParameter("userId", userId);
        query.setFirstResult((int) pageable.getOffset());
        query.setMaxResults(pageable.getPageSize());

        TypedQuery<Long> countQuery = entityManager.createQuery(
                "SELECT COUNT(f) FROM User f JOIN f.following u WHERE u.id = :userId",
                Long.class);
        countQuery.setParameter("userId", userId);

        List<User> users = query.getResultList();
        long total = countQuery.getSingleResult();

        List<UserResponse> content = users.stream()
                .map(this::toUserResponse)
                .collect(Collectors.toList());

        int totalPages = (int) Math.ceil((double) total / pageable.getPageSize());

        return PagedResponse.<UserResponse>builder()
                .content(content)
                .page(pageable.getPageNumber())
                .size(pageable.getPageSize())
                .totalElements(total)
                .totalPages(totalPages)
                .first(pageable.getPageNumber() == 0)
                .last(pageable.getPageNumber() >= totalPages - 1)
                .build();
    }

    @Transactional(readOnly = true)
    public PagedResponse<UserResponse> getFollowing(String userId, Pageable pageable) {
        if (!userRepository.existsById(userId)) {
            throw new ResourceNotFoundException("User", userId);
        }

        TypedQuery<User> query = entityManager.createQuery(
                "SELECT t FROM User u JOIN u.following t WHERE u.id = :userId ORDER BY t.createdAt DESC",
                User.class);
        query.setParameter("userId", userId);
        query.setFirstResult((int) pageable.getOffset());
        query.setMaxResults(pageable.getPageSize());

        TypedQuery<Long> countQuery = entityManager.createQuery(
                "SELECT COUNT(t) FROM User u JOIN u.following t WHERE u.id = :userId",
                Long.class);
        countQuery.setParameter("userId", userId);

        List<User> users = query.getResultList();
        long total = countQuery.getSingleResult();

        List<UserResponse> content = users.stream()
                .map(this::toUserResponse)
                .collect(Collectors.toList());

        int totalPages = (int) Math.ceil((double) total / pageable.getPageSize());

        return PagedResponse.<UserResponse>builder()
                .content(content)
                .page(pageable.getPageNumber())
                .size(pageable.getPageSize())
                .totalElements(total)
                .totalPages(totalPages)
                .first(pageable.getPageNumber() == 0)
                .last(pageable.getPageNumber() >= totalPages - 1)
                .build();
    }

    public UserResponse toUserResponse(User user) {
        return UserResponse.builder()
                .id(user.getId())
                .email(user.getEmail())
                .username(user.getUsername())
                .avatarUrl(user.getAvatarUrl())
                .coverUrl(user.getCoverUrl())
                .bio(user.getBio())
                .country(user.getCountry())
                .favoriteGenres(user.getFavoriteGenres())
                .role(user.getRole().name())
                .emailVerified(user.isEmailVerified())
                .totalListeningTimeMs(user.getTotalListeningTimeMs())
                .followerCount((int) getFollowerCount(user.getId()))
                .followingCount((int) getFollowingCount(user.getId()))
                .createdAt(user.getCreatedAt())
                .build();
    }

    private long getFollowerCount(String userId) {
        TypedQuery<Long> query = entityManager.createQuery(
                "SELECT COUNT(f) FROM User f JOIN f.following u WHERE u.id = :userId",
                Long.class);
        query.setParameter("userId", userId);
        return query.getSingleResult();
    }

    private long getFollowingCount(String userId) {
        TypedQuery<Long> query = entityManager.createQuery(
                "SELECT COUNT(t) FROM User u JOIN u.following t WHERE u.id = :userId",
                Long.class);
        query.setParameter("userId", userId);
        return query.getSingleResult();
    }
}
