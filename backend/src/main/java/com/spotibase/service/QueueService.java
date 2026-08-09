package com.spotibase.service;

import com.spotibase.dto.response.QueueResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.Queue;
import com.spotibase.entity.Song;
import com.spotibase.entity.User;
import com.spotibase.exception.BadRequestException;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.exception.UnauthorizedException;
import com.spotibase.repository.QueueRepository;
import com.spotibase.repository.SongRepository;
import com.spotibase.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
@Transactional
public class QueueService {

    private final QueueRepository queueRepository;
    private final SongRepository songRepository;
    private final UserRepository userRepository;

    @Transactional(readOnly = true)
    public QueueResponse getQueue(String userId) {
        return toQueueResponse(userId);
    }

    public void addToQueue(String userId, String songId, String source) {
        userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));
        songRepository.findById(songId)
                .orElseThrow(() -> new ResourceNotFoundException("Song", songId));

        int maxPos = queueRepository.findMaxPositionByUserId(userId) != null
                ? queueRepository.findMaxPositionByUserId(userId) : -1;

        User userRef = userRepository.getReferenceById(userId);
        Queue queueItem = Queue.builder()
                .user(userRef)
                .songId(songId)
                .position(maxPos + 1)
                .source(source)
                .played(false)
                .build();
        queueRepository.save(queueItem);
        log.info("Song {} added to queue end for user {}", songId, userId);
    }

    public void playNext(String userId, String songId, String source) {
        userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("User", userId));
        songRepository.findById(songId)
                .orElseThrow(() -> new ResourceNotFoundException("Song", songId));

        List<Queue> queueItems = queueRepository.findByUserIdOrderByPositionAsc(userId);
        int currentPosition = queueItems.stream()
                .filter(q -> !q.isPlayed())
                .findFirst()
                .map(Queue::getPosition)
                .orElse(-1);

        for (Queue q : queueItems) {
            if (q.getPosition() > currentPosition) {
                q.setPosition(q.getPosition() + 1);
                queueRepository.save(q);
            }
        }

        User userRef = userRepository.getReferenceById(userId);
        Queue queueItem = Queue.builder()
                .user(userRef)
                .songId(songId)
                .position(currentPosition + 1)
                .source(source)
                .played(false)
                .build();
        queueRepository.save(queueItem);
        log.info("Song {} set to play next for user {}", songId, userId);
    }

    public void removeFromQueue(String queueId, String userId) {
        Queue queueItem = queueRepository.findById(queueId)
                .orElseThrow(() -> new ResourceNotFoundException("Queue item", queueId));
        validateQueueOwnership(queueItem, userId);
        queueRepository.delete(queueItem);
        reindexQueue(userId);
        log.info("Queue item {} removed for user {}", queueId, userId);
    }

    public void moveInQueue(String queueId, int newPosition, String userId) {
        Queue queueItem = queueRepository.findById(queueId)
                .orElseThrow(() -> new ResourceNotFoundException("Queue item", queueId));
        validateQueueOwnership(queueItem, userId);

        List<Queue> queueItems = queueRepository.findByUserIdOrderByPositionAsc(userId);
        if (newPosition < 0 || newPosition >= queueItems.size()) {
            throw new BadRequestException("Invalid position: " + newPosition);
        }

        int oldPosition = queueItem.getPosition();
        if (newPosition > oldPosition) {
            for (Queue q : queueItems) {
                if (q.getPosition() > oldPosition && q.getPosition() <= newPosition) {
                    q.setPosition(q.getPosition() - 1);
                    queueRepository.save(q);
                }
            }
        } else if (newPosition < oldPosition) {
            for (Queue q : queueItems) {
                if (q.getPosition() >= newPosition && q.getPosition() < oldPosition) {
                    q.setPosition(q.getPosition() + 1);
                    queueRepository.save(q);
                }
            }
        }

        queueItem.setPosition(newPosition);
        queueRepository.save(queueItem);
        reindexQueue(userId);
        log.info("Queue item {} moved to position {} for user {}", queueId, newPosition, userId);
    }

    public void clearQueue(String userId) {
        queueRepository.deleteAllByUserId(userId);
        log.info("Queue cleared for user {}", userId);
    }

    public void saveQueue(String userId) {
        log.info("Queue state saved for user {}", userId);
    }

    @Transactional(readOnly = true)
    public QueueResponse restoreQueue(String userId) {
        log.info("Queue state restored for user {}", userId);
        return toQueueResponse(userId);
    }

    public void markAsPlayed(String queueId, String userId) {
        Queue queueItem = queueRepository.findById(queueId)
                .orElseThrow(() -> new ResourceNotFoundException("Queue item", queueId));
        validateQueueOwnership(queueItem, userId);
        queueItem.setPlayed(true);
        queueRepository.save(queueItem);
        log.info("Queue item {} marked as played for user {}", queueId, userId);
    }

    private QueueResponse toQueueResponse(String userId) {
        List<Queue> allItems = queueRepository.findByUserIdOrderByPositionAsc(userId);
        List<Queue> unplayed = allItems.stream()
                .filter(q -> !q.isPlayed())
                .collect(Collectors.toList());

        if (unplayed.isEmpty()) {
            return QueueResponse.builder()
                    .songs(List.of())
                    .currentSong(null)
                    .currentPosition(0)
                    .totalSongs(0)
                    .totalDurationMs(0)
                    .build();
        }

        Queue current = unplayed.get(0);
        List<String> allSongIds = unplayed.stream()
                .map(Queue::getSongId)
                .collect(Collectors.toList());

        List<Song> songs = songRepository.findByIds(allSongIds);
        Map<String, Song> songMap = songs.stream()
                .collect(Collectors.toMap(Song::getId, Function.identity()));

        Song currentSong = songMap.get(current.getSongId());
        List<SongResponse> songResponses = unplayed.stream()
                .map(q -> songMap.get(q.getSongId()))
                .filter(Objects::nonNull)
                .map(song -> toSongResponse(song, userId))
                .collect(Collectors.toList());

        long totalDurationMs = songs.stream().mapToLong(Song::getDurationMs).sum();

        return QueueResponse.builder()
                .songs(songResponses)
                .currentSong(currentSong != null ? toSongResponse(currentSong, userId) : null)
                .currentPosition(0)
                .totalSongs(unplayed.size())
                .totalDurationMs(totalDurationMs)
                .build();
    }

    private SongResponse toSongResponse(Song song, String userId) {
        SongResponse.SongResponseBuilder builder = SongResponse.builder()
                .id(song.getId())
                .title(song.getName())
                .artistId(song.getArtist().getId())
                .artistName(song.getArtist().getName())
                .language(song.getLanguage())
                .composer(song.getComposer())
                .lyrics(song.getLyrics())
                .duration(song.getDuration())
                .durationMs(song.getDurationMs())
                .releaseDate(song.getReleaseDate())
                .trackNumber(song.getTrackNumber())
                .discNumber(song.getDiscNumber())
                .fileUrl(song.getFileUrl())
                .coverUrl(song.getCoverUrl() != null ? song.getCoverUrl() :
                        (song.getAlbum() != null ? song.getAlbum().getCoverUrl() : null))
                .fileFormat(song.getFileFormat())
                .fileSize(song.getFileSize())
                .bitrate(song.getBitrate())
                .sampleRate(song.getSampleRate())
                .explicit(song.isExplicit())
                .archived(song.isArchived())
                .featured(song.isFeatured())
                .playCount(song.getPlayCount())
                .createdAt(song.getCreatedAt());

        if (song.getAlbum() != null) {
            builder.albumId(song.getAlbum().getId());
            builder.albumName(song.getAlbum().getName());
        }
        if (song.getGenre() != null) {
            builder.genreId(song.getGenre().getId());
            builder.genreName(song.getGenre().getName());
        }
        if (userId != null) {
            builder.liked(songRepository.existsByUserIdAndSongId(userId, song.getId()));
        }

        return builder.build();
    }

    private void validateQueueOwnership(Queue queueItem, String userId) {
        if (!queueItem.getUser().getId().equals(userId)) {
            throw new UnauthorizedException("You do not have permission to modify this queue item");
        }
    }

    private void reindexQueue(String userId) {
        List<Queue> queueItems = queueRepository.findByUserIdOrderByPositionAsc(userId);
        for (int i = 0; i < queueItems.size(); i++) {
            queueItems.get(i).setPosition(i);
            queueRepository.save(queueItems.get(i));
        }
    }
}
