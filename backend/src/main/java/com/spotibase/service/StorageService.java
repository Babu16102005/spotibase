package com.spotibase.service;

import com.spotibase.exception.BadRequestException;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;

import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class StorageService {

    private final RestTemplate restTemplate;

    @Value("${supabase.url}")
    private String supabaseUrl;

    @Value("${supabase.service-role-key}")
    private String serviceRoleKey;

    @Value("${supabase.storage.bucket}")
    private String bucketName;

    @Value("${supabase.storage.covers-path}")
    private String coversPath;

    @Value("${supabase.storage.avatars-path}")
    private String avatarsPath;

    public static final long MAX_FREE_TIER_BYTES = 10L * 1024 * 1024 * 1024; // 10 GB
    public static final long RESTRICTION_THRESHOLD_BYTES = (long) (9.5 * 1024 * 1024 * 1024); // 9.5 GB

    @Autowired(required = false)
    private com.spotibase.repository.SongRepository songRepository;

    // Optional R2 storage for songs
    @Autowired(required = false)
    private R2StorageService r2StorageService;

    @PostConstruct
    public void init() {
        ensureBucketExists();
    }

    public long getLiveTotalStorageUsedBytes() {
        if (r2StorageService != null && r2StorageService.isAvailable()) {
            try {
                return r2StorageService.getTotalStorageUsedBytes();
            } catch (Exception e) {
                log.warn("Could not retrieve R2 live total storage: {}", e.getMessage());
            }
        }
        return songRepository != null ? songRepository.totalStorageUsedBytes() : 0L;
    }

    public R2StorageService.R2StorageStats getLiveStorageStats() {
        if (r2StorageService != null && r2StorageService.isAvailable()) {
            return r2StorageService.getLiveDirectStorageStats();
        }
        long dbBytes = songRepository != null ? songRepository.totalStorageUsedBytes() : 0L;
        long activeSongs = songRepository != null ? songRepository.countActiveSongs() : 0L;
        return new R2StorageService.R2StorageStats(dbBytes, (int) activeSongs, false, "Local/DB");
    }

    public void invalidateStorageCache() {
        if (r2StorageService != null && r2StorageService.isAvailable()) {
            r2StorageService.invalidateStorageCache();
        }
    }

    public void clearAllR2Storage() {
        if (r2StorageService != null && r2StorageService.isAvailable()) {
            r2StorageService.clearEntireBucket();
        }
        invalidateStorageCache();
    }

    public void validateStorageCapacity(long incomingFileSizeBytes) {
        long currentUsage = getLiveTotalStorageUsedBytes();
        if ((currentUsage + incomingFileSizeBytes) >= RESTRICTION_THRESHOLD_BYTES) {
            double usedGb = (double) currentUsage / (1024.0 * 1024.0 * 1024.0);
            throw new BadRequestException(String.format(
                    "Storage limit reached: Current storage usage (%.2f GB) exceeds 9.5 GB safety cap of Cloudflare R2 / Supabase 10 GB free tier. Uploads are restricted above 9.5 GB.",
                    usedGb
            ));
        }
    }

    public String uploadSong(MultipartFile file, String artistId) {
        validateAudioFile(file);
        validateStorageCapacity(file.getSize());
        if (r2StorageService != null && r2StorageService.isAvailable()) {
            return r2StorageService.uploadSong(file, artistId);
        }
        // Fallback to Supabase if R2 not configured
        String path = "songs/" + artistId + "/" + generateFileName(file);
        return uploadFile(file, path);
    }

    public String uploadCover(MultipartFile file, String ownerId) {
        validateImageFile(file);
        String path = coversPath + "/" + ownerId + "/" + generateFileName(file);
        return uploadFile(file, path);
    }

    public String uploadCoverBytes(byte[] imageBytes, String mimeType, String ownerId) {
        if (imageBytes == null || imageBytes.length == 0) return null;
        validateStorageCapacity(imageBytes.length);
        String ext = "jpg";
        if (mimeType != null && mimeType.contains("png")) ext = "png";
        else if (mimeType != null && mimeType.contains("webp")) ext = "webp";
        String fileName = java.util.UUID.randomUUID().toString() + "." + ext;
        String path = coversPath + "/" + ownerId + "/" + fileName;
        return uploadBytes(imageBytes, mimeType, path);
    }

    private String uploadBytes(byte[] bytes, String contentType, String path) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(serviceRoleKey);
            headers.setContentType(MediaType.parseMediaType(contentType != null ? contentType : "image/jpeg"));
            headers.set("x-upsert", "true");

            HttpEntity<byte[]> request = new HttpEntity<>(bytes, headers);
            ResponseEntity<java.util.Map> response = restTemplate.exchange(
                    supabaseUrl + "/storage/v1/object/" + bucketName + "/" + path,
                    HttpMethod.POST,
                    request,
                    java.util.Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Image bytes uploaded to storage: {}", path);
                return getPublicUrl(path);
            }
        } catch (Exception e) {
            log.error("Upload image bytes error: {}", e.getMessage());
        }
        return getPublicUrl(path);
    }

    public String uploadAvatar(MultipartFile file, String userId) {
        validateImageFile(file);
        String path = avatarsPath + "/" + userId + "/" + generateFileName(file);
        return uploadFile(file, path);
    }

    public String getPublicUrl(String path) {
        return supabaseUrl + "/storage/v1/object/public/" + bucketName + "/" + path;
    }

    public String getSignedUrl(String path, int expiresInSeconds) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(serviceRoleKey);
            headers.setContentType(MediaType.APPLICATION_JSON);

            String body = "{\"expiresIn\": " + expiresInSeconds + "}";
            HttpEntity<String> request = new HttpEntity<>(body, headers);

            ResponseEntity<java.util.Map> response = restTemplate.postForEntity(
                    supabaseUrl + "/storage/v1/object/sign/" + bucketName + "/" + path,
                    request,
                    java.util.Map.class);

            if (response.getBody() != null && response.getBody().containsKey("signedURL")) {
                return (String) response.getBody().get("signedURL");
            }
        } catch (Exception e) {
            log.error("Failed to generate signed URL: {}", e.getMessage());
        }
        return getPublicUrl(path);
    }

    public void deleteFile(String path) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(serviceRoleKey);
            headers.setContentType(MediaType.APPLICATION_JSON);

            HttpEntity<String> request = new HttpEntity<>(headers);

            ResponseEntity<Void> response = restTemplate.exchange(
                    supabaseUrl + "/storage/v1/object/" + bucketName + "?prefix=" + path,
                    HttpMethod.DELETE,
                    request,
                    Void.class);

            log.info("File deleted from storage: {}", path);
        } catch (Exception e) {
            log.error("Failed to delete file from storage: {}", e.getMessage());
        }
    }

    /**
     * Resolves a full public URL back to an object key/path and deletes it
     * from R2 (preferred) or Supabase Storage. Safe to call with null.
     * Used to roll back orphaned uploads when the DB transaction fails.
     */
    public void deleteFileByUrl(String publicFileUrl) {
        if (publicFileUrl == null || publicFileUrl.isBlank()) return;

        // Try R2 first
        if (r2StorageService != null && r2StorageService.isAvailable()) {
            String key = r2StorageService.resolveKey(publicFileUrl);
            if (key != null && !key.isBlank()) {
                r2StorageService.deleteFile(key);
                log.info("Rolled back orphaned R2 object: {}", key);
                return;
            }
        }

        // Fall back to Supabase: strip the public-URL prefix to get the path
        String prefix = supabaseUrl + "/storage/v1/object/public/" + bucketName + "/";
        String path = publicFileUrl.startsWith(prefix) ? publicFileUrl.substring(prefix.length()) : publicFileUrl;
        deleteFile(path);
        log.info("Rolled back orphaned Supabase object: {}", path);
    }

    private String uploadFile(MultipartFile file, String path) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(serviceRoleKey);
            headers.setContentType(MediaType.APPLICATION_OCTET_STREAM);
            headers.set("x-upsert", "true");

            byte[] fileBytes = file.getBytes();
            HttpEntity<byte[]> request = new HttpEntity<>(fileBytes, headers);

            ResponseEntity<java.util.Map> response = restTemplate.exchange(
                    supabaseUrl + "/storage/v1/object/" + bucketName + "/" + path,
                    HttpMethod.POST,
                    request,
                    java.util.Map.class);

            if (response.getStatusCode().is2xxSuccessful()) {
                String publicUrl = getPublicUrl(path);
                log.info("File uploaded: {}", publicUrl);
                return publicUrl;
            } else {
                throw new RuntimeException("Failed to upload file: " + response.getStatusCode());
            }
        } catch (Exception e) {
            log.error("Upload failed: {}", e.getMessage());
            throw new BadRequestException("File upload failed: " + e.getMessage());
        }
    }

    private void ensureBucketExists() {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setBearerAuth(serviceRoleKey);
            headers.setContentType(MediaType.APPLICATION_JSON);

            HttpEntity<String> request = new HttpEntity<>(headers);

            boolean exists = false;
            try {
                ResponseEntity<java.util.Map> response = restTemplate.exchange(
                        supabaseUrl + "/storage/v1/bucket/" + bucketName,
                        HttpMethod.GET,
                        request,
                        java.util.Map.class);
                exists = response.getStatusCode().is2xxSuccessful();
            } catch (Exception e) {
                exists = false;
            }

            if (!exists) {
                String body = "{\"id\": \"" + bucketName + "\", \"name\": \"" + bucketName + "\", \"public\": true}";
                HttpEntity<String> createRequest = new HttpEntity<>(body, headers);
                try {
                    ResponseEntity<java.util.Map> createResponse = restTemplate.postForEntity(
                            supabaseUrl + "/storage/v1/bucket",
                            createRequest,
                            java.util.Map.class);
                    if (createResponse.getStatusCode().is2xxSuccessful()) {
                        log.info("Storage bucket created: {}", bucketName);
                    }
                } catch (Exception createEx) {
                    log.warn("Bucket creation notice: {}", createEx.getMessage());
                }
            }
        } catch (Exception e) {
            log.warn("Could not ensure bucket exists: {}", e.getMessage());
        }
    }

    private void validateAudioFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("Audio file is required");
        }
        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("audio/")) {
            throw new BadRequestException("Invalid audio file type");
        }
        if (file.getSize() > 250 * 1024 * 1024) {
            throw new BadRequestException("Audio file exceeds maximum size of 250MB");
        }
    }

    private void validateImageFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("Image file is required");
        }
        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("image/")) {
            throw new BadRequestException("Invalid image file type");
        }
        if (file.getSize() > 10 * 1024 * 1024) {
            throw new BadRequestException("Image file exceeds maximum size of 10MB");
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
}
