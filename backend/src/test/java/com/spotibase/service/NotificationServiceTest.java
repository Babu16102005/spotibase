package com.spotibase.service;
import org.springframework.test.util.ReflectionTestUtils;

import com.spotibase.dto.response.NotificationResponse;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.entity.Notification;
import com.spotibase.entity.User;
import com.spotibase.repository.NotificationRepository;
import com.spotibase.repository.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageRequest;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link NotificationService}.
 */
@ExtendWith(MockitoExtension.class)
class NotificationServiceTest {

    @Mock
    private NotificationRepository notificationRepository;
    @Mock
    private UserRepository userRepository;
    @Mock
    private EntityManager entityManager;
    @Mock
    private RealtimeService realtimeService;

    @InjectMocks
    private NotificationService notificationService;

    private User user;

    @BeforeEach
    void setUp() {
        user = User.builder().id("user-1").email("a@example.com").username("alice").build();
        ReflectionTestUtils.setField(notificationService, "entityManager", entityManager);
    }

    private Notification buildNotification(String id, String title) {
        return Notification.builder()
                .id(id)
                .user(user)
                .type("NEW_FOLLOWER")
                .title(title)
                .body("body")
                .isRead(false)
                .build();
    }

    // ---------- list ----------

    @Test
    void getUserNotifications_mapsToPagedResponse() {
        Query countQuery = mock(Query.class);
        Query listQuery = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(countQuery);
        when(entityManager.createNativeQuery(anyString(), eq(Notification.class))).thenReturn(listQuery);
        when(countQuery.getSingleResult()).thenReturn(2L);
        Notification n1 = buildNotification("n-1", "New Follower");
        Notification n2 = buildNotification("n-2", "New Release");
        when(listQuery.getResultList()).thenReturn(List.of(n1, n2));

        PagedResponse<NotificationResponse> response =
                notificationService.getUserNotifications("user-1", PageRequest.of(0, 20));

        assertThat(response.getContent()).hasSize(2);
        assertThat(response.getContent().get(0).getTitle()).isEqualTo("New Follower");
        assertThat(response.getContent().get(0).isRead()).isFalse();
        assertThat(response.getTotalElements()).isEqualTo(2);
        assertThat(response.getTotalPages()).isEqualTo(1);
        verify(listQuery).setFirstResult(0);
        verify(listQuery).setMaxResults(20);
    }

    @Test
    void getUserNotifications_empty_returnsEmptyPage() {
        Query countQuery = mock(Query.class);
        Query listQuery = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(countQuery);
        when(entityManager.createNativeQuery(anyString(), eq(Notification.class))).thenReturn(listQuery);
        when(countQuery.getSingleResult()).thenReturn(0L);
        when(listQuery.getResultList()).thenReturn(List.of());

        PagedResponse<NotificationResponse> response =
                notificationService.getUserNotifications("user-1", PageRequest.of(0, 20));

        assertThat(response.getContent()).isEmpty();
        assertThat(response.getTotalElements()).isZero();
    }

    // ---------- create ----------

    @Test
    void createNotification_existingUser_savesNotification() {
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));

        notificationService.createNotification("user-1", "NEW_FOLLOWER", "New Follower", "body", "{}");

        verify(notificationRepository).save(argThat(n ->
                n.getUser().getId().equals("user-1")
                        && "NEW_FOLLOWER".equals(n.getType())
                        && !n.isRead()));
    }

    @Test
    void createNotification_unknownUser_throwsRuntimeException() {
        when(userRepository.findById("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> notificationService.createNotification("ghost", "T", "t", "b", "{}"))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("User not found");
        verify(notificationRepository, never()).save(any(Notification.class));
    }

    // ---------- mark read ----------

    @Test
    void markAsRead_ownNotification_marksRead() {
        Notification n = buildNotification("n-1", "New Follower");
        when(notificationRepository.findById("n-1")).thenReturn(Optional.of(n));

        notificationService.markAsRead("n-1", "user-1");

        assertThat(n.isRead()).isTrue();
        verify(notificationRepository).save(n);
    }

    @Test
    void markAsRead_otherUsersNotification_throwsRuntimeException() {
        Notification n = buildNotification("n-1", "New Follower");
        when(notificationRepository.findById("n-1")).thenReturn(Optional.of(n));

        assertThatThrownBy(() -> notificationService.markAsRead("n-1", "other-user"))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("Notification does not belong to user");

        verify(notificationRepository, never()).save(any(Notification.class));
    }

    @Test
    void markAsRead_notFound_throwsRuntimeException() {
        when(notificationRepository.findById("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> notificationService.markAsRead("missing", "user-1"))
                .isInstanceOf(RuntimeException.class)
                .hasMessageContaining("Notification not found");
    }

    @Test
    void markAllAsRead_delegatesToRepository() {
        notificationService.markAllAsRead("user-1");

        verify(notificationRepository).markAllAsRead("user-1");
    }

    // ---------- unread count ----------

    @Test
    void getUnreadCount_delegatesToRepository() {
        when(notificationRepository.countByUserIdAndIsReadFalse("user-1")).thenReturn(3L);

        long count = notificationService.getUnreadCount("user-1");

        assertThat(count).isEqualTo(3);
    }

    // ---------- helpers ----------

    @Test
    void sendNewFollowerNotification_createsFollowerNotification() {
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));

        notificationService.sendNewFollowerNotification("user-1", "bob");

        verify(notificationRepository).save(argThat(n ->
                "NEW_FOLLOWER".equals(n.getType())
                        && n.getTitle().equals("New Follower")
                        && n.getBody().contains("bob")));
    }

    @Test
    void sendNewReleaseNotification_createsOnePerFollower() {
        User follower1 = User.builder().id("f-1").email("f1@example.com").username("f1").build();
        User follower2 = User.builder().id("f-2").email("f2@example.com").username("f2").build();
        when(userRepository.findById("f-1")).thenReturn(Optional.of(follower1));
        when(userRepository.findById("f-2")).thenReturn(Optional.of(follower2));

        notificationService.sendNewReleaseNotification(List.of(follower1, follower2), "Artist", "Album");

        verify(notificationRepository, times(2)).save(any(Notification.class));
        verify(notificationRepository, times(2)).save(argThat(n -> n.getBody().contains("Artist")));
    }

    @Test
    void toNotificationResponse_mapsAllFields() {
        Notification n = buildNotification("n-1", "Title");
        n.setBody("Body");
        n.setDataJson("{}");
        n.setImageUrl("https://img");

        NotificationResponse response = notificationService.toNotificationResponse(n);

        assertThat(response.getId()).isEqualTo("n-1");
        assertThat(response.getTitle()).isEqualTo("Title");
        assertThat(response.getBody()).isEqualTo("Body");
        assertThat(response.getDataJson()).isEqualTo("{}");
        assertThat(response.getImageUrl()).isEqualTo("https://img");
        assertThat(response.isRead()).isFalse();
        assertThat(response.getCreatedAt()).isNull(); // not set on entity
    }
}
