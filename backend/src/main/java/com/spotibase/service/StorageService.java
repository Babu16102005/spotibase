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

    // Optional R2 storage for songs
    @Autowired(required = false)
    private R2StorageService r2StorageService;

    @PostConstruct
    public void init() {
        ensureBucketExists();
    }

    public String uploadSong(MultipartFile file, String artistId) {
        validateAudioFile(file);
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

            boolean exists;
            try {
                ResponseEntity<java.util.Map> response = restTemplate.exchange(
                        supabaseUrl + "/storage/v1/bucket/" + bucketName,
                        HttpMethod.GET,
                        request,
                        java.util.Map.class);
                exists = response.getStatusCode().is2xxSuccessful();
            } catch (org.springframework.web.client.HttpClientErrorException.NotFound e) {
                // Bucket does not exist yet - fall through and create it
                exists = false;
            }

            if (!exists) {
                String body = "{\"name\": \"" + bucketName + "\", \"public\": true}";
                HttpEntity<String> createRequest = new HttpEntity<>(body, headers);
                ResponseEntity<java.util.Map> createResponse = restTemplate.postForEntity(
                        supabaseUrl + "/storage/v1/bucket",
                        createRequest,
                        java.util.Map.class);
                if (createResponse.getStatusCode().is2xxSuccessful()) {
                    log.info("Storage bucket created: {}", bucketName);
                } else {
                    log.warn("Failed to create storage bucket '{}': {}", bucketName, createResponse.getStatusCode());
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
        if (file.getSize() > 50 * 1024 * 1024) {
            throw new BadRequestException("Audio file exceeds maximum size of 50MB");
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
