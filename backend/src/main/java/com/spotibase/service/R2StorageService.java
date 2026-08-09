package com.spotibase.service;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;

import java.io.IOException;
import java.net.URI;
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

    public void deleteFile(String key) {
        if (s3Client == null) return;
        try {
            s3Client.deleteObject(DeleteObjectRequest.builder()
                    .bucket(bucketName)
                    .key(key)
                    .build());
            log.info("File deleted from R2: {}", key);
        } catch (Exception e) {
            log.error("Failed to delete file from R2: {}", e.getMessage());
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
        if (file.getSize() > 50 * 1024 * 1024) {
            throw new IllegalArgumentException("Audio file exceeds maximum size of 50MB");
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
}