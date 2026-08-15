package com.spotibase.service;

import com.spotibase.repository.SongRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Response;
import software.amazon.awssdk.services.s3.model.S3Object;
import software.amazon.awssdk.services.s3.paginators.ListObjectsV2Iterable;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/**
 * Scans Cloudflare R2 daily for audio objects that were uploaded but have no
 * corresponding active song record in the database (orphans produced by
 * interrupted / failed uploads). Objects younger than 2 hours are skipped
 * (in-flight uploads). Confirmed orphans are deleted from R2 so they no
 * longer inflate the storage usage counter.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OrphanStorageCleanupScheduler {

    private final R2StorageService r2StorageService;
    private final SongRepository songRepository;
    private final StorageService storageService;

    /** Minimum age an object must be before we consider it an orphan (safety buffer). */
    private static final long ORPHAN_AGE_HOURS = 2;

    /** Prefix within the R2 bucket that holds song audio files. */
    private static final String SONGS_PREFIX = "songs/";

    /**
     * Runs once a day at 03:00 server time (adjust cron as needed).
     */
    @Scheduled(cron = "0 0 3 * * *")
    public void purgeOrphanedStorageObjects() {
        purgeOrphanedStorageObjects(false);
    }

    public void purgeOrphanedStorageObjects(boolean forceAll) {
        if (!r2StorageService.isAvailable()) {
            log.debug("OrphanStorageCleanupScheduler: R2 not configured, skipping.");
            return;
        }

        log.info("OrphanStorageCleanupScheduler: starting orphan scan (forceAll={})...", forceAll);

        Instant cutoff = forceAll ? Instant.now() : Instant.now().minus(ORPHAN_AGE_HOURS, ChronoUnit.HOURS);
        List<String> orphanKeys = new ArrayList<>();

        try {
            ListObjectsV2Request req = ListObjectsV2Request.builder()
                    .bucket(getBucketName())
                    .prefix(SONGS_PREFIX)
                    .build();

            ListObjectsV2Iterable pages = r2StorageService.listObjects(req);
            for (ListObjectsV2Response page : pages) {
                for (S3Object obj : page.contents()) {
                    // Skip recent objects unless forceAll is true
                    if (!forceAll && obj.lastModified() != null && obj.lastModified().isAfter(cutoff)) {
                        continue;
                    }
                    String key = obj.key();
                    String publicUrl = r2StorageService.getPublicUrl(key);

                    // Check if any active song references this URL
                    boolean hasRecord = songRepository.existsByFileUrlAndArchivedFalse(publicUrl);
                    if (!hasRecord) {
                        orphanKeys.add(key);
                    }
                }
            }
        } catch (Exception ex) {
            log.error("OrphanStorageCleanupScheduler: failed to list R2 objects: {}", ex.getMessage());
            return;
        }

        if (orphanKeys.isEmpty()) {
            log.info("OrphanStorageCleanupScheduler: no orphans found.");
            return;
        }

        log.warn("OrphanStorageCleanupScheduler: found {} orphaned object(s), deleting...", orphanKeys.size());
        int deleted = 0;
        for (String key : orphanKeys) {
            try {
                r2StorageService.deleteFile(key);
                deleted++;
                log.info("  Deleted orphan: {}", key);
            } catch (Exception ex) {
                log.error("  Failed to delete orphan '{}': {}", key, ex.getMessage());
            }
        }
        r2StorageService.invalidateStorageCache();
        log.info("OrphanStorageCleanupScheduler: deleted {}/{} orphan(s).", deleted, orphanKeys.size());
    }

    /** Expose the private bucket name via R2StorageService through a public getter. */
    private String getBucketName() {
        // R2StorageService.listObjects accepts a pre-built request that includes the bucket name,
        // so we resolve it via the already-configured service. Bucket name is package-private
        // and injected by Spring from ${r2.bucket-name}, so we use a delegating call here.
        return r2StorageService.getBucketName();
    }
}
