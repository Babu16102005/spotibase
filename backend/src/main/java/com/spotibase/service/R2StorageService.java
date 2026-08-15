package com.spotibase.service;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.paginators.ListObjectsV2Iterable;

import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.UUID;
@Slf4j
@Service
@RequiredArgsConstructor
public class R2StorageService {

    @Value("${r2.account-id}")
    private String accountId;

    @Value("${r2.access-key-id}")
    private String accessKeyId;

    @Value("${r2.secret-access-key}")
    private String secretAccessKey;

    @Value("${r2.bucket-name}")
    private String bucketName;

    @Value("${r2.public-url:}")
    private String publicUrl;

    @Value("${r2.region:auto}")
    private String region;

    @Value("${r2.songs-path:songs}")
    private String songsPath;

    private S3Client s3Client;

    @PostConstruct
    public void init() {
        if (accountId == null || accountId.isBlank() || accessKeyId == null || accessKeyId.isBlank()) {
            log.warn("R2 credentials not configured, R2StorageService will not be available");
            return;
        }

        AwsBasicCredentials credentials = AwsBasicCredentials.create(accessKeyId, secretAccessKey);

        this.s3Client = S3Client.builder()
                .region(Region.of(region))
                .endpointOverride(URI.create("https://" + accountId + ".r2.cloudflarestorage.com"))
                .credentialsProvider(StaticCredentialsProvider.create(credentials))
                .build();

        ensureBucketExists();
    }

    public String uploadSong(MultipartFile file, String artistId) {
        if (s3Client == null) {
            throw new IllegalStateException("R2StorageService not initialized - check R2 configuration");
        }
        validateAudioFile(file);
        String key = songsPath + "/" + artistId + "/" + generateFileName(file);
        uploadFile(file, key);
        return getPublicUrl(key);
    }

    public String getPublicUrl(String key) {
        if (publicUrl != null && !publicUrl.isBlank()) {
            return publicUrl + "/" + key;
        }
        return "https://" + accountId + ".r2.cloudflarestorage.com/" + bucketName + "/" + key;
    }

    public void deleteFile(String keyOrUrl) {
        if (s3Client == null || keyOrUrl == null || keyOrUrl.isBlank()) return;
        String key = resolveKey(keyOrUrl);
        if (key == null || key.isBlank()) return;
        try {
            s3Client.deleteObject(DeleteObjectRequest.builder()
                    .bucket(bucketName)
                    .key(key)
                    .build());
            invalidateStorageCache();
            log.info("File deleted from R2: {}", key);
        } catch (Exception e) {
            log.error("Failed to delete file from R2: {}", e.getMessage());
        }
    }

    public void deleteFileByUrl(String fileUrl) {
        deleteFile(fileUrl);
    }

    /**
     * Deletes ALL objects in the Cloudflare R2 bucket, resetting storage to 0 MB.
     */
    public void clearEntireBucket() {
        if (s3Client == null) return;
        try {
            ListObjectsV2Request request = ListObjectsV2Request.builder()
                    .bucket(bucketName)
                    .build();
            ListObjectsV2Iterable response = s3Client.listObjectsV2Paginator(request);
            for (ListObjectsV2Response page : response) {
                for (S3Object object : page.contents()) {
                    try {
                        s3Client.deleteObject(DeleteObjectRequest.builder()
                                .bucket(bucketName)
                                .key(object.key())
                                .build());
                        log.info("Purged R2 object: {}", object.key());
                    } catch (Exception e) {
                        log.error("Failed to delete R2 object {}: {}", object.key(), e.getMessage());
                    }
                }
            }
            invalidateStorageCache();
            log.info("Cloudflare R2 bucket '{}' successfully cleared to 0 MB", bucketName);
        } catch (Exception e) {
            log.error("Failed to clear R2 bucket '{}': {}", bucketName, e.getMessage());
        }
    }

    private void uploadFile(MultipartFile file, String key) {
        try {
            PutObjectRequest request = PutObjectRequest.builder()
                    .bucket(bucketName)
                    .key(key)
                    .contentType(file.getContentType())
                    .contentLength(file.getSize())
                    .build();

            s3Client.putObject(request, RequestBody.fromBytes(file.getBytes()));
            invalidateStorageCache();
            log.info("File uploaded to R2: {}", key);
        } catch (IOException e) {
            throw new RuntimeException("Failed to read file", e);
        } catch (S3Exception e) {
            throw new RuntimeException("R2 upload failed: " + e.awsErrorDetails().errorMessage());
        }
    }

    private void ensureBucketExists() {
        try {
            s3Client.headBucket(HeadBucketRequest.builder().bucket(bucketName).build());
        } catch (NoSuchBucketException e) {
            s3Client.createBucket(CreateBucketRequest.builder().bucket(bucketName).build());
            log.info("R2 bucket created: {}", bucketName);
        } catch (Exception ex) {
            log.warn("Could not verify/create R2 bucket: {}", ex.getMessage());
        }
    }

    private void validateAudioFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Audio file is required");
        }
        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("audio/")) {
            throw new IllegalArgumentException("Invalid audio file type");
        }
        if (file.getSize() > 250 * 1024 * 1024) {
            throw new IllegalArgumentException("Audio file exceeds maximum size of 250MB");
        }
    }

    private String generateFileName(MultipartFile file) {
        String originalName = file.getOriginalFilename();
        String extension = "";
        if (originalName != null && originalName.contains(".")) {
            extension = originalName.substring(originalName.lastIndexOf("."));
        }
        return UUID.randomUUID().toString() + extension;
    }

    public boolean isAvailable() {
        return s3Client != null;
    }

    /** Returns the configured bucket name (used by the orphan cleanup scheduler). */
    public String getBucketName() {
        return bucketName;
    }

    /**
     * Delegates an arbitrary ListObjectsV2Request to the underlying S3 client.
     * Used by {@link com.spotibase.service.OrphanStorageCleanupScheduler}.
     */
    public ListObjectsV2Iterable listObjects(ListObjectsV2Request request) {
        if (s3Client == null) {
            throw new IllegalStateException("R2StorageService not initialized - check R2 configuration");
        }
        return s3Client.listObjectsV2Paginator(request);
    }

    private volatile long cachedStorageBytes = -1L;
    private volatile long lastStorageCheckTime = 0L;
    private static final long STORAGE_CACHE_TTL_MS = 5_000L; // 5s short cache for instant live sync

    public void invalidateStorageCache() {
        this.cachedStorageBytes = -1L;
    }

    public record R2StorageStats(long totalBytes, int objectCount, boolean connected, String bucketName) {}

    public R2StorageStats getLiveDirectStorageStats() {
        if (s3Client == null) {
            return new R2StorageStats(0L, 0, false, bucketName != null ? bucketName : "spotibase-songs");
        }
        try {
            long totalBytes = 0L;
            int count = 0;
            ListObjectsV2Request request = ListObjectsV2Request.builder()
                    .bucket(bucketName)
                    .build();
            ListObjectsV2Iterable response = s3Client.listObjectsV2Paginator(request);
            for (ListObjectsV2Response page : response) {
                for (S3Object object : page.contents()) {
                    if (object.size() != null) {
                        totalBytes += object.size();
                    }
                    count++;
                }
            }
            cachedStorageBytes = totalBytes;
            lastStorageCheckTime = System.currentTimeMillis();
            return new R2StorageStats(totalBytes, count, true, bucketName);
        } catch (Exception e) {
            log.error("Failed to query live R2 bucket stats: {}", e.getMessage());
            return new R2StorageStats(cachedStorageBytes >= 0 ? cachedStorageBytes : 0L, 0, false, bucketName);
        }
    }

    /**
     * Calculates total storage used in Cloudflare R2 with a 5s memory cache for instant live sync.
     */
    public long getTotalStorageUsedBytes() {
        if (s3Client == null) {
            return 0L;
        }
        long now = System.currentTimeMillis();
        if (cachedStorageBytes >= 0 && (now - lastStorageCheckTime) < STORAGE_CACHE_TTL_MS) {
            return cachedStorageBytes;
        }
        return getLiveDirectStorageStats().totalBytes();
    }

    // ---- Range streaming (proxy mode) ---------------------------------

    public record R2ObjectStream(ResponseInputStream<GetObjectResponse> stream,
                                 long objectSize,
                                 long start,
                                 long end,
                                 String contentType) {

        public boolean isPartial() {
            return start > 0 || end < objectSize - 1;
        }
    }

    /**
     * Reads an object (optionally a byte range) from R2 so the backend can
     * proxy it with Range + CORS headers. r2.dev public URLs send no CORS
     * headers, so browsers cannot consume a direct redirect.
     */
    public R2ObjectStream readRange(String key, String rangeHeader) {
        if (s3Client == null) {
            throw new IllegalStateException("R2StorageService not initialized - check R2 configuration");
        }
        GetObjectRequest.Builder builder = GetObjectRequest.builder()
                .bucket(bucketName)
                .key(key);

        long start = 0;
        long end = -1;
        if (rangeHeader != null && rangeHeader.startsWith("bytes=")) {
            String spec = rangeHeader.substring("bytes=".length()).trim();
            int dash = spec.indexOf('-');
            if (dash > 0) {
                start = Long.parseLong(spec.substring(0, dash).trim());
                String endPart = spec.substring(dash + 1).trim();
                if (!endPart.isEmpty()) {
                    end = Long.parseLong(endPart);
                }
                builder.range("bytes=" + start + "-" + (end >= 0 ? end : ""));
            }
        }

        ResponseInputStream<GetObjectResponse> response = s3Client.getObject(builder.build());

        // Content-Range header from R2 looks like "bytes 0-99/31976252"
        long objectSize = response.response().contentLength();
        String contentRange = response.response().contentRange();
        if (contentRange != null && contentRange.startsWith("bytes ")) {
            String body = contentRange.substring("bytes ".length());
            int slash = body.indexOf('/');
            String rangePart = slash >= 0 ? body.substring(0, slash) : body;
            objectSize = Long.parseLong(body.substring(slash + 1));
            int dash = rangePart.indexOf('-');
            if (dash >= 0) {
                start = Long.parseLong(rangePart.substring(0, dash));
                end = Long.parseLong(rangePart.substring(dash + 1));
            }
        }
        if (end < 0) {
            end = objectSize - 1;
        }

        return new R2ObjectStream(response, objectSize, start, end,
                response.response().contentType() != null ? response.response().contentType() : "application/octet-stream");
    }

    public record R2ObjectInfo(long size, String contentType) {}

    public R2ObjectInfo headObject(String key) {
        if (s3Client == null) {
            throw new IllegalStateException("R2StorageService not initialized - check R2 configuration");
        }
        HeadObjectResponse response = s3Client.headObject(HeadObjectRequest.builder()
                .bucket(bucketName)
                .key(key)
                .build());
        return new R2ObjectInfo(response.contentLength(),
                response.contentType() != null ? response.contentType() : "application/octet-stream");
    }

    /**
     * Converts a stored public URL back to the object key. Handles both the
     * configured public URL prefix and the S3 API endpoint form.
     */
    public String resolveKey(String fileUrl) {
        if (fileUrl == null || fileUrl.isBlank()) {
            return null;
        }
        String cleanUrl = fileUrl.trim();
        int queryIdx = cleanUrl.indexOf('?');
        if (queryIdx != -1) {
            cleanUrl = cleanUrl.substring(0, queryIdx);
        }

        if (publicUrl != null && !publicUrl.isBlank() && cleanUrl.startsWith(publicUrl)) {
            return cleanUrl.substring(publicUrl.length()).replaceFirst("^/+", "");
        }
        String endpointPrefix = "https://" + accountId + ".r2.cloudflarestorage.com/" + bucketName + "/";
        if (cleanUrl.startsWith(endpointPrefix)) {
            return cleanUrl.substring(endpointPrefix.length());
        }

        // If cleanUrl is an absolute HTTP/HTTPS URL, find path relative to known prefixes
        if (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://")) {
            for (String prefix : List.of("songs/", "covers/", "avatars/")) {
                int idx = cleanUrl.indexOf("/" + prefix);
                if (idx != -1) {
                    return cleanUrl.substring(idx + 1);
                }
                if (cleanUrl.contains(prefix)) {
                    int prefixIdx = cleanUrl.indexOf(prefix);
                    return cleanUrl.substring(prefixIdx);
                }
            }
            try {
                java.net.URI uri = java.net.URI.create(cleanUrl);
                String path = uri.getPath();
                if (path != null) {
                    path = path.replaceFirst("^/+", "");
                    if (bucketName != null && path.startsWith(bucketName + "/")) {
                        path = path.substring(bucketName.length() + 1);
                    }
                    return path;
                }
            } catch (Exception ignored) {}
        }

        // Already a bare key
        return cleanUrl.replaceFirst("^/+", "");
    }
}