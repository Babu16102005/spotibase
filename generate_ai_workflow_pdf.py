from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                PageBreak, ListFlowable, ListItem, HRFlowable, KeepTogether)
from reportlab.lib import colors
import datetime

OUT = r"D:\Downloads\SpotiBase_AI_Workflow.pdf"

styles = getSampleStyleSheet()
ACCENT = HexColor("#6C3CE0")
DARK = HexColor("#1A1A2E")
GRAY = HexColor("#555555")

styles.add(ParagraphStyle("DocTitle", parent=styles["Title"], fontSize=22, textColor=ACCENT, alignment=TA_CENTER, spaceAfter=4))
styles.add(ParagraphStyle("DocSub", parent=styles["Normal"], fontSize=10, textColor=GRAY, alignment=TA_CENTER, spaceAfter=8))
styles.add(ParagraphStyle("H1", parent=styles["Heading1"], fontSize=15, textColor=DARK, spaceBefore=14, spaceAfter=6, keepWithNext=True))
styles.add(ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, textColor=ACCENT, spaceBefore=10, spaceAfter=4, keepWithNext=True))
styles.add(ParagraphStyle("H3", parent=styles["Heading3"], fontSize=10.5, textColor=DARK, spaceBefore=8, spaceAfter=3))
styles.add(ParagraphStyle("Body", parent=styles["Normal"], fontSize=9, leading=13, alignment=TA_LEFT, spaceAfter=4))
styles.add(ParagraphStyle("Bullet2", parent=styles["Normal"], fontSize=9, leading=13, leftIndent=14, bulletIndent=4, spaceAfter=2))
styles.add(ParagraphStyle("Code2", parent=styles["Code"], fontSize=7.5, leading=10, backColor=HexColor("#F4F2FF"), borderPadding=(4,4,4), spaceAfter=4))
styles.add(ParagraphStyle("TableCell", parent=styles["Normal"], fontSize=7.5, leading=10))
styles.add(ParagraphStyle("TableHead", parent=styles["Normal"], fontSize=7.5, leading=10, textColor=colors.white))
styles.add(ParagraphStyle("Footer", parent=styles["Normal"], fontSize=7, textColor=GRAY, alignment=TA_CENTER))

def P(txt, style="Body"):
    return Paragraph(txt, styles[style])

def table(headers, rows, widths=None):
    data = [[P(f"<b>{h}</b>", "TableHead") for h in headers]]
    for r in rows:
        data.append([P(str(c), "TableCell") for c in r])
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), ACCENT),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("GRID", (0,0), (-1,-1), 0.4, HexColor("#CCCCCC")),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, HexColor("#F8F7FF")]),
        ("LEFTPADDING", (0,0), (-1,-1), 5),
        ("RIGHTPADDING", (0,0), (-1,-1), 5),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ]))
    return t

story = []
story.append(P("SpotiBase — Current AI Workflow", "DocTitle"))
story.append(P("Complete end-to-end workflow: mobile voice + Spring orchestrator + FastAPI runtime + search + cache + DB", "DocSub"))
story.append(P(f"Generated: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} | Source: D:\\babu_projects\\spotibase | Modes: AI_MODE=mock, STT_MODE=mock", "DocSub"))
story.append(HRFlowable(width="100%", thickness=1, color=ACCENT))

# 1 Overview
story.append(P("1. Overview & Golden Rule", "H1"))
story.append(P("SpotiBase AI is a 3-tier hybrid: <b>Expo mobile (capture + interim STT)</b> → <b>Spring Boot (private orchestrator, JWT-gated, decides IF/HOW)</b> → <b>FastAPI spotibase-ai :7860 (stateless runtime, proposes WHAT)</b> → <b>Postgres + Redis + R2</b>. Mobile never calls FastAPI directly. FastAPI has zero DB access. All execution goes through Spring domain services + STOMP push back to the player.", "Body"))
story.append(table(["Plane", "Owns", "Key files"],
 [[ "Mobile", "Mic, interim text, playback", "AiOrb.tsx, aiApi.ts/client.ts, aiOrbStore, SettingsScreen" ],
  [ "Spring ai/*", "Auth, validation, routing, execution", "AssistantController/Service, QwenClient, SimpleCommandDetector, ActionDispatcher" ],
  [ "FastAPI", "STT, NLU rules, tagging, cache", "routes/assistant|speech|audio_tag, services/llm|stt|cache, prompts/assistant_system.txt" ],
  [ "Data", "Songs, tags, history", "Postgres V5/V21/V22/V23/V24, Redis 7, R2 spotibase-songs" ]],
 widths=[55,150,265]))

# 2 Tech stack exact
story.append(P("2. Exact Tech Stack (as-found)", "H1"))
story.append(table(["Layer", "Framework / lib / model"],
 [[ "Mobile", "expo ~57.0.24, RN 0.86.3, React 19.2.3, expo-audio ~57.0.5 (AudioRecorder HIGH_QUALITY .m4a), expo-speech-recognition ^57.1.0 (jamsch, native SFSpeech/SpeechRecognizer) + web SpeechRecognition, expo-speech ~57.0.3 installed UNUSED, expo-haptics ~57.0.3, axios 1.18, zustand, reanimated, stompjs" ],
  [ "AI runtime", "FastAPI + uvicorn[standard] + pydantic(+settings) + python-multipart + httpx + redis>=5 + dotenv on python:3.11-slim + ffmpeg; torch/transformers/accelerate/faster-whisper/webrtcvad/piper-tts COMMENTED (opt-in)" ],
  [ "Models", "Qwen/Qwen2.5-3B-Instruct (transformers local OR hf_api HF_TOKEN) default OFF; faster-whisper small (tiny/small/medium) default OFF; mock rule engine default ON" ],
  [ "Spring", "Boot 3.4.1 Java 17: web/security/jpa/websocket/redis/cache/actuator/webflux, postgresql+flyway, jjwt 0.12.6, springdoc, AWS s3 2.29.9, jaudiotagger, Bucket4j, caffeine; spring-ai-openai M5 EXCLUDED" ],
  [ "Infra", "postgres:16-alpine :5433, redis:7-alpine :6379, backend 8080→8088, ai :7860, R2 (auto region, pub-...r2.dev), WebClient 800ms connect / 3s response" ]],
 widths=[60,410]))

# 3 Entry points
story.append(P("3. Entry Points & Contracts", "H1"))
story.append(P("Mobile → Spring (JWT, /api/v1):", "H2"))
story.append(P("POST /ai/text {text, context} - AssistantResponse{transcript, actions[], response/displayText, results, clarification} | POST /ai/voice multipart(audio m4a/mp4/aac/webm/ogg/wav/mp3 max 15MB, transcript_fallback, context JSON OR flat fields) | GET /ai/health | GET /search | GET /search/suggestions | WS /ws queue-updates, ai-player", "Code2"))
story.append(P("Spring to FastAPI (private, no mobile direct):", "H2"))
story.append(P("POST /assistant/understand {text, context} | POST /speech/voice {audio+fallback+context} | POST /speech/transcribe {audio} | POST /audio/tag {title,artist,genre,language} | GET /health (true even in mock)", "Code2"))
story.append(P("AssistantResponse.results[i].songs is playback source of truth. transcript echoes fallback when service leaves blank. clarificationNeeded never triggers playback. ALLOWED_ACTIONS (30) single source, double-filtered (Python + Java).", "Body"))

# 4 Mobile flow
story.append(P("4. Mobile Voice Flow (AiOrb.tsx, ~1200 lines)", "H1"))
story.append(P("<b>Permissions (Expo v57):</b> native AudioModule.getRecordingPermissionsAsync → requestRecordingPermissionsAsync → setAudioModeAsync({allowsRecording:true, playsInSilentMode:true}); speech ExpoSpeechRecognitionModule.requestPermissionsAsync before start. Denied→rationale + Linking.openSettings + keyboard fallback. Web single getUserMedia({audio:true}); LAN-IP shows localhost:8081 guidance. app.json: RECORD_AUDIO, NSMicrophone/NSSpeechRecognition, expo-audio + expo-speech-recognition plugins with options form.", "Body"))
story.append(P("<b>Recording:</b> native AudioRecorder(RecordingPresets.HIGH_QUALITY) prepare→record→stop→.uri (.m4a); 7s auto-stop once via recorderRef (stale-closure fixed); web MediaRecorder opus/webm + parallel interim. Second tap stops. abort() on unmount.", "Body"))
story.append(P("<b>Realtime interim:</b> start({lang:'en-US', interimResults:true}) + useSpeechRecognitionEvent('result') → live transcript + debounce 250ms suggestions; final transcript → handleVoiceUri(uri, transcript_fallback) else handleText(fallback) on 400. aiApi.voice lets axios set boundary (manual Content-Type removed); MIME from ext.", "Body"))
story.append(P("<b>Action exec:</b> dynamic client import → PLAY_* via songApi/search → playMultiple/addToQueue, controls direct playerStore, likes via LikeService; direct-CDN plays ping GET /songs/{id}/stream?count=1 Range 0-0 (analytics); Remote* single-owner in index.ts service.", "Body"))

# 5 Spring orchestrator
story.append(P("5. Spring Orchestrator Flow", "H1"))
story.append(P("AssistantController (15MB pre-size-check, MIME whitelist, MissingPart→{transcript,actions:[]}, 401 not anonymous) → AssistantService: <b>1)</b> SimpleCommandDetector 8-regex bypass (next/pause/resume/prev/like/shuffle) → dispatch; <b>2)</b> QwenClient understandText/Voice (+800ms partial variant) → dispatch loop with firstResultSongId chaining; <b>3)</b> unavailable → CLARIFICATION_NEEDED. QwenClient timeouts FULL 3s, filename normalize, mapToQwenResponse drops invalid actions.", "Body"))
story.append(P("ActionDispatcher (switch 30): PAUSE/RESUME/NEXT/PREV/SHUFFLE/REPEAT/VOLUME → STOMP AI_PLAYER_COMMAND; SEARCH_* → SearchService.search(q,types,0,5) → songs:[ids]+displayText; PLAY_BY_MOOD/GENRE/LANGUAGE → getRecommendedSongs(20) + filterByMoodGenreLanguage (mood/vibe/activity substring, genre, language exact, exclude_mood List|String) + QueueService.addToQueue(AI_MOOD) + QUEUE_SYNC; PLAY_SIMILAR → getSimilarSongs; ADD_TO_QUEUE/LIKE via currentSongId; ADD_TO_PLAYLIST/CREATE → CLARIFICATION_NEEDED stub (never fake success).", "Body"))
story.append(P("SearchService: union GREATEST(ts_rank, similarity(name/artist/album), ILIKE 0.1) WHERE FTS OR col%q OR ILIKE, lower(col)%lower(q) hits V24 lower-trgm, lower LIKE prefix% hits prefix btree, ESCAPED wildcards, page/size clamped 50, voice fast path searchSongsForVoice limit-5 (<150ms).", "Body"))

# 6 FastAPI
story.append(P("6. FastAPI Runtime (mock default)", "H1"))
story.append(P("<b>LLM llm_service (~940 lines):</b> AI_MODE mock|transformers|hf_api. mock = normalize(lower/trim/quotes) → verbs → difflib fuzzy (aniruth→Anirudh) → ARTIST_ALIASES 20+ → MOOD/LANG/GENRE/VIBE → patterns (play X by Y→SEARCH_SONG, by Y→ARTIST, hits→ARTIST, mood+lang→PLAY_BY_MOOD, bare play→SEARCH_SONG) → stopword-strip searchQuery + _smart_title + parsedKeywords{song,artist,mood,genre,language,verbs} + displayText; unknown→clarification + 3 suggestions [Play calm Tamil songs, Play Anirudh hits, Play 90s melodies]. transformers lazy pipeline(max_new 512) + sanitize; hf_api 2-retry→mock; Redis understand:v2 300s (no clarify).", "Body"))
story.append(P("<b>STT stt_service:</b> STT_MODE mock→'' (forces fallback) | faster-whisper tiny|small|medium beam 5, tmpfile, Redis stt:v1 600s, never raises, latency logs. routes/speech: /transcribe 15MB cap, /voice fallback substitution + passthrough. cache_service REDIS_URL fail-open 1.5s.", "Body"))
story.append(P("<b>Tagging audio_tag:</b> rule_tag 6-branch (conquest→ENERGETIC 0.88/128bpm, love/kadhal→ROMANTIC, sad/sogam, happy/kolaveri, yuvan, anirudh else CALM/CHILL 0.45/92bpm); Qwen branch pass. AiTaggingService mirrors Java ruleBased fallback; called per upload, never blocks.", "Body"))

# 7 DB/Redis/R2
story.append(P("7. Data, Cache, Storage", "H1"))
story.append(table(["Store", "Schema / keys"],
 [[ "Postgres", "V5 fts_vector GIN+trigger; V21 mood/vibe/activity JSONB GIN + energy/valence/bpm + ai_tagged + ai_conversations; V22 pg_trgm+ossp; V23 active/playcount/new; V24 lower-trgm + prefix pattern_ops + playlists trgm (no CONCURRENTLY)" ],
  [ "Redis shared", "understand:v2:{mode}:{norm}:{ctx} 300s, stt:v1:{model}:{sha} 600s, songs/playlist/home 2m-5m, fail-open both sides" ],
  [ "R2", "spotibase-songs/songs/** UUID immutable, Cache public 3600, proxy 206 1MB first-chunk + Range/ETag" ]],
 widths=[70,400]))

# 8 Sequence
story.append(P("8. End-to-End Sequences", "H1"))
story.append(P("<b>Text:</b> chip/keyboard → POST /ai/text → bypass? dispatch : Qwen /understand → dispatcher (SEARCH top-5 / MOOD queue) → STOMP + playMultiple → displayText. <b>Voice:</b> orb → perms → recorder + interim → stop → POST /ai/voice {audio+fallback+context} → :7860 /speech/voice (STT→fallback→LLM) → same dispatch. Empty→\"I couldn't hear you\". >15MB→413. <b>Upload:</b> R2 + PROCESSING → POST /audio/tag → SET READY.", "Body"))
story.append(P("Latency: partial suggest &lt;300ms, full voice &lt;2.5s mock (Whisper small CPU ~1s + Qwen &lt;300ms + search &lt;150ms); first-hit pays full, repeats cached. No PCM streaming (interim text only).", "Body"))

# 9 Config/Ops
story.append(P("9. Config, Limits, Safety", "H1"))
story.append(table(["Item", "Value"],
 [[ "Env", "AI_MODE/STT_MODE=mock, STT_MODEL=small, QWEN_MODEL=Qwen/Qwen2.5-3B-Instruct, AI_SERVICE_URL=localhost:7860 (compose spotibase-ai:7860), REDIS_URL localhost:6379/0, HF_TOKEN empty, OPENAI empty" ],
  [ "Limits", "audio 15MB both sides, text 2000, WebClient 800ms/3s, mobile voice 30s, page/size ≤50, queue 500 CallerRuns" ],
  [ "Safety", "JWT on /ai/*, FastAPI private (no auth), allow-list both layers, no SQL/IDs from LLM, secrets env-only, PII transcript logged (scope before share)" ]],
 widths=[60,410]))

story.append(P("10. File Map (where to look)", "H1"))
story.append(P("spotibase-ai/app/main.py, prompts/assistant_system.txt, schemas/assistant.py, routes assistant/speech/health/audio_tag, services llm/stt/cache, requirements.txt, Dockerfile<br/>backend ai: AssistantAction, dto, AssistantController, AssistantService, QwenClient, SimpleCommandDetector, ActionDispatcher, AiTaggingService, AiConfig; SearchService, RecommendationService, SearchController; V21,V22,V23,V24<br/>mobile AiOrb, AiMicButton, SiriOrb/StarOrb, aiApi+client, aiOrbStore, SettingsScreen, app.json, package.json", "Code2"))
story.append(P("Note: spring-ai-openai M5 present but autoconfig excluded (unused). expo-speech (TTS) installed, zero calls. pgvector deferred. vad_service missing.", "Body"))

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=1.6*cm, rightMargin=1.6*cm, topMargin=1.5*cm, bottomMargin=1.5*cm,
                        title="SpotiBase Current AI Workflow", author="SpotiBase")
def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(GRAY)
    canvas.drawCentredString(A4[0]/2, 1.1*cm, f"SpotiBase AI Workflow  •  page {doc.page}")
    canvas.restoreState()
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(f"WROTE {OUT}")
