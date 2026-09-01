# SpotiBase AI — Complete AI + Voice + Song Intelligence — Copyable Workflow

> Source: `D:\Downloads\SpotiBase_AI_Voice_Manipulation_Next_Steps.md` (copyable workflow diagrams)  
> Saved to project: `docs/SPOTIBASE_AI_COMPLETE_WORKFLOW.md` + `docs/SpotiBase_AI_Voice_Manipulation_Next_Steps.md` + root `SPOTIBASE_AI_VOICE_MANIPULATION_NEXT_STEPS.md`  
> Date: 2026-08-27  
> Purpose: Single verified reference before backend testing / AI branch

---

## Overview — User → Voice/Text → Qwen → Spring Boot → Player

```text
                              USER
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
              🎤 VOICE INPUT           📝 TEXT INPUT
                    |                       |
                    v                       |
               AUDIO RECORDING             |
                    |                       |
                    v                       |
              SPEECH-TO-TEXT               |
               Whisper/STT                  |
                    |                       |
                    +-----------+-----------+
                                |
                                v
                           USER TEXT
                                |
                                v
                    SIMPLE COMMAND CHECK
                         /            \
                       YES             NO
                        |               |
                        v               v
                 DIRECT ACTION       QWEN 2.5 3B
                        |               |
                        |               v
                        |        INTENT UNDERSTANDING
                        |               |
                        |               v
                        |        MOOD UNDERSTANDING
                        |               |
                        |               v
                        |        PARAMETER EXTRACTION
                        |               |
                        |               v
                        |        ACTION GENERATION
                        |               |
                        +-------+-------+
                                |
                                v
                         STRUCTURED JSON
                                |
                                v
                         SPRING BOOT API
                                |
                                v
                       AUTHENTICATION
                                |
                                v
                       ACTION VALIDATION
                                |
                                v
                       AUTHORIZATION
                                |
                                v
                       ACTION DISPATCHER
                                |
        +-----------------------+-----------------------+
        |                       |                       |
        v                       v                       v
   PLAYBACK                RECOMMENDATION          PLAYLIST / QUEUE
    SERVICE                   SERVICE                  SERVICE
        |                       |                       |
        |                       v                       v
        |                  SUPABASE DB             SUPABASE DB
        |                       |
        +-----------+-----------+
                    |
                    v
              STOMP / WEBSOCKET
                    |
                    v
             REACT NATIVE / EXPO
                    |
                    v
                PLAYER STORE
                    |
             +------+------+
             |             |
             v             v
        TRACKPLAYER       SHAKA
          NATIVE           WEB
             |             |
             +------+------+
                    |
                    v
                   🎵
                PLAYBACK
                    |
                    v
              PLAYER ACKNOWLEDGEMENT
                    |
                    v
             SPRING BOOT RESPONSE
                    |
                    v
               OPTIONAL TTS
                    |
                    v
                   🔊
```

---

## AI Infrastructure

```text
                         HUGGING FACE
                              |
                              v
                         FASTAPI AI
                              |
              +---------------+---------------+
              |               |               |
              v               v               v
           WHISPER         QWEN 2.5 3B       TTS
             STT              LLM           OPTIONAL
              |               |
              |               |
              +-------+-------+
                      |
                      v
                 AI RESPONSE
```

**FASTAPI RESPONSIBILITIES:**
- Speech-to-text
- Qwen inference
- Intent extraction
- Mood interpretation
- Parameter extraction
- Structured action generation
- Optional text-to-speech
- AI health/status

**SPRING BOOT RESPONSIBILITIES:**
- Authentication
- Authorization
- User context
- AI orchestration
- Action validation
- Existing business logic
- Database access
- Recommendation
- Queue
- Playlist
- Likes
- WebSocket/STOMP

---

## Song Upload → AI Tagging Workflow

```text
                         ADMIN
                           |
                           v
                     UPLOAD SONG
                           |
                           v
                  SUPABASE STORAGE
                           |
                           v
                    SONG DB RECORD
                           |
                           v
                  STATUS = PROCESSING
                           |
                           v
                    BACKGROUND JOB
                           |
                           v
                   AUDIO ANALYSIS
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
         BPM             ENERGY          VALENCE
          |                |                |
          +----------------+----------------+
                           |
                           v
                   AUDIO FEATURES
                           |
                           v
                AI / AUDIO CLASSIFIERS
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
        GENRE            MOOD             VIBE
          |                |                |
          |                |                |
          +----------------+----------------+
                           |
                           v
                       ACTIVITY
                           |
                           v
                  AI SONG METADATA
                           |
                           v
                 VALIDATE / NORMALIZE
                           |
                           v
                    SUPABASE DB
                           |
                           v
                    STATUS = READY
```

---

## AI Song Tagging

Every uploaded song can automatically receive:

**GENRE** → Pop / Rock / Hip-Hop / Melody / Classical / Electronic  
**MOOD** → Happy / Sad / Calm / Energetic / Romantic / Focused / Motivated / Nostalgic  
**VIBE** → Chill / Dreamy / Party / Dark / Feel-Good / Peaceful / Intense / Relaxing  
**ACTIVITY** → Workout / Study / Driving / Party / Sleep / Relax / Travel / Morning / Night  
**AUDIO FEATURES** → BPM / Energy / Valence / Loudness / Key / etc.

---

## Supabase Song AI Metadata

```json
{
    "id": 101,
    "title": "Example Song",
    "genre": ["POP", "MELODY"],
    "language": "TAMIL",
    "mood_tags": ["CALM", "ROMANTIC"],
    "vibe_tags": ["CHILL", "DREAMY"],
    "activity_tags": ["RELAX", "NIGHT"],
    "energy_score": 0.32,
    "valence_score": 0.71,
    "bpm": 82
}
```

Stored in existing Supabase PostgreSQL — see `songs` table. No new database required for MVP (controlled JSONB columns).

---

## AI Tagging + Voice Assistant Connection

```text
                    SONG UPLOAD
                         |
                         v
                  AUDIO ANALYSIS
                         |
                         v
                AI SONG TAGGING
                         |
                         v
                    SUPABASE
                         |
                         | Song metadata
                         v
                 RECOMMENDATION
                     SERVICE
                         |
                         v
                   VOICE AI
                         |
                         v
                       USER


Example — USER: 🎤 "I'm feeling stressed. Play something calm."

WHISPER → "I'm feeling stressed. Play something calm."
  → QWEN: { "actions": [{ "action": "PLAY_BY_MOOD", "parameters": { "mood": "CALM" } }] }
  → SPRING BOOT → RECOMMENDATION SERVICE → SUPABASE: mood_tags contains CALM
  → MATCHING SONGS → QUEUE → PLAYER → 🎵 MUSIC
```

---

## Vibe-Based Request

```text
USER: 🎤 "Play something chill and dreamy."
  → STT → QWEN: { "action": "PLAY_BY_MOOD", "parameters": { "vibe": ["CHILL","DREAMY"] } }
  → SPRING BOOT → RECOMMENDATION SERVICE → SUPABASE: vibe_tags = CHILL, DREAMY
  → SONGS → QUEUE → PLAYER
```

---

## Mood + Vibe + Genre

```text
USER: 🎤 "Play energetic Tamil rock songs."
  → STT → QWEN: { "action": "PLAY_BY_MOOD", "parameters": { "mood":"ENERGETIC", "genre":"ROCK", "language":"TAMIL" } }
  → SPRING BOOT → RECOMMENDATION SERVICE → SUPABASE: language=TAMIL, genre=ROCK, mood=ENERGETIC
  → RANK SONGS → QUEUE → PLAYER
```

---

## Mood + Vibe + Activity

```text
USER: 🎤 "I'm going to the gym. Play something energetic."
  → STT → QWEN: { "action":"PLAY_BY_MOOD", "parameters":{ "mood":"ENERGETIC", "activity":"WORKOUT" } }
  → SUPABASE: mood=ENERGETIC, activity=WORKOUT → RECOMMENDATION → QUEUE → PLAYER
```

---

## Full Complex Command

```text
USER: 🎤 "I'm stressed today. Don't play sad songs. Give me some calm Tamil songs, prefer something dreamy, and add the first song to my Chill playlist."

WHISPER → QWEN 2.5 3B → {
  "actions": [
    { "action":"PLAY_BY_MOOD", "parameters":{ "mood":"CALM", "language":"TAMIL", "exclude_mood":["SAD"], "vibe":["DREAMY"] } },
    { "action":"ADD_TO_PLAYLIST", "parameters":{ "playlist":"Chill", "target":"FIRST_RESULT" } }
  ]
}
  → SPRING BOOT → VALIDATION → RECOMMENDATION SERVICE → SUPABASE: language=TAMIL, mood=CALM, vibe=DREAMY, Exclude mood=SAD
  → RANK RESULTS → FIRST SONG → +----------+
                                   |          |
                                   v          v
                               PLAY SONG  ADD TO PLAYLIST → VERIFY OWNERSHIP → PLAYLIST SERVICE → SUPABASE
                                   |          |
                                   v          |
                                 QUEUE        |
                                   |          |
                                   v          v
                                 PLAYER   (done)
```

---

## "Make it more energetic" — Contextual

```text
USER: 🎤 "Play something calm." → QWEN: mood=CALM → RECOMMENDATION → SONGS
USER: 🎤 "Actually make it more energetic." → SHORT-TERM CONTEXT: lastMood=CALM
  → QWEN: { "action":"PLAY_BY_MOOD", "parameters":{ "mood":"ENERGETIC", "based_on":"CURRENT_CONTEXT" } }
  → RECOMMENDATION → PLAYER
```

---

## Similar Song Workflow

```text
USER: 🎤 "Play something similar to this." → STT → QWEN: { "action":"PLAY_SIMILAR", "parameters":{ "source":"CURRENT_SONG" } }
  → SPRING BOOT → CURRENT SONG → GENRE/MOOD/VIBE → RECOMMENDATION SERVICE → SUPABASE → SIMILAR SONGS → QUEUE → PLAYER

Later: SONG → EMBEDDING → PGVECTOR → SEMANTIC SIMILARITY → RECOMMENDATION
```

---

## Search + AI Workflow

```text
USER: 🎤 "Play songs by Anirudh." → STT → QWEN: { "action":"SEARCH_ARTIST", "parameters":{ "artist":"Anirudh" } }
  → SPRING BOOT → SEARCH SERVICE → SUPABASE → SONGS → QUEUE → PLAYER
```

---

## Queue / Playlist / Like / Player Workflows

```text
QUEUE:        "Add this song to my queue." → ADD_TO_QUEUE → QUEUE SERVICE → SUPABASE → STOMP → QUEUE UPDATED
PLAYLIST:     "Add this song to my Chill playlist." → ADD_TO_PLAYLIST → JWT USER → OWNERSHIP CHECK → PLAYLIST SERVICE → SUPABASE
LIKE:         "I like this song." → LIKE_CURRENT → LIKE SERVICE → SUPABASE → LIKE SAVED
PLAYER:       "Next song" → SIMPLE COMMAND DETECTOR → NEXT → STOMP/WEBSOCKET → PLAYER STORE → TRACKPLAYER/SHAKA → NEXT SONG → ACK
```

---

## Automatic Song Tagging (Admin Path)

```text
ADMIN UPLOAD → SUPABASE STORAGE → SONG RECORD → BACKGROUND PROCESSING → AUDIO ANALYSIS → BPM/ENERGY/VALENCE → AI TAGGING → GENRE/MOOD/VIBE → ACTIVITY → VALIDATION → SUPABASE DB → READY SONG
```

---

## Complete System

```text
                              SPOTIBASE
                                  |
          +-----------------------+-----------------------+
          |                                               |
          v                                               v
     USER INTERACTION                              ADMIN UPLOAD
          |                                               |
     +----+----+                                           |
     |         |                                           v
     v         v                                    SUPABASE STORAGE
   VOICE     TEXT                                          |
     |         |                                           v
     v         +--------------------+                SONG RECORD
   WHISPER                         |                      |
     |                             |                      v
     +-------------+---------------+                BACKGROUND JOB
                   |                                      |
                   v                                      v
                QWEN 3B                             AUDIO ANALYSIS
                   |                                      |
                   v                                      v
            ACTION JSON                              AI TAGGING
                   |                                      |
                   v                                      v
            SPRING BOOT                               SUPABASE
                   |                                      |
                   v                                      |
            ACTION DISPATCHER                             |
                   |                                      |
        +----------+----------+                            |
        |          |          |                            |
        v          v          v                            |
     PLAYER   RECOMMEND   PLAYLIST                         |
        |          |          |                            |
        |          v          v                            |
        |      SUPABASE   SUPABASE                         |
        |          |                                       |
        +----------+-------------------+-------------------+
                   |
                   v
             SONG METADATA
                   |
                   v
           BETTER RECOMMENDATIONS
                   |
                   v
                AI VOICE
                   |
                   v
                  USER
```

---

## Final Architecture

```text
                 HUGGING FACE CLOUD
                         |
                         v
                  FASTAPI AI SERVER
                         |
              +----------+----------+
              |                     |
              v                     v
        FASTER-WHISPER          QWEN 2.5 3B
              |                     |
              +----------+----------+
                         |
                         v
                  AI ACTION JSON
                         |
                         v
                    SPRING BOOT
                         |
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
   AUTHENTICATION   AI ORCHESTRATOR   ACTION VALIDATION
                         |
                         v
                  EXISTING SERVICES
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
      SEARCH       RECOMMENDATION    PLAYLIST
          |              |              |
          +--------------+--------------+
                         |
                         v
                    SUPABASE
                         |
          +--------------+--------------+
          |                             |
          v                             v
     SONG METADATA                  USER DATA
          |
          v
   GENRE / MOOD / VIBE
   ACTIVITY / ENERGY
   BPM / VALENCE
          |
          v
    RECOMMENDATION ENGINE
          |
          v
        QUEUE
          |
          v
       STOMP/WS
          |
          v
   REACT NATIVE / EXPO
          |
          v
       PLAYER
          |
          v
          🎵
```

---

## Responsibility Map

| Layer | Owns |
|---|---|
| **WHISPER** | Voice → Text |
| **QWEN 2.5 3B** | Text → Intent / Mood / Vibe / Parameters / Actions |
| **FASTAPI** | AI Runtime, STT, Qwen, Optional TTS |
| **SPRING BOOT** | Auth, Validation, Orchestration, Business logic, DB, Queue, Playlist, Recommendation, STOMP |
| **SUPABASE** | Users, Songs, Artists, Albums, Genres, Playlists, Queue, Likes, History, AI metadata |
| **AI SONG METADATA** | Genre, Mood, Vibe, Activity, Energy, Valence, BPM |
| **STOMP/WS** | Real-time Backend → Player |
| **REACT NATIVE/EXPO** | Voice UI, AI UI, Player UI, WS client |
| **TRACKPLAYER/SHAKA** | Actual playback |
| **TTS** | AI text → Voice |

---

## Golden Rule

```text
QWEN DOES NOT CONTROL SPOTIBASE DIRECTLY.

QWEN:  "WHAT DOES THE USER WANT?"
SPRING BOOT: "IS THIS ACTION VALID AND AUTHORIZED?"
EXISTING SERVICES: "HOW DO WE ACTUALLY PERFORM IT?"
SUPABASE: "STORE AND RETRIEVE THE DATA."
PLAYER:  "ACTUALLY PLAY THE MUSIC."
```

---

## Final User Experience

```text
USER: 🎤 "I'm stressed today. Play calm Tamil songs. Don't play sad songs. Prefer something dreamy. Add the first song to my Chill playlist."
  → WHISPER → QWEN 3B → ACTION JSON → SPRING BOOT → VALIDATE USER → VALIDATE ACTIONS → RECOMMENDATION SERVICE → SUPABASE → FIND MATCHING SONGS → RANK
               → +-----------+-----------+
                 |                       |
                 v                       v
           START PLAYBACK          FIRST SONG → CHILL PLAYLIST → OWNERSHIP CHECK → PLAYLIST SERVICE → SUPABASE
                 |                       |
                 v                       |
               QUEUE                     |
                 |                       |
                 v                       v
               STOMP                (completed)
                 |
                 v
            PLAYER STORE → TRACKPLAYER/SHAKA → 🎵 → ACK → TTS → 🔊

ASSISTANT: "Sure. I'm playing a calm dreamy Tamil song and I've added the first result to your Chill playlist."
```

---

## File Registry (this project)

| File | Purpose | Source |
|---|---|---|
| `PROJECT_PROGRESS_REPORT.md` | 82% progress audit + AI readiness + backlog A1-A8 | OrchestratorAgent audit 2026-08-27 |
| `docs/SpotiBase_AI_Voice_Manipulation_Next_Steps.md` | Full 42-section next-steps plan (P0-P8, DTOs, prompts, tickets AI-001..013) | Copy of `D:\Downloads\SpotiBase_AI_Voice_Manipulation_Next_Steps.md` |
| `SPOTIBASE_AI_VOICE_MANIPULATION_NEXT_STEPS.md` | Same as above (root mirror for quick access) | Copy |
| `docs/SPOTIBASE_AI_COMPLETE_WORKFLOW.md` | **This file** — copyable ASCII workflows (voice→Qwen→Spring Boot→Player + tagging) | Pasted workflow block in task |
| `docs/api-overview.md` | Endpoint map + auth + STOMP | existing |
| `README.md` | Monorepo guide | existing |

All three AI docs are copyable — paste any `text` block into design docs, tickets, or prompts.

---

## Verify Before Backend Test

```powershell
# 1. Verify files exist
Get-ChildItem "D:\babu_projects\spotibase\*.md", "D:\babu_projects\spotibase\docs\*.md" | Select-Object Name, Length

# 2. Verify backend still builds (no AI changes yet)
cd D:\babu_projects\spotibase\backend
mvn test -DskipTests=false -Dspring.profiles.active=test  # or mvn test

# 3. Verify frontend
cd D:\babu_projects\spotibase\mobile
npm run typecheck; npm run lint

# 4. Check drift before branching feat/ai
git status
```

Next recommended git step (do not edit V1-V20 after):

```powershell
git add backend/src/main/resources/application.yml backend/src/main/resources/db/migration/V18__create_indexes.sql backend/src/main/resources/db/migration/V19__add_contributing_artists_and_denormalized_fields.sql
git commit -m "chore: reconcile migration drift before ai"
git checkout -b feat/ai-voice-assistant
```

---

*End — Ready to branch feat/ai-voice-assistant and start AI-001.*
