package com.spotibase.service;

import com.spotibase.dto.response.QueueResponse;
import com.spotibase.entity.Artist;
import com.spotibase.entity.Queue;
import com.spotibase.entity.Song;
import com.spotibase.entity.User;
import com.spotibase.exception.BadRequestException;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.exception.UnauthorizedException;
import com.spotibase.repository.QueueRepository;
import com.spotibase.repository.SongRepository;
import com.spotibase.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Unit tests for {@link QueueService}.
 */
@ExtendWith(MockitoExtension.class)
class QueueServiceTest {

    @Mock
    private QueueRepository queueRepository;
    @Mock
    private SongRepository songRepository;
    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private QueueService queueService;

    private User user;
    private Artist artist;

    @BeforeEach
    void setUp() {
        user = User.builder().id("user-1").email("u@example.com").username("user-1").build();
        artist = Artist.builder().id("artist-1").name("The Band").build();
    }

    private Song buildSong(String id, String name, long durationMs) {
        return Song.builder()
                .id(id)
                .name(name)
                .artist(artist)
                .durationMs(durationMs)
                .releaseDate(LocalDate.of(2024, 1, 1))
                .build();
    }

    private Queue buildQueueItem(String id, String songId, int position, boolean played) {
        return Queue.builder()
                .id(id)
                .user(user)
                .songId(songId)
                .position(position)
                .source("QUEUE")
                .played(played)
                .build();
    }

    // ---------- getQueue ----------

    @Test
    void getQueue_emptyQueue_returnsEmptyResponse() {
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1")).thenReturn(List.of());

        QueueResponse response = queueService.getQueue("user-1");

        assertThat(response.getSongs()).isEmpty();
        assertThat(response.getCurrentSong()).isNull();
        assertThat(response.getCurrentPosition()).isZero();
        assertThat(response.getTotalSongs()).isZero();
        assertThat(response.getTotalDurationMs()).isZero();
    }

    @Test
    void getQueue_withUnplayedItems_returnsCurrentAndTotalDuration() {
        Song song1 = buildSong("song-1", "First", 100000);
        Song song2 = buildSong("song-2", "Second", 200000);
        Queue q1 = buildQueueItem("q-1", "song-1", 0, false);
        Queue q2 = buildQueueItem("q-2", "song-2", 1, false);
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1")).thenReturn(List.of(q1, q2));
        when(songRepository.findByIds(List.of("song-1", "song-2"))).thenReturn(List.of(song1, song2));
        when(songRepository.existsByUserIdAndSongId("user-1", "song-1")).thenReturn(false);
        when(songRepository.existsByUserIdAndSongId("user-1", "song-2")).thenReturn(false);

        QueueResponse response = queueService.getQueue("user-1");

        assertThat(response.getSongs()).hasSize(2);
        assertThat(response.getCurrentSong().getId()).isEqualTo("song-1");
        assertThat(response.getTotalSongs()).isEqualTo(2);
        assertThat(response.getTotalDurationMs()).isEqualTo(300000);
    }

    @Test
    void getQueue_excludesPlayedItemsFromCount() {
        Song song1 = buildSong("song-1", "First", 100000);
        Queue played = buildQueueItem("q-1", "song-1", 0, true);
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1")).thenReturn(List.of(played));

        QueueResponse response = queueService.getQueue("user-1");

        assertThat(response.getSongs()).isEmpty();
        assertThat(response.getTotalSongs()).isZero();
    }

    @Test
    void getQueue_missingSongInLibrary_skipsItFromResponse() {
        Queue q1 = buildQueueItem("q-1", "ghost-song", 0, false);
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1")).thenReturn(List.of(q1));
        when(songRepository.findByIds(List.of("ghost-song"))).thenReturn(List.of());

        QueueResponse response = queueService.getQueue("user-1");

        assertThat(response.getSongs()).isEmpty();
        assertThat(response.getTotalSongs()).isEqualTo(1); // raw count still reported
    }

    // ---------- addToQueue ----------

    @Test
    void addToQueue_appendsAtEndWhenQueueEmpty() {
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(songRepository.findById("song-1")).thenReturn(Optional.of(buildSong("song-1", "S", 1000)));
        when(queueRepository.findMaxPositionByUserId("user-1")).thenReturn(null);
        when(userRepository.getReferenceById("user-1")).thenReturn(user);

        queueService.addToQueue("user-1", "song-1", "SEARCH");

        verify(queueRepository).save(argThat(q ->
                q.getSongId().equals("song-1")
                        && q.getPosition() == 0
                        && "SEARCH".equals(q.getSource())
                        && !q.isPlayed()));
    }

    @Test
    void addToQueue_appendsAfterExistingMaxPosition() {
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(songRepository.findById("song-1")).thenReturn(Optional.of(buildSong("song-1", "S", 1000)));
        when(queueRepository.findMaxPositionByUserId("user-1")).thenReturn(4);
        when(userRepository.getReferenceById("user-1")).thenReturn(user);

        queueService.addToQueue("user-1", "song-1", "QUEUE");

        verify(queueRepository).save(argThat(q -> q.getPosition() == 5));
    }

    @Test
    void addToQueue_userNotFound_throwsResourceNotFoundException() {
        when(userRepository.findById("ghost")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> queueService.addToQueue("ghost", "song-1", "QUEUE"))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(queueRepository, never()).save(any(Queue.class));
    }

    @Test
    void addToQueue_songNotFound_throwsResourceNotFoundException() {
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(songRepository.findById("ghost-song")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> queueService.addToQueue("user-1", "ghost-song", "QUEUE"))
                .isInstanceOf(ResourceNotFoundException.class);
        verify(queueRepository, never()).save(any(Queue.class));
    }

    // ---------- playNext ----------

    @Test
    void playNext_insertsAfterCurrentUnplayedItemAndShiftsOthers() {
        Queue q1 = buildQueueItem("q-1", "song-1", 0, false);
        Queue q2 = buildQueueItem("q-2", "song-2", 1, false);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(songRepository.findById("song-9")).thenReturn(Optional.of(buildSong("song-9", "Next", 1000)));
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1")).thenReturn(List.of(q1, q2));
        when(userRepository.getReferenceById("user-1")).thenReturn(user);

        queueService.playNext("user-1", "song-9", "PLAYLIST");

        // q2 shifted from 1 to 2, new item at position 1
        assertThat(q2.getPosition()).isEqualTo(2);
        verify(queueRepository).save(q2);
        verify(queueRepository).save(argThat(q ->
                q.getSongId().equals("song-9") && q.getPosition() == 1));
    }

    @Test
    void playNext_allPlayed_insertsAtPositionZero() {
        Queue played = buildQueueItem("q-1", "song-1", 0, true);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(songRepository.findById("song-9")).thenReturn(Optional.of(buildSong("song-9", "Next", 1000)));
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1")).thenReturn(List.of(played));
        when(userRepository.getReferenceById("user-1")).thenReturn(user);

        queueService.playNext("user-1", "song-9", "QUEUE");

        verify(queueRepository).save(argThat(q ->
                q.getSongId().equals("song-9") && q.getPosition() == 0));
    }

    // ---------- removeFromQueue ----------

    @Test
    void removeFromQueue_ownerDeletesAndReindexes() {
        Queue q1 = buildQueueItem("q-1", "song-1", 0, false);
        Queue q2 = buildQueueItem("q-2", "song-2", 1, false);
        when(queueRepository.findById("q-1")).thenReturn(Optional.of(q1));
        // After deletion the repository only contains q2
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1")).thenReturn(List.of(q2));

        queueService.removeFromQueue("q-1", "user-1");

        verify(queueRepository).delete(q1);
        // reindex: q2 goes from 1 to 0
        assertThat(q2.getPosition()).isZero();
        verify(queueRepository).save(q2);
    }

    @Test
    void removeFromQueue_notFound_throwsResourceNotFoundException() {
        when(queueRepository.findById("missing")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> queueService.removeFromQueue("missing", "user-1"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void removeFromQueue_otherUser_throwsUnauthorizedException() {
        User other = User.builder().id("other-1").email("o@example.com").username("other").build();
        Queue q1 = buildQueueItem("q-1", "song-1", 0, false);
        q1.setUser(other);
        when(queueRepository.findById("q-1")).thenReturn(Optional.of(q1));

        assertThatThrownBy(() -> queueService.removeFromQueue("q-1", "user-1"))
                .isInstanceOf(UnauthorizedException.class);
    }

    // ---------- moveInQueue ----------

    @Test
    void moveInQueue_validPosition_movesAndReindexes() {
        Queue q1 = buildQueueItem("q-1", "song-1", 0, false);
        Queue q2 = buildQueueItem("q-2", "song-2", 1, false);
        Queue q3 = buildQueueItem("q-3", "song-3", 2, false);
        when(queueRepository.findById("q-1")).thenReturn(Optional.of(q1));
        // First call: current state. Second call (reindex): shifted order as returned by the DB.
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1"))
                .thenReturn(List.of(q1, q2, q3), List.of(q2, q3, q1));

        queueService.moveInQueue("q-1", 2, "user-1");

        assertThat(q1.getPosition()).isEqualTo(2);
        assertThat(q2.getPosition()).isZero();
        assertThat(q3.getPosition()).isEqualTo(1);
    }

    @Test
    void moveInQueue_negativePosition_throwsBadRequestException() {
        Queue q1 = buildQueueItem("q-1", "song-1", 0, false);
        when(queueRepository.findById("q-1")).thenReturn(Optional.of(q1));
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1")).thenReturn(List.of(q1));

        assertThatThrownBy(() -> queueService.moveInQueue("q-1", -1, "user-1"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("Invalid position");
    }

    @Test
    void moveInQueue_positionBeyondSize_throwsBadRequestException() {
        Queue q1 = buildQueueItem("q-1", "song-1", 0, false);
        when(queueRepository.findById("q-1")).thenReturn(Optional.of(q1));
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1")).thenReturn(List.of(q1));

        assertThatThrownBy(() -> queueService.moveInQueue("q-1", 5, "user-1"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void moveInQueue_movingDown_shiftsItemsBetweenPositions() {
        Queue q1 = buildQueueItem("q-1", "song-1", 0, false);
        Queue q2 = buildQueueItem("q-2", "song-2", 1, false);
        Queue q3 = buildQueueItem("q-3", "song-3", 2, false);
        when(queueRepository.findById("q-3")).thenReturn(Optional.of(q3));
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1"))
                .thenReturn(List.of(q1, q2, q3), List.of(q3, q1, q2));

        queueService.moveInQueue("q-3", 0, "user-1");

        assertThat(q3.getPosition()).isZero();
        assertThat(q1.getPosition()).isEqualTo(1);
        assertThat(q2.getPosition()).isEqualTo(2);
    }

    // ---------- clear / save / restore / markAsPlayed ----------

    @Test
    void clearQueue_deletesAllUserItems() {
        queueService.clearQueue("user-1");

        verify(queueRepository).deleteAllByUserId("user-1");
    }

    @Test
    void saveQueue_isNoOp() {
        queueService.saveQueue("user-1");

        verifyNoInteractions(queueRepository, songRepository, userRepository);
    }

    @Test
    void restoreQueue_returnsCurrentQueueState() {
        when(queueRepository.findByUserIdOrderByPositionAsc("user-1")).thenReturn(List.of());

        QueueResponse response = queueService.restoreQueue("user-1");

        assertThat(response.getTotalSongs()).isZero();
    }

    @Test
    void markAsPlayed_setsPlayedFlag() {
        Queue q1 = buildQueueItem("q-1", "song-1", 0, false);
        when(queueRepository.findById("q-1")).thenReturn(Optional.of(q1));

        queueService.markAsPlayed("q-1", "user-1");

        assertThat(q1.isPlayed()).isTrue();
        verify(queueRepository).save(q1);
    }

    @Test
    void markAsPlayed_otherUser_throwsUnauthorizedException() {
        User other = User.builder().id("other-1").email("o@example.com").username("other").build();
        Queue q1 = buildQueueItem("q-1", "song-1", 0, false);
        q1.setUser(other);
        when(queueRepository.findById("q-1")).thenReturn(Optional.of(q1));

        assertThatThrownBy(() -> queueService.markAsPlayed("q-1", "user-1"))
                .isInstanceOf(UnauthorizedException.class);
    }
}
