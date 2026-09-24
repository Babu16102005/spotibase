package com.spotibase.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotibase.dto.request.CreateSongRequest;
import com.spotibase.dto.response.PagedResponse;
import com.spotibase.dto.response.SongResponse;
import com.spotibase.entity.Role;
import com.spotibase.exception.ResourceNotFoundException;
import com.spotibase.service.LikeService;
import com.spotibase.service.R2StorageService;
import com.spotibase.service.SongService;
import com.spotibase.support.BaseWebMvcTest;
import com.spotibase.support.TestSecurityConfig;
import com.spotibase.support.TestUsers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;

import java.io.ByteArrayInputStream;

import java.time.LocalDate;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Web slice tests for {@link SongController}.
 */
@WebMvcTest(SongController.class)
@Import(TestSecurityConfig.class)
class SongControllerTest extends BaseWebMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private SongService songService;

    @MockBean
    private LikeService likeService;

    @MockBean
    private com.spotibase.service.StorageService storageService;

    @MockBean
    private com.spotibase.service.R2StorageService r2StorageService;

    private SongResponse buildSongResponse() {
        return SongResponse.builder()
                .id("song-1")
                .title("Hit Song")
                .artistId("artist-1")
                .artistName("The Band")
                .durationMs(180000)
                .build();
    }

    // ---------- reads ----------

    @Test
    void getSongById_authenticated_returns200() throws Exception {
        when(songService.getSongById("song-1", "user-1")).thenReturn(buildSongResponse());

        mockMvc.perform(get("/api/v1/songs/song-1")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("song-1"))
                .andExpect(jsonPath("$.title").value("Hit Song"))
                .andExpect(jsonPath("$.artistName").value("The Band"));
    }

    @Test
    void getSongById_notFound_returns404WithErrorBody() throws Exception {
        when(songService.getSongById("missing", "user-1"))
                .thenThrow(new ResourceNotFoundException("Song", "missing"));

        mockMvc.perform(get("/api/v1/songs/missing")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.message").value("Song not found with id: missing"));
    }

    @Test
    void getSongById_unauthenticated_isRejected() throws Exception {
        // Production + TestSecurityConfig entryPoint: unauthenticated => 401.
        mockMvc.perform(get("/api/v1/songs/song-1"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void getAllSongs_authenticated_returnsPagedResponse() throws Exception {
        PagedResponse<SongResponse> paged = PagedResponse.<SongResponse>builder()
                .content(List.of(buildSongResponse()))
                .page(0)
                .size(20)
                .totalElements(1)
                .totalPages(1)
                .first(true)
                .last(true)
                .build();
        when(songService.getAllSongs(0, 20, "user-1")).thenReturn(paged);

        mockMvc.perform(get("/api/v1/songs")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value("song-1"))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void getTrendingSongs_returns200() throws Exception {
        when(songService.getTrendingSongs("user-1", 20)).thenReturn(List.of(buildSongResponse()));

        mockMvc.perform(get("/api/v1/songs/trending")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("song-1"));
    }

    @Test
    void getNewReleases_returns200() throws Exception {
        when(songService.getNewReleases("user-1", 20)).thenReturn(List.of(buildSongResponse()));

        mockMvc.perform(get("/api/v1/songs/new-releases")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].title").value("Hit Song"));
    }

    @Test
    void getFeaturedSongs_returns200() throws Exception {
        when(songService.getFeaturedSongs("user-1", 20)).thenReturn(List.of(buildSongResponse()));

        mockMvc.perform(get("/api/v1/songs/featured")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].title").value("Hit Song"));
    }

    // ---------- likes ----------

    @Test
    void likeSong_authenticated_returns201() throws Exception {
        mockMvc.perform(post("/api/v1/songs/song-1/like")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isCreated());

        verify(likeService).likeSong("user-1", "song-1");
    }

    @Test
    void likeSong_unauthenticated_isRejected() throws Exception {
        // Production + TestSecurityConfig entryPoint: unauthenticated => 401 (not 403).
        mockMvc.perform(post("/api/v1/songs/song-1/like"))
                .andExpect(status().isUnauthorized());

        verify(likeService, org.mockito.Mockito.never()).likeSong(anyString(), anyString());
    }

    @Test
    void unlikeSong_authenticated_returns204() throws Exception {
        mockMvc.perform(delete("/api/v1/songs/song-1/like")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isNoContent());

        verify(likeService).unlikeSong("user-1", "song-1");
    }

    // ---------- stream ----------

    private static final String BROWSER_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
    private static final String STREAM_URL = "https://pub-example.r2.dev/songs/artist-1/song-1.mp3";
    private static final String STREAM_KEY = "songs/artist-1/song-1.mp3";

    private com.spotibase.entity.Song buildStreamSong() {
        return com.spotibase.entity.Song.builder()
                .id("song-1")
                .name("Hit Song")
                .fileUrl(STREAM_URL)
                .durationMs(180000)
                .fileFormat("MP3")
                .build();
    }

    // Real (empty) R2 stream: exercises the production 64KB copy loop and
    // try-with-resources close path without Mockito final-class stubbing.
    private ResponseInputStream<GetObjectResponse> emptyR2Stream() {
        return new ResponseInputStream<>(GetObjectResponse.builder().build(),
                new ByteArrayInputStream(new byte[0]));
    }

    private void stubR2Head(long size, String eTag) {
        when(r2StorageService.resolveKey(STREAM_URL)).thenReturn(STREAM_KEY);
        when(r2StorageService.headObject(STREAM_KEY))
                .thenReturn(new R2StorageService.R2ObjectInfo(size, "audio/mpeg", eTag));
    }

    private void stubR2Read(String s3Range, long size, long start, long end, String eTag) throws Exception {
        when(r2StorageService.readRange(eq(STREAM_KEY), eq(s3Range)))
                .thenReturn(new R2StorageService.R2ObjectStream(
                        emptyR2Stream(), size, start, end, "audio/mpeg", eTag));
    }

    private org.springframework.test.web.servlet.ResultActions dispatchStream(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder requestBuilder) throws Exception {
        MvcResult result = mockMvc.perform(requestBuilder)
                .andExpect(request().asyncStarted())
                .andReturn();
        return mockMvc.perform(asyncDispatch(result));
    }

    @Test
    void streamSong_noRange_browserUA_returns206FirstChunkAndCountsPlay() throws Exception {
        // No Range header: always-206 contract serves the first 1MB chunk for
        // instant start (documented fast-start behavior, not a full 200).
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());
        stubR2Head(10000000L, "abc123");
        stubR2Read("bytes=0-1048575", 10000000L, 0, 1048575, "\"abc123\"");

        dispatchStream(get("/api/v1/songs/song-1/stream").header("User-Agent", BROWSER_UA))
                .andExpect(status().isPartialContent())
                .andExpect(header().string("Accept-Ranges", "bytes"))
                .andExpect(header().string("Content-Type", "audio/mpeg"))
                .andExpect(header().string("Content-Range", "bytes 0-1048575/10000000"))
                .andExpect(header().string("Content-Length", "1048576"))
                .andExpect(header().string("ETag", "\"abc123\""))
                .andExpect(header().string("Cache-Control", "public, max-age=3600"))
                .andExpect(header().string("Access-Control-Expose-Headers",
                        "Content-Range, Accept-Ranges, Content-Length, Content-Type, ETag"));

        verify(songService).incrementPlayCount("song-1");
    }

    @Test
    void streamSong_isPermitAll_unauthenticatedCanStream() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());
        stubR2Head(100000L, "abc123");
        stubR2Read("bytes=0-1023", 100000L, 0, 1023, "\"abc123\"");

        // No credentials at all: the stream endpoint stays permitAll.
        dispatchStream(get("/api/v1/songs/song-1/stream")
                        .header("User-Agent", BROWSER_UA)
                        .header("Range", "bytes=0-1023"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string("Content-Range", "bytes 0-1023/100000"));
    }

    @Test
    void streamSong_withRange_returnsPartialContent() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());
        stubR2Head(100000L, "abc123");
        stubR2Read("bytes=0-1023", 100000L, 0, 1023, "\"abc123\"");

        dispatchStream(get("/api/v1/songs/song-1/stream")
                        .header("User-Agent", BROWSER_UA)
                        .header("Range", "bytes=0-1023"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string("Accept-Ranges", "bytes"))
                .andExpect(header().string("Content-Range", "bytes 0-1023/100000"));

        // Range starting at 0 counts as a play.
        verify(songService).incrementPlayCount("song-1");
    }

    @Test
    void streamSong_usesCachedStreamRef_withoutLoadingEntity() throws Exception {
        // Cheap path: cached fileUrl+fileFormat projection, no full entity load.
        when(songService.getSongStreamRef("song-1"))
                .thenReturn(new SongService.SongStreamRef(STREAM_URL, "MP3"));
        stubR2Head(100000L, "abc123");
        stubR2Read("bytes=0-99999", 100000L, 0, 99999, "\"abc123\"");

        dispatchStream(get("/api/v1/songs/song-1/stream").header("User-Agent", BROWSER_UA))
                .andExpect(status().isPartialContent())
                .andExpect(header().string("Content-Range", "bytes 0-99999/100000"));

        verify(songService, never()).getSongEntityById(anyString());
        verify(songService).incrementPlayCount("song-1");
    }

    @Test
    void streamSong_seekRange_doesNotCountPlay() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());
        stubR2Head(100000L, "abc123");
        stubR2Read("bytes=5000-99999", 100000L, 5000, 99999, "\"abc123\"");

        dispatchStream(get("/api/v1/songs/song-1/stream")
                        .header("User-Agent", BROWSER_UA)
                        .header("Range", "bytes=5000-")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isPartialContent())
                .andExpect(header().string("Content-Range", "bytes 5000-99999/100000"));

        // Seeks never inflate play counts, even for logged-in users.
        verify(songService, never()).incrementPlayCount(anyString());
        verify(songService, never()).recordPlayback(anyString(), anyString(), anyString());
    }

    @Test
    void streamSong_seekWithCountParam_countsPlay() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());
        stubR2Head(100000L, "abc123");
        stubR2Read("bytes=5000-99999", 100000L, 5000, 99999, "\"abc123\"");

        dispatchStream(get("/api/v1/songs/song-1/stream")
                        .param("count", "1")
                        .header("User-Agent", BROWSER_UA)
                        .header("Range", "bytes=5000-")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isPartialContent());

        verify(songService).incrementPlayCount("song-1");
        verify(songService).recordPlayback("user-1", "song-1", "STREAM");
    }

    @Test
    void streamSong_suffixRange_servesTailWithoutCounting() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());
        stubR2Head(100000L, "abc123");
        stubR2Read("bytes=99500-99999", 100000L, 99500, 99999, "\"abc123\"");

        dispatchStream(get("/api/v1/songs/song-1/stream")
                        .header("User-Agent", BROWSER_UA)
                        .header("Range", "bytes=-500"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string("Content-Range", "bytes 99500-99999/100000"));

        verify(songService, never()).incrementPlayCount(anyString());
    }

    @Test
    void streamSong_rangeBeyondSize_returns416() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());
        stubR2Head(100000L, "abc123");

        mockMvc.perform(get("/api/v1/songs/song-1/stream")
                        .header("User-Agent", BROWSER_UA)
                        .header("Range", "bytes=200000-"))
                .andExpect(status().isRequestedRangeNotSatisfiable())
                .andExpect(header().string("Content-Range", "bytes */100000"))
                .andExpect(header().string("Accept-Ranges", "bytes"));

        verify(r2StorageService, never()).readRange(anyString(), anyString());
        verify(songService, never()).incrementPlayCount(anyString());
    }

    @Test
    void streamSong_malformedRange_returns416Not500() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());
        stubR2Head(100000L, "abc123");

        mockMvc.perform(get("/api/v1/songs/song-1/stream")
                        .header("User-Agent", BROWSER_UA)
                        .header("Range", "bytes=abc-def"))
                .andExpect(status().isRequestedRangeNotSatisfiable())
                .andExpect(header().string("Content-Range", "bytes */100000"));

        verify(r2StorageService, never()).readRange(anyString(), anyString());
    }

    @Test
    void streamSong_head_returns200WithMetadataAndNeverCounts() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());
        stubR2Head(100000L, "abc123");

        // Unauthenticated: HEAD stays permitAll like GET.
        mockMvc.perform(head("/api/v1/songs/song-1/stream").header("User-Agent", BROWSER_UA))
                .andExpect(status().isOk())
                .andExpect(header().string("Accept-Ranges", "bytes"))
                .andExpect(header().string("Content-Type", "audio/mpeg"))
                .andExpect(header().string("Content-Length", "100000"))
                .andExpect(header().string("ETag", "\"abc123\""));

        verify(r2StorageService, never()).readRange(anyString(), anyString());
        verify(songService, never()).incrementPlayCount(anyString());
        verify(songService, never()).recordPlayback(anyString(), anyString(), anyString());
    }

    @Test
    void streamSong_ifNoneMatch_returns304WithoutBodyOrCount() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());
        stubR2Head(100000L, "abc123");

        mockMvc.perform(get("/api/v1/songs/song-1/stream")
                        .header("User-Agent", BROWSER_UA)
                        .header("If-None-Match", "\"abc123\""))
                .andExpect(status().isNotModified())
                .andExpect(header().string("ETag", "\"abc123\""));

        verify(r2StorageService, never()).readRange(anyString(), anyString());
        verify(songService, never()).incrementPlayCount(anyString());
    }

    @Test
    void streamSong_nativeClient_redirectsAndCountsFirstPlay() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());

        // No browser User-Agent: native mobile client gets a direct redirect.
        mockMvc.perform(get("/api/v1/songs/song-1/stream"))
                .andExpect(status().isFound())
                .andExpect(header().string("Location", STREAM_URL));

        verify(songService).incrementPlayCount("song-1");
    }

    @Test
    void streamSong_nativeClientSeek_doesNotCount() throws Exception {
        when(songService.getSongEntityById("song-1")).thenReturn(buildStreamSong());

        mockMvc.perform(get("/api/v1/songs/song-1/stream")
                        .header("Range", "bytes=5000-"))
                .andExpect(status().isFound());

        verify(songService, never()).incrementPlayCount(anyString());
    }

    @Test
    void streamSong_missingFileUrl_returns404() throws Exception {
        com.spotibase.entity.Song song = com.spotibase.entity.Song.builder()
                .id("song-1")
                .fileUrl(null)
                .build();
        when(songService.getSongEntityById("song-1")).thenReturn(song);

        mockMvc.perform(get("/api/v1/songs/song-1/stream").header("User-Agent", BROWSER_UA))
                .andExpect(status().isNotFound());
    }

    // ---------- create / update / delete (role restricted) ----------

    @Test
    void createSong_asArtist_returns201() throws Exception {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("New Song")
                .artistId("artist-1")
                .releaseDate(LocalDate.of(2025, 1, 1))
                .build();
        when(songService.createSong(any(CreateSongRequest.class), any(), any()))
                .thenReturn(buildSongResponse());

        mockMvc.perform(multipart("/api/v1/songs")
                        .file(new MockMultipartFile("request", "", "application/json",
                                objectMapper.writeValueAsBytes(request)))
                        .with(user(TestUsers.artist("artist-1"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("song-1"));
    }

    @Test
    void createSong_asRegularUser_isForbidden() throws Exception {
        CreateSongRequest request = CreateSongRequest.builder()
                .title("New Song")
                .artistId("artist-1")
                .releaseDate(LocalDate.of(2025, 1, 1))
                .build();

        mockMvc.perform(multipart("/api/v1/songs")
                        .file(new MockMultipartFile("request", "", "application/json",
                                objectMapper.writeValueAsBytes(request)))
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isForbidden());
    }

    // ---------- bulk upload ----------

    @Test
    void createSongsBulk_asAdmin_returns201WithList() throws Exception {
        List<CreateSongRequest> requests = List.of(
                CreateSongRequest.builder().title("Track One").artistName("Artist A").build(),
                CreateSongRequest.builder().title("Track Two").artistName("Artist B").build());
        when(songService.createSongsBulk(any(), any()))
                .thenReturn(List.of(buildSongResponse(), buildSongResponse()));

        mockMvc.perform(multipart("/api/v1/songs/bulk")
                        .file(new MockMultipartFile("files", "a.flac", "audio/flac", new byte[] { 1, 2, 3 }))
                        .file(new MockMultipartFile("files", "b.flac", "audio/flac", new byte[] { 4, 5, 6 }))
                        .file(new MockMultipartFile("requests", "", "application/json",
                                objectMapper.writeValueAsBytes(requests)))
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$[0].id").value("song-1"))
                .andExpect(jsonPath("$[1].id").value("song-1"));

        verify(songService).createSongsBulk(any(), any());
    }

    @Test
    void createSongsBulk_withoutMetadata_returns201() throws Exception {
        when(songService.createSongsBulk(any(), any()))
                .thenReturn(List.of(buildSongResponse()));

        mockMvc.perform(multipart("/api/v1/songs/bulk")
                        .file(new MockMultipartFile("files", "song.flac", "audio/flac", new byte[] { 1, 2, 3 }))
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$[0].id").value("song-1"));
    }

    @Test
    void createSongsBulk_invalidMetadata_returns400() throws Exception {
        mockMvc.perform(multipart("/api/v1/songs/bulk")
                        .file(new MockMultipartFile("files", "song.flac", "audio/flac", new byte[] { 1, 2, 3 }))
                        .file(new MockMultipartFile("requests", "", "application/json", "not-json".getBytes()))
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createSongsBulk_asRegularUser_isForbidden() throws Exception {
        mockMvc.perform(multipart("/api/v1/songs/bulk")
                        .file(new MockMultipartFile("files", "song.flac", "audio/flac", new byte[] { 1, 2, 3 }))
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void createSong_invalidRequestPart_returns400() throws Exception {
        String invalidJson = objectMapper.writeValueAsString(CreateSongRequest.builder()
                .title("")
                .artistId("artist-1")
                .build());

        mockMvc.perform(multipart("/api/v1/songs")
                        .file(new MockMultipartFile("request", "", "application/json", invalidJson.getBytes()))
                        .with(user(TestUsers.artist("artist-1"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.validationErrors.title").value("Song title is required"));
    }

    @Test
    void deleteSong_asAdmin_returns204() throws Exception {
        mockMvc.perform(delete("/api/v1/songs/song-1")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isNoContent());

        verify(songService).deleteSong("song-1");
    }

    @Test
    void restoreSong_asAdmin_returns200() throws Exception {
        mockMvc.perform(post("/api/v1/songs/song-1/restore")
                        .with(user(TestUsers.admin("admin-1"))))
                .andExpect(status().isOk());

        verify(songService).restoreSong("song-1");
    }

    @Test
    void restoreSong_asRegularUser_isForbidden() throws Exception {
        mockMvc.perform(post("/api/v1/songs/song-1/restore")
                        .with(user(TestUsers.regularUser("user-1"))))
                .andExpect(status().isForbidden());
    }
}
