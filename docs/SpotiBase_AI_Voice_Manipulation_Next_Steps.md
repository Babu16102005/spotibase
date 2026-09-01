# SpotiBase — Next Steps: AI Voice Assistant & App Manipulation

## 1. Goal

Build a voice assistant that can understand natural-language commands, understand mood/music intent, and safely control the existing SpotiBase application.

Target flow:

```text
Voice
  ↓
Speech-to-Text
  ↓
Qwen2.5-3B-Instruct
  ↓
Structured Action JSON
  ↓
Spring Boot validation
  ↓
Existing SpotiBase services
  ↓
Database / Queue / WebSocket
  ↓
React Native player
```

The project already has Spring Boot, PostgreSQL, queue, playlists, search, recommendation services, JWT, STOMP `/ws`, and a React Native player. The progress report says the application is AI-wiring ready but not yet AI-feature ready. fileciteturn0file0L34-L52

---

## 2. Important Architecture Rule

**Qwen must never directly manipulate the database or player.**

Use:

```text
User
 ↓
STT
 ↓
Qwen
 ↓
Action
 ↓
Spring Boot
 ↓
Validate
 ↓
Existing Service
 ↓
Execute
```

For example:

```text
"Skip this song"
 ↓
Qwen
 ↓
NEXT
 ↓
Spring Boot
 ↓
STOMP
 ↓
playerStore
 ↓
TrackPlayer.next()
```

The existing project already has `QueueService`, `PlaylistService`, `SearchService`, `RecommendationService`, `LikeService`, and realtime infrastructure. Reuse them rather than duplicating business logic. fileciteturn0file0L179-L190

---

# 3. Model

Use:

```text
Qwen2.5-3B-Instruct
```

Use it for:

- intent detection
- parameter extraction
- mood interpretation
- natural-language commands
- multi-action planning
- structured JSON output

Do not use it for:

- SQL
- authentication
- authorization
- direct database writes
- direct player control
- arbitrary code execution

---

# 4. Implementation Order

Do these phases in this exact order:

```text
P0  Baseline
 ↓
P1  Text → Qwen → Action
 ↓
P2  Action → Existing Spring Boot services
 ↓
P3  Spring Boot → STOMP → Player
 ↓
P4  Voice → STT → Qwen
 ↓
P5  Mood / recommendation intelligence
 ↓
P6  Multi-action/contextual assistant
 ↓
P7  Automatic song tagging
 ↓
P8  TTS / semantic search / long-term memory
```

The existing report currently puts voice later; for your requirement, move voice ahead because voice manipulation is the main differentiator. The report identifies voice as A8 and the existing AI backlog separately. fileciteturn0file0L452-L464

---

# 5. P0 — Baseline

The audit found V18/V19 migration changes in the working tree. Reconcile them before creating the AI branch. fileciteturn0file0L53-L53

```powershell
git status

git add backend/src/main/resources/application.yml `
        backend/src/main/resources/db/migration/V18__create_indexes.sql `
        backend/src/main/resources/db/migration/V19__add_contributing_artists_and_denormalized_fields.sql

git commit -m "chore: reconcile migration drift before ai"

git checkout -b feat/ai-voice-assistant
```

Do not modify old Flyway migrations after this. Add V21+.

---

# 6. P1 — Text Assistant First

Before microphone integration, prove:

```text
Text
 ↓
Qwen
 ↓
JSON
```

Example:

```http
POST /api/v1/ai/text
```

Request:

```json
{
  "text": "pause the song"
}
```

Response:

```json
{
  "actions": [
    {
      "action": "PAUSE",
      "parameters": {}
    }
  ],
  "response": "Pausing the song."
}
```

This isolates LLM problems from microphone/STT problems.

---

# 7. Allowed Actions

Create:

```java
public enum AssistantAction {
    PLAY,
    PAUSE,
    RESUME,
    NEXT,
    PREVIOUS,

    PLAY_SONG,
    SEARCH_SONG,
    SEARCH_ARTIST,
    SEARCH_ALBUM,

    PLAY_BY_MOOD,
    PLAY_BY_GENRE,
    PLAY_BY_LANGUAGE,
    PLAY_SIMILAR,

    ADD_TO_QUEUE,
    REMOVE_FROM_QUEUE,
    CLEAR_QUEUE,

    LIKE_CURRENT,
    UNLIKE_CURRENT,

    ADD_TO_PLAYLIST,
    REMOVE_FROM_PLAYLIST,
    CREATE_PLAYLIST,

    SHUFFLE_ON,
    SHUFFLE_OFF,
    REPEAT_ON,
    REPEAT_OFF,

    SET_VOLUME,

    GET_CURRENT_SONG,
    GET_QUEUE,
    GET_RECOMMENDATIONS
}
```

Never execute an action that is not in this enum.

---

# 8. Support Multiple Actions

This is important for heavy commands.

User:

```text
"Skip this song, play something energetic and add the next song to my queue."
```

Qwen should return:

```json
{
  "actions": [
    {
      "action": "NEXT",
      "parameters": {}
    },
    {
      "action": "PLAY_BY_MOOD",
      "parameters": {
        "mood": "ENERGETIC"
      }
    },
    {
      "action": "ADD_TO_QUEUE",
      "parameters": {
        "target": "next_result"
      }
    }
  ],
  "response": "I'll skip this song, play something energetic, and queue the next result."
}
```

The backend executes these sequentially.

---

# 9. DTOs

Create:

```text
backend/src/main/java/com/spotibase/ai/
```

Files:

```text
AssistantController.java
AssistantService.java
ActionDispatcher.java
AssistantAction.java
AssistantRequest.java
AssistantResponse.java
AssistantContext.java
AssistantCommand.java
```

Example:

```java
public record AssistantRequest(
    String text,
    AssistantContext context
) {}
```

```java
public record AssistantContext(
    String currentSongId,
    String currentArtist,
    String currentAlbum,
    String currentPlaylist,
    boolean playing,
    int queueSize
) {}
```

```java
public record AssistantCommand(
    AssistantAction action,
    Map<String, Object> parameters
) {}
```

---

# 10. Qwen System Prompt

Create:

```text
spotibase-ai/app/prompts/assistant_system.txt
```

Use a strict prompt:

```text
You are the SpotiBase AI music assistant.

Understand the user's music request and convert it into one or more
safe SpotiBase actions.

You may ONLY use actions from the allowed action list.

Never invent an action.
Never invent a song ID.
Never invent a playlist ID.
Never execute SQL.
Never access the database.
Never claim that an action succeeded.

The application backend executes all actions.

Return valid JSON only.

If the request is ambiguous, request clarification.

Allowed actions:
PLAY
PAUSE
RESUME
NEXT
PREVIOUS
PLAY_SONG
SEARCH_SONG
SEARCH_ARTIST
SEARCH_ALBUM
PLAY_BY_MOOD
PLAY_BY_GENRE
PLAY_BY_LANGUAGE
PLAY_SIMILAR
ADD_TO_QUEUE
REMOVE_FROM_QUEUE
CLEAR_QUEUE
LIKE_CURRENT
UNLIKE_CURRENT
ADD_TO_PLAYLIST
REMOVE_FROM_PLAYLIST
CREATE_PLAYLIST
SHUFFLE_ON
SHUFFLE_OFF
REPEAT_ON
REPEAT_OFF
SET_VOLUME
GET_CURRENT_SONG
GET_QUEUE
GET_RECOMMENDATIONS
```

---

# 11. P2 — Action Dispatcher

Create:

```text
ActionDispatcher
```

Map AI actions to existing services:

```text
PAUSE            → player/realtime command
RESUME           → player/realtime command
NEXT             → player/realtime command
PREVIOUS         → player/realtime command

SEARCH_SONG      → SearchService
SEARCH_ARTIST    → SearchService

PLAY_BY_MOOD     → RecommendationService
PLAY_BY_GENRE    → RecommendationService
PLAY_BY_LANGUAGE → RecommendationService
PLAY_SIMILAR     → RecommendationService

ADD_TO_QUEUE     → QueueService
REMOVE_FROM_QUEUE→ QueueService

LIKE_CURRENT     → LikeService

ADD_TO_PLAYLIST  → PlaylistService
CREATE_PLAYLIST  → PlaylistService
```

Do not create duplicate queue/playlist/search logic.

---

# 12. P3 — Player Manipulation

The existing player uses TrackPlayer on native and Shaka on web, while the existing realtime system uses STOMP `/ws`. fileciteturn0file0L254-L257 fileciteturn0file0L337-L354

Add a dedicated AI player command:

```json
{
  "type": "AI_PLAYER_COMMAND",
  "commandId": "abc123",
  "action": "NEXT"
}
```

Recommended user destination:

```text
/user/queue/ai-player
```

Flow:

```text
Qwen
 ↓
NEXT
 ↓
ActionDispatcher
 ↓
RealtimeService
 ↓
STOMP
 ↓
mobile/src/realtime/client.ts
 ↓
playerStore
 ↓
TrackPlayer.next()
```

---

# 13. Player Acknowledgement

Do not assume a command succeeded merely because it was sent.

Mobile returns:

```json
{
  "type": "AI_PLAYER_ACK",
  "commandId": "abc123",
  "status": "SUCCESS"
}
```

Failure:

```json
{
  "type": "AI_PLAYER_ACK",
  "commandId": "abc123",
  "status": "FAILED",
  "reason": "PLAYER_NOT_READY"
}
```

This lets the assistant report accurately.

---

# 14. P4 — Voice

Once text manipulation works:

```text
Microphone
 ↓
Audio
 ↓
Speech-to-Text
 ↓
Transcript
 ↓
Qwen
 ↓
Action
```

Use:

```text
faster-whisper
```

Start with:

```text
small
```

If CPU resources are too limited:

```text
tiny
```

If quality is insufficient:

```text
medium
```

---

# 15. AI Service

Create a separate Python service:

```text
spotibase-ai/
├── app/
│   ├── main.py
│   ├── routes/
│   │   ├── assistant.py
│   │   ├── speech.py
│   │   └── health.py
│   ├── services/
│   │   ├── llm_service.py
│   │   ├── stt_service.py
│   │   ├── vad_service.py
│   │   └── tts_service.py
│   ├── schemas/
│   └── prompts/
├── requirements.txt
├── Dockerfile
└── README.md
```

Recommended architecture:

```text
Spring Boot
    │
    │ private HTTP
    ▼
FastAPI
    │
    ├── faster-whisper
    └── Qwen2.5-3B-Instruct
```

Keep AI runtime separate from Spring Boot.

---

# 16. Voice API

Spring Boot:

```http
POST /api/v1/ai/voice
Authorization: Bearer <JWT>
Content-Type: multipart/form-data
```

Input:

```text
audio
```

Processing:

```text
1. Authenticate user
2. Validate audio type/size
3. Send audio to AI service
4. Receive transcript + actions
5. Validate actions
6. Execute actions
7. Return response
```

Mobile should call Spring Boot, not expose the AI service directly.

---

# 17. Voice Activity Detection

For the first version, use push-to-talk:

```text
Press 🎤
 ↓
Record
 ↓
Release
```

Later add Silero VAD:

```text
Press 🎤
 ↓
Detect speech
 ↓
Detect silence
 ↓
Stop recording
```

Do not start with always-listening wake-word functionality.

---

# 18. P5 — Mood Intelligence

Create a controlled mood vocabulary:

```text
CALM
HAPPY
SAD
ENERGETIC
ROMANTIC
FOCUSED
MOTIVATED
MELANCHOLIC
CHILL
PARTY
NOSTALGIC
DREAMY
```

Normalize phrases:

```text
"relaxed"
"peaceful"
"chill"
"soothing"
```

into:

```text
CALM
```

Do not allow arbitrary model-generated mood names into the database.

---

# 19. Mood Recommendation

Example:

```text
"I'm stressed. Play calm Tamil music."
```

Qwen:

```json
{
  "actions": [
    {
      "action": "PLAY_BY_MOOD",
      "parameters": {
        "mood": "CALM",
        "language": "Tamil"
      }
    }
  ]
}
```

Then Spring Boot:

```text
PLAY_BY_MOOD
 ↓
RecommendationService
 ↓
PostgreSQL
 ↓
Actual songs
 ↓
Queue
 ↓
Player
```

The LLM does not select arbitrary database IDs.

The existing `RecommendationService` already contains deterministic recommendation methods and should remain the fallback when AI fails. fileciteturn0file0L405-L413

---

# 20. Song Metadata for AI

The current database already contains songs, genres, language and listening-history information, but the audit says there is no dedicated AI metadata/vector layer yet. fileciteturn0file0L375-L400

For MVP, add controlled metadata such as:

```text
mood_tags
activity_tags
energy_score
valence_score
bpm
```

Possible V21:

```sql
ALTER TABLE songs
ADD COLUMN mood_tags JSONB,
ADD COLUMN activity_tags JSONB,
ADD COLUMN energy_score REAL,
ADD COLUMN valence_score REAL,
ADD COLUMN bpm REAL;
```

A normalized join-table design can be adopted later if needed.

---

# 21. P6 — Automatic Song Tagging

Your upload requirement should work like this:

```text
Admin uploads song
 ↓
Store audio
 ↓
Create song record
 ↓
status = PROCESSING
 ↓
Background job
 ↓
Audio analysis
 ↓
BPM / energy / valence
 ↓
Genre / mood / activity tagging
 ↓
Update database
 ↓
status = READY
```

Do not make the upload HTTP request wait for AI processing.

The project already extracts ordinary audio metadata with Jaudiotagger, so AI/audio intelligence should be a separate processing stage. fileciteturn0file0L135-L142

---

# 22. Do Not Make Qwen Listen to FLAC

Use specialized audio analysis for:

```text
BPM
loudness
energy
key
spectral features
```

Then derive application tags.

Example:

```text
BPM = 82
Energy = low
Valence = positive
Genre = Pop/Melody

       ↓

moods:
CALM, ROMANTIC

activities:
RELAX, NIGHT
```

---

# 23. P7 — Multi-Action Assistant

Support commands such as:

```text
"Skip this song, then play energetic Tamil music,
and put five songs in my queue."
```

Execution:

```text
1. NEXT
2. Find energetic Tamil candidates
3. Rank candidates
4. Queue five
5. Start playback
6. Send acknowledgement
```

This is the point where the assistant becomes an application orchestrator rather than a chatbot.

---

# 24. Context

Maintain small short-term context:

```json
{
  "currentSong": "...",
  "lastSearch": "...",
  "lastRecommendationSet": ["..."],
  "lastMood": "CALM",
  "lastArtist": "...",
  "lastPlaylist": "Chill"
}
```

Then:

```text
"Make it more energetic."
```

can refer to the current recommendation context.

Do not send the entire database/listening history to Qwen.

---

# 25. Clarification

If:

```text
"Add it to my playlist."
```

and the user has multiple possible playlists, ask:

```text
"Which playlist should I add it to?"
```

If:

```text
"Play that song."
```

is ambiguous:

```text
"Which song do you mean?"
```

Do not guess when the action could affect user data.

---

# 26. Optimize Simple Commands

This is one of the most important optimizations.

Do not send:

```text
next
pause
resume
previous
skip
```

to Qwen.

Use:

```text
STT
 ↓
Simple command detector
 ├── NEXT
 ├── PAUSE
 ├── RESUME
 ├── PREVIOUS
 └── complex → Qwen
```

Benefits:

- lower latency
- lower model load
- fewer hallucinations
- cheaper hosting
- more reliable player control

---

# 27. Authentication and Security

The existing application already has JWT authentication. fileciteturn0file0L181-L188

Use:

```text
JWT
 ↓
Spring Boot identifies user
 ↓
AI request
 ↓
Action validation
 ↓
Authorization
 ↓
Execution
```

Never let Qwen:

```text
execute SQL
delete arbitrary records
access another user's playlist
invent resource IDs
call arbitrary APIs
```

For playlist/like operations:

```text
authenticated user
      ↓
resource ownership check
      ↓
execute
```

---

# 28. AI Rate Limits

The existing project already has Bucket4j and the audit recommends per-user/global AI caps. fileciteturn0file0L504-L516

Initial example:

```text
AI text:
20 requests/user/hour

AI voice:
10 requests/user/hour

Global:
500 requests/hour
```

Tune after observing real usage.

---

# 29. Fallback

If Qwen is unavailable:

```text
NEXT
PAUSE
RESUME
PREVIOUS
```

still work through the simple command layer.

For recommendation:

```text
AI unavailable
 ↓
RecommendationService
```

The current deterministic recommendation system should remain active as the fallback. fileciteturn0file0L405-L413

---

# 30. Mobile UI

Add a global microphone button.

States:

```text
🎤 Idle
🔴 Listening
⏳ Thinking
▶️ Executing
✓ Done
⚠️ Failed
```

Show transcript:

```text
You:
"I'm stressed. Play something calm."
```

Then:

```text
SpotiBase:
"Playing something calm."
```

A dedicated assistant screen can be added later.

---

# 31. Mobile API

Create:

```text
mobile/src/api/aiApi.ts
```

Concept:

```typescript
export const aiApi = {
  text: (text: string, context?: AssistantContext) =>
    apiClient.post("/ai/text", { text, context }),

  voice: (audio: FormData) =>
    apiClient.post("/ai/voice", audio, {
      headers: {
        "Content-Type": "multipart/form-data"
      }
    })
};
```

Keep AI credentials server-side.

---

# 32. TTS

First version:

```text
Voice
 ↓
STT
 ↓
Action
 ↓
Text response
```

Later:

```text
Text response
 ↓
Piper TTS
 ↓
Audio
 ↓
User hears response
```

Keep voice responses short:

```text
"Playing the next song."
"Added it to your Chill playlist."
"Playing some calm Tamil music."
```

---

# 33. Do Not Add pgvector Immediately

The audit currently has no pgvector and recommends starting simple. fileciteturn0file0L421-L447

For the first assistant version use:

```text
PostgreSQL filters
+
existing FTS/trigram
+
mood/genre/language metadata
+
RecommendationService
```

Later add:

```text
pgvector
song_embeddings
semantic ranking
```

---

# 34. Suggested AI Database Evolution

Current:

```text
V1 ... V20
```

Next:

```text
V21__ai_song_metadata.sql
V22__ai_playlist_metadata.sql
V23__assistant_history.sql   # optional
V24__pgvector.sql            # later
```

Never rewrite V1-V20.

---

# 35. Testing

The project already has 323 backend tests and 119 mobile Jest tests. Add AI tests to these existing suites. fileciteturn0file0L358-L367

## Basic intent tests

```text
"pause" → PAUSE
"continue" → RESUME
"skip" → NEXT
"next song" → NEXT
"previous" → PREVIOUS
```

## Complex tests

```text
"play calm Tamil songs"
```

must produce:

```text
PLAY_BY_MOOD
mood=CALM
language=Tamil
```

## Security tests

Ensure the assistant cannot:

```text
invent song IDs
access another user's playlist
execute unknown actions
execute SQL
bypass authorization
```

## End-to-end

```text
Voice
 ↓
STT
 ↓
Qwen
 ↓
Action
 ↓
Spring Boot
 ↓
STOMP
 ↓
React Native
 ↓
Player
 ↓
ACK
```

---

# 36. Observability

Track:

```text
ai_request_count
ai_success_count
ai_failure_count
ai_fallback_count
ai_latency_ms
stt_latency_ms
llm_latency_ms
action_success_count
action_failure_count
invalid_json_count
clarification_count
```

Never log:

```text
OPENAI_API_KEY
private credentials
unnecessary PII
```

---

# 37. Deployment

Recommended:

```text
                    Internet
                       │
                       ▼
                     nginx
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
       Spring Boot             Mobile/PWA
            │
            │ private HTTP
            ▼
       spotibase-ai
            │
       ┌────┴─────┐
       ▼          ▼
    Qwen 3B    Whisper
```

Do not expose Qwen directly to every mobile client.

---

# 38. Environment Variables

Add:

```text
AI_ENABLED=true
AI_SERVICE_URL=http://spotibase-ai:7860

AI_RATE_LIMIT_PER_USER=10
AI_GLOBAL_RATE_LIMIT=500

AI_MAX_AUDIO_MB=15

QWEN_MODEL=Qwen2.5-3B-Instruct
STT_MODEL=small
```

Mobile only needs public application configuration:

```text
EXPO_PUBLIC_API_URL
EXPO_PUBLIC_AI_ENABLED
```

Never expose model/database/API credentials to the mobile app.

---

# 39. Exact Ticket Order

## AI-001

```text
Qwen hosted
+
/assistant/understand
```

Success:

```text
"pause"
→
{"action":"PAUSE"}
```

## AI-002

```text
Spring Boot AssistantController
+
DTOs
+
ActionDispatcher
```

## AI-003

```text
NEXT / PAUSE / RESUME / PREVIOUS
→ existing player via STOMP
```

## AI-004

```text
Player ACK
```

## AI-005

```text
Mobile microphone
→ audio upload
```

## AI-006

```text
faster-whisper
→ transcript
```

## AI-007

```text
Voice
→ STT
→ Qwen
→ action
```

## AI-008

```text
Mood + genre + language recommendation
```

## AI-009

```text
Queue + playlist + like manipulation
```

## AI-010

```text
Multi-action commands
```

## AI-011

```text
Automatic song tagging
```

## AI-012

```text
TTS
```

## AI-013

```text
Semantic search / pgvector
```

---

# 40. First Milestone

Your first real milestone should be:

```text
🎤 "Next song"
       ↓
faster-whisper
       ↓
"next song"
       ↓
simple command detector
       ↓
NEXT
       ↓
Spring Boot
       ↓
STOMP
       ↓
React Native
       ↓
TrackPlayer.next()
       ↓
ACK
```

Then:

```text
🎤 "Pause the song"
```

Then:

```text
🎤 "Play some calm Tamil songs."
```

Then:

```text
🎤 "I'm stressed. Don't play sad songs.
Play calm Tamil songs and add the first one to my queue."
```

---

# 41. Definition of Done

The MVP is complete when:

- [ ] Qwen2.5-3B is hosted
- [ ] `/api/v1/ai/text` works
- [ ] structured actions are validated
- [ ] simple commands bypass Qwen
- [ ] NEXT works
- [ ] PREVIOUS works
- [ ] PAUSE works
- [ ] RESUME works
- [ ] STOMP player commands work
- [ ] player ACK works
- [ ] microphone recording works
- [ ] faster-whisper transcription works
- [ ] voice → Qwen works
- [ ] mood requests work
- [ ] genre/language filters work
- [ ] queue manipulation works
- [ ] playlist manipulation works
- [ ] like/unlike works
- [ ] multi-action commands work
- [ ] ambiguous commands ask clarification
- [ ] ownership checks work
- [ ] rate limits work
- [ ] AI fallback works
- [ ] backend tests pass
- [ ] mobile tests pass

---

# 42. Final Architecture

```text
                         SPOTIBASE
                            │
             ┌──────────────┴──────────────┐
             │                             │
             ▼                             ▼
       React Native                    Spring Boot
             │                             │
        ┌────┴────┐              ┌────────┼─────────┐
        │         │              │        │         │
   Microphone   Player       Assistant   Music    STOMP
        │         │              │        │         │
        ▼         │              ▼        ▼         ▼
       VAD        │          AI Service  DB      Player Cmd
        │         │              │
        ▼         │          ┌───┴────┐
     Whisper      │          │        │
        │         │         Qwen     STT
        └─────────┼──────────│────────│
                  │          │        │
                  ▼          └────────┘
             Voice Assistant
```

## The key idea

Do not build a chatbot that happens to control SpotiBase.

Build an **AI orchestration layer over the existing SpotiBase services**:

```text
Natural language
      ↓
Qwen understands intent
      ↓
Structured actions
      ↓
Spring Boot validates
      ↓
Existing services execute
      ↓
STOMP/player/database
```

That architecture lets you later replace Qwen2.5-3B with a stronger model without rewriting your player, queue, playlist, search, recommendation, authentication, or database layers.
