import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  Modal,
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Linking,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  cancelAnimation,
  interpolate,
} from 'react-native-reanimated';
import { usePlayerStore, useThemeStore } from '../store';
import { useYouTubePlayerStore } from '../store/youtubePlayerStore';
import type { YouTubeVideo } from '../types/youtube';
import { useShallow } from 'zustand/react/shallow';
import { useAiOrbStore, AI_ORB_VARIANTS, AI_ORB_GLOW_COLORS } from '../store/aiOrbStore';
import apiClient, { aiApi, songApi, searchApi, multipartHeaders } from '../api/client';
import { useVoiceOrchestrator } from '../api/voiceOrchestrator';
import { VoiceLiveResults } from './VoiceLiveResults';
import type { SongResponse } from '../types';
import { SiriOrb } from './SiriOrb';
import { StarOrb } from './StarOrb';
import { Strands } from './Strands';
import Icon from './Icon';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  type AudioRecorder,
} from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import * as Speech from 'expo-speech';

type AiState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'done' | 'error';

const { width: SCREEN_W } = Dimensions.get('window');

// 7s listen window (mirrors the scheduleAutoStop timeout below). Drives the
// "Listening... (live) · Ns" countdown shown in the sheet and LIVE badge.
const LISTEN_WINDOW_MS = 7000;

// Double-tap window for the orb kill-switch: two presses within this window
// while active (listening/thinking/speaking) cancel everything and go idle
// — no upload, no new listen. Manual timestamp (RN has no onDoublePress)
// keeps web + native parity.
const DOUBLE_TAP_WINDOW_MS = 400;

export const AiOrb: React.FC = () => {
  const { theme } = useThemeStore();
  const { variant } = useAiOrbStore();
  const orbColors = AI_ORB_VARIANTS[variant].colors;
  const playerState = usePlayerStore(
    useShallow((s) => ({
      currentTrack: s.currentTrack,
      next: s.next,
      previous: s.previous,
      pause: s.pause,
      resume: s.resume,
      togglePlayPause: s.togglePlayPause,
      setShuffle: s.setShuffle,
      queue: s.queue,
      play: s.play,
      playMultiple: s.playMultiple,
      addToQueue: s.addToQueue,
    }))
  );

  const [state, setState] = useState<AiState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [response, setResponse] = useState<string>('');
  const [showSheet, setShowSheet] = useState(false);
  const [inputText, setInputText] = useState<string>('');
  const [isKeyboardMode, setIsKeyboardMode] = useState<boolean>(false);

  // Realtime voice search: interim transcripts stream into the orchestrator,
  // which debounces (250ms) and fetches live partials (POST /ai/voice-partial
  // when available, else /search fallback) with AbortController cancel +
  // requestId stale-supersede. The full stop path (handleVoiceUri ->
  // /ai/voice -> executeAction -> playMultiple via QUEUE_SYNC) is unchanged;
  // the orchestrator only drives the live chips rendered in the sheet.
  const voice = useVoiceOrchestrator({
    getContext: () => ({
      currentSongId: playerState.currentTrack?.id,
      currentArtist: playerState.currentTrack?.artistName,
      playing: true,
    }),
  });

  // Active AI state: rest of the time (idle) -> normal orb; once clicked/active -> Strands
  const isUserActive = state !== 'idle';

  // Live countdown for the 7s listen window.
  const listenStartedAtRef = useRef<number>(0);
  const [listenSecsLeft, setListenSecsLeft] = useState<number>(
    Math.ceil(LISTEN_WINDOW_MS / 1000)
  );
  useEffect(() => {
    if (state !== 'listening') return;
    listenStartedAtRef.current = Date.now();
    setListenSecsLeft(Math.ceil(LISTEN_WINDOW_MS / 1000));
    const t = setInterval(() => {
      const left = Math.max(
        0,
        Math.ceil((LISTEN_WINDOW_MS - (Date.now() - listenStartedAtRef.current)) / 1000)
      );
      setListenSecsLeft(left);
    }, 250);
    return () => clearInterval(t);
  }, [state]);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  // Native recorder held in a ref (not state) so the 7s auto-stop timeout
  // never captures a stale `recording` closure.
  const recorderRef = useRef<AudioRecorder | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isListeningRef = useRef(false);
  // Mirrors `transcript` state for use inside timeouts/handlers without stale closures.
  const transcriptRef = useRef<string>('');
  // Latest interim/final transcript from native expo-speech-recognition.
  const sttTranscriptRef = useRef<string>('');
  // Single-mic-owner fallback: STT `recordingOptions.persist` writes its own
  // audio file (audioend event). Used when expo-audio loses the mic race.
  const sttAudioUriRef = useRef<string>('');
  // True when we fell back to STT-only after a busy/contention error.
  const singleMicModeRef = useRef(false);
  // Dedupe rapid taps / double submissions: same text within 1.5s is ignored,
  // and a second command never runs while one is already in flight.
  const actionInFlightRef = useRef(false);
  const lastCommandRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  // Double-tap kill-switch: timestamp of the last orb press.
  const lastTapAtRef = useRef(0);
  // Generation token: incremented by stopAll so late /ai/text + /ai/voice
  // responses (and their trailing idle timers) are dropped as stale instead
  // of playing/speaking after the user cancelled.
  const aiRequestTokenRef = useRef(0);

  const setTranscriptSync = (t: string) => {
    transcriptRef.current = t;
    setTranscript(t);
  };

  // Jarvis voice (expo-speech SDK v57.0.0, Expo Go compatible): every Jarvis
  // reply is spoken aloud via Speech.speak. speakReply sets state 'speaking'
  // while talking; onDone/onStopped/onError -> 'done'. stopSpeaking guards a
  // missing native module so web/jest never crash. speakTokenRef invalidates
  // stale callbacks when a new utterance starts or listening interrupts
  // (mutual exclusion: mic tap stops TTS).
  const speakTokenRef = useRef(0);
  const stopSpeaking = async (): Promise<void> => {
    speakTokenRef.current++;
    try {
      const mod: any = Speech as any;
      if (mod && typeof mod.stop === 'function') {
        await mod.stop();
      }
    } catch {}
  };
  const speakReply = (text?: string | null): void => {
    const clean = (text || '').trim();
    if (!clean) return;
    try {
      const mod: any = Speech as any;
      if (!mod || typeof mod.speak !== 'function') return;
      // Stop previous utterance before queuing the new one (expo-speech
      // queues by default; stop() clears the queue so only the latest
      // Jarvis line is audible). Fire-and-forget: never await here.
      try {
        const maybe = mod.stop();
        if (maybe && typeof maybe.catch === 'function') maybe.catch(() => {});
      } catch {}
      const myToken = ++speakTokenRef.current;
      setState('speaking');
      // After the utterance finishes (or is stopped / errors), show 'done'
      // briefly, then fall back to idle so the Strands design returns to the
      // normal orb instead of sticking around after the work is complete.
      const settleToIdle = () => {
        setTimeout(() => {
          if (speakTokenRef.current === myToken) setState('idle');
        }, 1500);
      };
      mod.speak(clean, {
        onDone: () => {
          if (speakTokenRef.current === myToken) {
            setState('done');
            settleToIdle();
          }
        },
        onStopped: () => {
          if (speakTokenRef.current === myToken) {
            setState('done');
            settleToIdle();
          }
        },
        onError: () => {
          if (speakTokenRef.current === myToken) {
            setState('done');
            settleToIdle();
          }
        },
      });
    } catch {}
  };

  // Helpers: classify mic contention (dual-mic race) vs other failures.
  // Expo v57: STT owns the mic; expo-audio record() can throw busy/in-use.
  const isBusyMessage = (msg?: string) =>
    /busy|already.*(recording|started|in use)|in use|EBUSY|AudioRecord|start failed|audio-capture/i.test(
      msg || ''
    );

  // P0-1: error-path session teardown — mirrors onOrbPress start-failure
  // cleanup (clearAutoStop + isListeningRef=false + abort STT + recorder
  // stop) so an STT error that shows Alert+idle never leaves the 7s timer,
  // STT session, or recorder running.
  const abortSttAndClearSessionSync = () => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    isListeningRef.current = false;
    if (Platform.OS === 'web') return;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {}
    try {
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (rec) {
        const maybeStop = (rec as any).stop();
        if (maybeStop && typeof maybeStop.catch === 'function') maybeStop.catch(() => {});
      }
    } catch {}
  };

  // Collect realtime STT results on native (web uses Web SpeechRecognition below).
  useSpeechRecognitionEvent('result', (event) => {
    if (Platform.OS === 'web') return;
    const first = event.results?.[0] as unknown as { transcript?: string; isFinal?: boolean } | undefined;
    const t = first?.transcript ?? (event.results?.[0] as any)?.transcript;
    const isFinal = (event as unknown as { isFinal?: boolean }).isFinal ?? first?.isFinal ?? true;
    if (t) {
      // Interim results update the UI live; final results commit the transcript.
      sttTranscriptRef.current = t;
      transcriptRef.current = t;
      setTranscript(t);
      // Realtime voice search: stream interim text into the debounced
      // partial fetch (live chips). Stale/superseded responses are dropped
      // inside the orchestrator via requestId.
      voice.pushInterim(t);
      void isFinal;
    }
  });
  // Single-mic-owner audio: STT persists its own file when
  // recordingOptions.persist is set. Capture it for the stop path so an
  // expo-audio busy/empty uri still uploads.
  useSpeechRecognitionEvent('audioend', (event) => {
    if (Platform.OS === 'web') return;
    const uri = (event as unknown as { uri?: string | null })?.uri;
    if (uri) {
      sttAudioUriRef.current = uri;
      console.log('[STT] audioend uri', uri);
    }
  });
  // Expo v57 STT error codes: aborted | audio-capture | interrupted |
  // bad-grammar | language-not-supported | network | no-speech | not-allowed |
  // service-not-allowed | busy | client | speech-timeout | unknown.
  // Every code maps to a specific user-facing message (never a silent log,
  // never a generic fallback string).
  useSpeechRecognitionEvent('error', (event) => {
    if (Platform.OS === 'web') return;
    const code = ((event as unknown as { error?: string })?.error || 'unknown') as string;
    const rawMsg = (event as unknown as { message?: string })?.message || '';
    console.log('[STT] error', code, rawMsg);
    if (code === 'aborted') return;
    // Post-stop errors (after the user tapped to stop) are already handled by
    // the stop flow's uri/transcript branches — only surface live errors plus
    // actionable post-stop failures. no-speech post-stop stays silent here
    // because the stop flow shows "No audio"/"No speech detected".
    const live = isListeningRef.current;
    const actionable = code !== 'no-speech' && code !== 'speech-timeout';
    if (!live && !actionable) return;
    if (code === 'not-allowed') {
      const msg = 'Microphone error: permission denied. Allow microphone in Settings to use voice.';
      setResponse(msg);
      // P0-1: teardown session so Alert+idle never leaves timer/STT/recorder running.
      abortSttAndClearSessionSync();
      showMicDenied('denied', rawMsg || code);
    } else if (code === 'audio-capture') {
      const msg =
        'Microphone error: could not capture audio. Another app may be using the mic — close it and tap to retry.';
      setResponse(msg);
      // P0-1: teardown session (timer/listening/STT/recorder) — same as start-failure.
      // Free the extra recorder so the next tap runs single-mic (STT only).
      abortSttAndClearSessionSync();
      singleMicModeRef.current = true;
      showMicDenied('busy', rawMsg || code);
    } else if (code === 'busy') {
      const msg =
        'Microphone error: microphone is busy. Another recording holds it — retrying single-mic (speech only). Tap to retry.';
      setResponse(msg);
      // P0-1: teardown session (timer/listening/STT/recorder) — same as start-failure.
      abortSttAndClearSessionSync();
      singleMicModeRef.current = true;
      console.log('[Mic] STT busy — dropped expo-audio recorder, continuing STT-only');
      showMicDenied('busy', rawMsg || code);
    } else if (code === 'network' || code === 'service-not-allowed') {
      const msg =
        'Microphone error: speech service needs network / is unavailable. Check connection and retry, or type instead.';
      setResponse(msg);
      // P0-1: teardown session so Alert+idle never leaves timer/STT/recorder running.
      abortSttAndClearSessionSync();
      showMicDenied('no-service', rawMsg || code);
    } else if (code === 'no-speech' || code === 'speech-timeout') {
      // No Alert — just a specific hint. Listening continues until auto-stop.
      setResponse('No speech detected — speak clearly or type your command instead.');
    } else {
      const detail = rawMsg ? ` — ${rawMsg}` : '';
      setResponse(
        `Microphone error (${code})${detail}. Try again or type your command instead.`
      );
      // P0-1: teardown session so Alert+idle never leaves timer/STT/recorder running.
      abortSttAndClearSessionSync();
      if (code === 'language-not-supported' || code === 'client' || code === 'unknown') {
        showMicDenied('no-service', `${code}${detail}`);
      } else {
        setState('idle');
        Alert.alert(
          'Microphone Error',
          `Microphone error (${code})${detail}. Try again or type your command.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Type Instead', onPress: () => setIsKeyboardMode(true) },
          ]
        );
      }
    }
  });

  // Best-effort cleanup so a stray recorder/STT session never outlives the orb.
  // Also stops Jarvis TTS (mutual exclusion on unmount).
  useEffect(() => {
    return () => {
      if (autoStopTimerRef.current) {
        clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = null;
      }
      isListeningRef.current = false;
      speakTokenRef.current++;
      try {
        const maybe = (Speech as any)?.stop?.();
        if (maybe && typeof maybe.catch === 'function') maybe.catch(() => {});
      } catch {}
      if (Platform.OS !== 'web') {
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {}
        const rec = recorderRef.current;
        recorderRef.current = null;
        if (rec) {
          try {
            const maybeStop = rec.stop();
            if (maybeStop && typeof (maybeStop as Promise<void>).catch === 'function') {
              (maybeStop as Promise<void>).catch(() => {});
            }
          } catch {}
        }
      }
    };
  }, []);

  // Animations
  const rotation = useSharedValue(0);
  const pulse = useSharedValue(1);
  const orbScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.5);
  const glowScale = useSharedValue(1);

  useEffect(() => {
    // Idle: slow rotation and bright natural light breathing
    rotation.value = withRepeat(withTiming(360, { duration: 12000, easing: Easing.linear }), -1, false);
    pulse.value = withRepeat(withSequence(withTiming(1.06, { duration: 2400, easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) })), -1, true);
    glowScale.value = withRepeat(
      withSequence(
        withTiming(1.10, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.98, { duration: 2600, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      true
    );
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.68, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.38, { duration: 2600, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      true
    );
  }, []);

  useEffect(() => {
    if (state === 'listening') {
      rotation.value = withRepeat(withTiming(360, { duration: 1600, easing: Easing.linear }), -1, false);
      orbScale.value = withRepeat(withSequence(withTiming(1.06, { duration: 500 }), withTiming(1, { duration: 500 })), -1, true);
      glowScale.value = withRepeat(withSequence(withTiming(1.18, { duration: 600, easing: Easing.inOut(Easing.ease) }), withTiming(1.04, { duration: 600, easing: Easing.inOut(Easing.ease) })), -1, true);
      glowOpacity.value = withRepeat(withSequence(withTiming(0.85, { duration: 600 }), withTiming(0.55, { duration: 600 })), -1, true);
    } else if (state === 'thinking') {
      rotation.value = withRepeat(withTiming(360, { duration: 800, easing: Easing.linear }), -1, false);
      glowScale.value = withRepeat(withTiming(1.12, { duration: 400, easing: Easing.inOut(Easing.ease) }), -1, true);
      glowOpacity.value = withRepeat(withSequence(withTiming(0.75, { duration: 400 }), withTiming(0.45, { duration: 400 })), -1, true);
    } else if (state === 'idle') {
      rotation.value = withRepeat(withTiming(360, { duration: 12000, easing: Easing.linear }), -1, false);
      orbScale.value = withTiming(1, { duration: 400 });
      glowScale.value = withRepeat(
        withSequence(
          withTiming(1.10, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.98, { duration: 2600, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        true
      );
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(0.68, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.38, { duration: 2600, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        true
      );
    } else {
      // done/error - settle
      orbScale.value = withTiming(1, { duration: 300 });
      glowScale.value = withTiming(1, { duration: 300 });
      glowOpacity.value = withTiming(0.40, { duration: 300 });
    }
  }, [state]);

  const rotationStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const orbScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: orbScale.value }],
  }));

  const naturalGlowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowScale.value }],
    opacity: glowOpacity.value,
  }));

  const innerGlowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowScale.value * 0.95 }],
    opacity: glowOpacity.value * 1.25,
  }));

  // Commercial-grade transition between Normal Orb (idle) and Strands (active after click)
  const transitionProgress = useSharedValue(0);

  useEffect(() => {
    if (isUserActive) {
      transitionProgress.value = withTiming(1, {
        duration: 440,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
      });
    } else {
      transitionProgress.value = withTiming(0, {
        duration: 480,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      });
    }
  }, [isUserActive]);

  const normalOrbAnimatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(transitionProgress.value, [0, 1], [1, 0.32]);
    const opacity = interpolate(transitionProgress.value, [0, 0.65, 1], [1, 0.2, 0]);
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  const strandsAnimatedStyle = useAnimatedStyle(() => {
    const scale = interpolate(transitionProgress.value, [0, 0.85, 1], [0.35, 1.04, 1]);
    const opacity = interpolate(transitionProgress.value, [0, 0.35, 1], [0, 0.85, 1]);
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  const shouldDedupeCommand = (text: string): boolean => {
    const norm = text.trim().toLowerCase();
    const now = Date.now();
    if (actionInFlightRef.current) return true;
    if (norm && norm === lastCommandRef.current.text && now - lastCommandRef.current.at < 1500) return true;
    lastCommandRef.current = { text: norm, at: now };
    return false;
  };

  const getResultDisplayText = (data: any): string | undefined => {
    const results: any[] = data?.results || [];
    for (const r of results) {
      if (r && typeof r.displayText === 'string' && r.displayText.trim()) return r.displayText;
    }
    return undefined;
  };

  /**
   * Single owner for AI playback.
   * Backend `results[i].songs` (IDs) is the source of truth -> songApi.getById
   * -> playMultiple. `searchApi` is ONLY a fallback when the backend returns
   * zero ids or none of them resolve.
   * NOTE: backend PLAY_BY_MOOD also pushes STOMP QUEUE_SYNC, but we
   * intentionally do NOT subscribe to it here — the playMultiple below is the
   * one explicit play, so there is never a double play.
   * Returns the exact bubble text that was set (so executeAction can speak it).
   */
  const playBackendSongIds = async (
    songIds: string[],
    resultDisplayText?: string,
    fallbackQuery?: string,
    playLabel?: string,
    // Default 5-cap preserves every existing caller; PLAY_LIKED passes 20 so
    // the full backend-served liked queue (<=20 ids) plays instead of 5.
    maxCount: number = 5,
  ): Promise<string> => {
    const uniqueIds = [...new Set((songIds || []).filter(Boolean))].slice(0, maxCount);
    if (uniqueIds.length > 0) {
      const songs: any[] = [];
      for (const sid of uniqueIds) {
        try {
          const r = await songApi.getById(sid);
          if (r.data) songs.push(r.data);
        } catch {}
      }
      if (songs.length > 0) {
        await playerState.playMultiple(songs, 0);
        // Success refines the pre-surfaced displayText into a concrete
        // "Playing" line; empty paths below keep displayText / No results.
        const text = playLabel ? `Playing ${playLabel} - ${songs[0].title}` : `Playing ${songs[0].title}`;
        setResponse(text);
        return text;
      }
    }
    // Fallback only when backend was empty/unresolvable: one searchApi call.
    const q = (fallbackQuery || '').trim();
    if (q) {
      try {
        const r = await searchApi.search(q, 'song', 0);
        const s = r.data?.songs || [];
        if (s.length > 0) {
          await playerState.playMultiple(s, 0);
          const text = `Playing ${q} - ${s[0].title}`;
          setResponse(text);
          return text;
        }
      } catch {}
    }
    const text = resultDisplayText || (q ? `No results for '${q}'` : 'No results');
    setResponse(text);
    return text;
  };

  const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  /**
   * In-app YouTube playback for AI results. The backend lyric chain
   * (youtubeLyricFallback) returns QUEUED_YOUTUBE + videoId inside
   * results[i] while the action stays PLAY/SEARCH_* — so this must run
   * before the action switch, or the video is silently dropped and only
   * local songs (or "No results") play. Plays via the global single
   * YouTube player (same as tapping a row) — never an external app.
   * Returns the spoken line, or null when this result is not a video.
   */
  const playYoutubeResult = (result: any): string | null => {
    const rawId = result?.videoId;
    const videoId = typeof rawId === 'string' ? rawId.trim() : '';
    if (!YOUTUBE_ID_RE.test(videoId)) return null;
    const ytTitle =
      (typeof result?.title === 'string' && result.title.trim()) || 'Unknown title';
    const ytChannel =
      (typeof result?.channelTitle === 'string' && result.channelTitle.trim()) || '';
    const video: YouTubeVideo = {
      videoId,
      title: ytTitle,
      channelTitle: ytChannel,
      thumbnailUrl:
        (typeof result?.thumbnailUrl === 'string' && result.thumbnailUrl) ||
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };
    useYouTubePlayerStore.getState().playVideo(video);
    const ytText = `Playing ${ytTitle} on YouTube`;
    setResponse(ytText);
    return ytText;
  };

  const executeAction = async (data: any) => {
    const actions: any[] = data.actions || [];
    const results: any[] = data.results || [];
    let lastSpoken: string | undefined;
    for (let i = 0; i < actions.length; i++) {
      const act = actions[i];
      const action = act.action as string;
      const params = act.parameters || {};
      const result = results[i] || {};
      // Lyric-identified YouTube video (any action): play in-app first.
      if (result?.status === 'QUEUED_YOUTUBE') {
        const spoken = playYoutubeResult(result);
        if (spoken) {
          lastSpoken = spoken;
          continue;
        }
      }
      try {
        switch (action) {
          case 'CHAT': {
            // Free conversation (no music action): display + speak the Jarvis
            // text, never playback or search. Contract: results[i] =
            // {status: CHAT_OK, songs: [], displayText: <Jarvis text>},
            // top-level response mirrors it.
            const raw =
              (typeof result.displayText === 'string' && result.displayText.trim()
                ? result.displayText
                : (data as any)?.response || (data as any)?.displayText || '');
            const clean = String(raw || '').trim();
            if (clean) {
              setResponse(clean);
              lastSpoken = clean;
            }
            break;
          }
          case 'NEXT':
            await playerState.next();
            if (typeof result.displayText === 'string' && result.displayText.trim()) {
              setResponse(result.displayText);
              lastSpoken = result.displayText;
            }
            break;
          case 'PREVIOUS':
            await playerState.previous();
            if (typeof result.displayText === 'string' && result.displayText.trim()) {
              setResponse(result.displayText);
              lastSpoken = result.displayText;
            }
            break;
          case 'PAUSE':
            await playerState.pause();
            if (typeof result.displayText === 'string' && result.displayText.trim()) {
              setResponse(result.displayText);
              lastSpoken = result.displayText;
            }
            break;
          case 'RESUME':
            await playerState.resume();
            if (typeof result.displayText === 'string' && result.displayText.trim()) {
              setResponse(result.displayText);
              lastSpoken = result.displayText;
            }
            break;
          case 'PLAY':
          case 'PLAY_SONG': {
            // Backend-first (like PLAY_BY_MOOD). Bare PLAY with no ids/query
            // is just a resume.
            const songIds: string[] = result.songs || [];
            const fallbackQuery =
              params.query ||
              [params.song, params.artist].filter(Boolean).join(' ') ||
              params.artist ||
              params.song ||
              params.title ||
              params.name ||
              '';
            if (songIds.length === 0 && !fallbackQuery.trim()) {
              await playerState.resume();
              if (typeof result.displayText === 'string' && result.displayText.trim()) {
                setResponse(result.displayText);
                lastSpoken = result.displayText;
              }
              break;
            }
            const label = params.artist || params.song || fallbackQuery || 'results';
            lastSpoken = await playBackendSongIds(songIds, result.displayText, fallbackQuery, label);
            break;
          }
          case 'SHUFFLE_ON':
            playerState.setShuffle(true);
            if (typeof result.displayText === 'string' && result.displayText.trim()) {
              setResponse(result.displayText);
              lastSpoken = result.displayText;
            }
            break;
          case 'SHUFFLE_OFF':
            playerState.setShuffle(false);
            if (typeof result.displayText === 'string' && result.displayText.trim()) {
              setResponse(result.displayText);
              lastSpoken = result.displayText;
            }
            break;
          case 'LIKE_CURRENT': {
            // call like API if current track exists
            try {
              const curId = playerState.currentTrack?.id;
              if (curId) await songApi.like(curId);
            } catch {}
            if (typeof result.displayText === 'string' && result.displayText.trim()) {
              setResponse(result.displayText);
              lastSpoken = result.displayText;
            }
            break;
          }
          case 'SEARCH_ARTIST':
          case 'SEARCH_SONG':
          case 'SEARCH_ALBUM': {
            // Prefer backend results.songs IDs; searchApi only when empty.
            const songIds: string[] = result.songs || [];
            const query =
              params.query || params.song || params.artist || params.album || params.title || params.name || '';
            const label = params.artist || params.song || query || 'results';
            lastSpoken = await playBackendSongIds(songIds, result.displayText, query, label);
            break;
          }
          case 'PLAY_BY_MOOD':
          case 'PLAY_BY_GENRE':
          case 'PLAY_BY_LANGUAGE': {
            // Backend already queued via ActionDispatcher; play client-side for
            // instant feedback from result.songs IDs (single owner — the STOMP
            // QUEUE_SYNC push is intentionally not auto-played elsewhere).
            const songIds: string[] = result.songs || [];
            const vibe = Array.isArray(params.vibe) ? params.vibe[0] : params.vibe;
            const fallbackQuery = params.mood || params.genre || params.language || vibe || '';
            const label = params.mood || params.genre || params.language || vibe || 'matching';
            lastSpoken = await playBackendSongIds(songIds, result.displayText, fallbackQuery, label);
            break;
          }
          case 'PLAY_RANDOM': {
            // Backend live-serves one random id in result.songs with
            // displayText "Playing <title>". Backend-first like PLAY, but
            // with no fallback query — empty/unresolvable ids keeps the
            // backend displayText (or "No results").
            const songIds: string[] = result.songs || [];
            lastSpoken = await playBackendSongIds(songIds, result.displayText);
            break;
          }
          case 'PLAY_LIKED': {
            // Backend live-serves up to 20 liked ids (most-recent-first)
            // with displayText "Playing your liked songs (N songs)". Same
            // backend-first path, widened to 20 so the full liked queue
            // plays; success refines to "Playing liked songs - <title>".
            const songIds: string[] = result.songs || [];
            lastSpoken = await playBackendSongIds(songIds, result.displayText, '', 'liked songs', 20);
            break;
          }
          case 'PLAY_SIMILAR': {
            // Backend returns similar song ids in result.songs; play them without
            // restarting the current track when there is no similar context.
            const similarIds: string[] = result.songs || [];
            try {
              if (similarIds.length > 0) {
                const songs: any[] = [];
                for (const sid of similarIds.slice(0, 5)) {
                  try {
                    const r = await songApi.getById(sid);
                    if (r.data) songs.push(r.data);
                  } catch {}
                }
                if (songs.length > 0) {
                  await playerState.playMultiple(songs, 0);
                  const text = `Playing ${songs[0].title}`;
                  setResponse(text);
                  lastSpoken = text;
                  break;
                }
              }
              // Fallback: similarity via current track's artist (no 'similar' keyword search).
              const cur = playerState.currentTrack;
              const seed = cur?.artistName || cur?.title;
              if (seed) {
                const r = await searchApi.search(seed, 'song', 0);
                const s = (r.data?.songs || []).filter((t: any) => t.id !== cur?.id);
                if (s.length > 0) {
                  await playerState.playMultiple(s, 0);
                  const text = `Playing ${s[0].title}`;
                  setResponse(text);
                  lastSpoken = text;
                  break;
                }
              }
              if (typeof result.displayText === 'string' && result.displayText.trim()) {
                setResponse(result.displayText);
                lastSpoken = result.displayText;
              }
            } catch {}
            break;
          }
          case 'ADD_TO_QUEUE': {
            // Queue without restarting current playback: resolve the target id
            // (backend result.songId > params.songId > current) then append.
            try {
              const targetId: string | undefined =
                result.songId || params.songId || playerState.currentTrack?.id;
              if (!targetId) break;
              const alreadyQueued = (playerState.queue || []).find((t: any) => t.id === targetId);
              if (alreadyQueued) {
                if (typeof result.displayText === 'string' && result.displayText.trim()) {
                  setResponse(result.displayText);
                  lastSpoken = result.displayText;
                }
                break;
              }
              try {
                const r = await songApi.getById(targetId);
                if (r.data) await playerState.addToQueue(r.data);
              } catch {
                if (playerState.currentTrack && playerState.currentTrack.id === targetId) {
                  await playerState.addToQueue(playerState.currentTrack);
                }
              }
              if (typeof result.displayText === 'string' && result.displayText.trim()) {
                setResponse(result.displayText);
                lastSpoken = result.displayText;
              }
            } catch {}
            break;
          }
          case 'PLAY_YOUTUBE': {
            // Explicit YouTube request: videoId may ride in params (AI) or
            // in results[i] (backend QUEUED_YOUTUBE). Same in-app single
            // player as taps — never an external app.
            const spoken =
              playYoutubeResult({ ...result, ...params }) ??
              playYoutubeResult(result);
            if (spoken) {
              lastSpoken = spoken;
            } else if (result.displayText) {
              setResponse(result.displayText);
              lastSpoken = result.displayText;
            }
            break;
          }
          default:
            console.log('AI action not yet handled client-side:', action, params, result);
            break;
        }
      } catch (e) {
        console.warn('AI action failed', action, e);
      }
    }
    // Jarvis voice: speak the final reply once (short displayText/response
    // as-is). Prefers the refined "Playing ..." line when playback succeeded,
    // else the backend displayText / top-level response.
    const fallbackText = getResultDisplayText(data) || (data as any)?.response || (data as any)?.displayText;
    const toSpeak = (lastSpoken || fallbackText || '').trim();
    if (toSpeak) speakReply(toSpeak);
  };
  const searchApiSearch = async (q: string) => {
    try {
      const r = await searchApi.search(q, 'song', 0);
      const s = r.data?.songs || [];
      if (s.length > 0) await playerState.playMultiple(s, 0);
    } catch {}
  };

  const handleText = async (text: string) => {
    if (!text.trim()) return;
    // Dedupe rapid taps (e.g. double-tapped chips): same text within 1.5s or
    // a command already in flight is ignored.
    if (shouldDedupeCommand(text)) return;
    actionInFlightRef.current = true;
    const myReq = aiRequestTokenRef.current;
    // Freeze live partials: the full /ai/text result now owns the sheet.
    voice.cancel();
    setTranscriptSync(text);
    setState('thinking');
    if (isKeyboardMode) setShowSheet(true);
    try {
      const ctx = {
        currentSongId: playerState.currentTrack?.id,
        currentArtist: playerState.currentTrack?.artistName,
        playing: true,
      };
      const res = await aiApi.text(text, ctx);
      // Double-tap stop invalidates this generation: drop the late result so
      // nothing plays or speaks after the user cancelled.
      if (myReq !== aiRequestTokenRef.current) return;
      const data: any = res.data;
      if (data.clarificationNeeded) {
        const q = data.clarificationQuestion || 'Could you rephrase?';
        setResponse(q);
        // Jarvis voice: speak the clarification (short as-is).
        speakReply(q);
      } else {
        // Surface backend displayText (per-result) first; executeAction refines
        // it to "Playing <title>" on success or keeps "No results" on empty.
        setResponse(getResultDisplayText(data) || data.response || `Done: ${data.actions?.map((a: any) => a.action).join(', ')}`);
        setState('done');
        await executeAction(data);
        if (myReq !== aiRequestTokenRef.current) return;
      }
      setTimeout(() => {
        if (myReq !== aiRequestTokenRef.current) return;
        setState('idle');
        // keep sheet open for 2s to show response
        setTimeout(() => {
          if (myReq !== aiRequestTokenRef.current) return;
          setShowSheet(false);
        }, 1200);
      }, 900);
    } catch (e: any) {
      if (myReq !== aiRequestTokenRef.current) return;
      const msg = e?.response?.data?.message || e?.message || 'AI unavailable';
      setResponse(msg);
      setState('error');
      setTimeout(() => {
        if (myReq !== aiRequestTokenRef.current) return;
        setState('idle');
      }, 2000);
    } finally {
      if (myReq === aiRequestTokenRef.current) actionInFlightRef.current = false;
    }
  };

  const handleVoiceUri = async (uri: string, transcriptFallback?: string) => {
    const isPlaceholder = (t?: string) => !t || t === 'Listening...' || t === 'Listening... speak now' || t.trim() === '';
    const cleanFallback = isPlaceholder(transcriptFallback) ? undefined : transcriptFallback;
    if (!uri && !cleanFallback) return;
    const myReq = aiRequestTokenRef.current;
    // Freeze live partials: the full /ai/voice upload now owns the sheet.
    voice.cancel();
    setTranscriptSync(cleanFallback || 'Listening...');
    setState('thinking');
    if (isKeyboardMode) setShowSheet(true);
    try {
      const ctx = {
        currentSongId: playerState.currentTrack?.id,
        currentArtist: playerState.currentTrack?.artistName,
        playing: true,
      };
      // Web blob: uri is blob:http://... -> need real Blob for multipart, not {uri} object
      let res: any;
      if (Platform.OS === 'web' && uri && uri.startsWith('blob:')) {
        // Fetch the blob we created via URL.createObjectURL
        const blobResp = await fetch(uri);
        const blob = await blobResp.blob();
        const file = new File([blob], 'audio.webm', { type: blob.type || 'audio/webm' });
        const fd = new FormData();
        fd.append('audio', file);
        if (cleanFallback) fd.append('transcript_fallback', cleanFallback);
        fd.append('context', JSON.stringify(ctx));
        // Direct post to Spring Boot /ai/voice (which forwards to FastAPI).
        // Explicitly clear the apiClient application/json default so axios sets
        // `multipart/form-data; boundary=...` on the wire (else HTTP 415).
        // Uses the shared multipartHeaders() (AxiosHeaders.delete + plain
        // deletes + undefined merge-marker).
        res = await apiClient.post('/ai/voice', fd, {
          headers: multipartHeaders(),
          timeout: 30000,
        });
        // Revoke blob URI after use
        try { URL.revokeObjectURL(uri); } catch {}
      } else {
        // Native file:// or http: infer filename extension so client.ts sets the right MIME.
        const uriLower = (uri || '').split('?')[0].toLowerCase();
        const filename = uriLower.endsWith('.webm')
          ? 'audio.webm'
          : uriLower.endsWith('.ogg')
            ? 'audio.ogg'
            : uriLower.endsWith('.wav')
              ? 'audio.wav'
              : uriLower.endsWith('.mp3')
                ? 'audio.mp3'
                : uriLower.endsWith('.mp4')
                  ? 'audio.mp4'
                  : 'audio.m4a';
        res = await aiApi.voice(uri, cleanFallback, ctx, filename);
      }
      // Double-tap stop invalidates this generation: drop the late result so
      // nothing plays or speaks after the user cancelled.
      if (myReq !== aiRequestTokenRef.current) return;
      const data: any = res.data;
      // backend may echo transcript in data.transcript
      if (data.transcript) setTranscriptSync(data.transcript);
      if (data.clarificationNeeded) {
        const q = data.clarificationQuestion || 'Could you rephrase?';
        setResponse(q);
        // Jarvis voice: speak the clarification (short as-is).
        speakReply(q);
      } else {
        setResponse(getResultDisplayText(data) || data.response || `Done: ${data.actions?.map((a: any) => a.action).join(', ')}`);
        setState('done');
        await executeAction(data);
        if (myReq !== aiRequestTokenRef.current) return;
      }
      setTimeout(() => {
        if (myReq !== aiRequestTokenRef.current) return;
        setState('idle');
        setTimeout(() => {
          if (myReq !== aiRequestTokenRef.current) return;
          setShowSheet(false);
        }, 1200);
      }, 900);
    } catch (e: any) {
      if (myReq !== aiRequestTokenRef.current) return;
      // Missing-audio (backend 400 "Required part") vs mic vs upload failure:
      // always prefix specifically and surface status+message, never generic.
      const status = e?.response?.status as number | undefined;
      const serverMsg = e?.response?.data?.message as string | undefined;
      const raw = serverMsg || e?.message || '';
      const lower = String(raw).toLowerCase();
      if (cleanFallback) {
        console.log('[Voice] upload failed, fallback to text', cleanFallback, status, raw);
        return handleText(cleanFallback);
      }
      const isMissingAudio =
        (serverMsg || '').includes('Required part') || status === 400;
      const isMicErr =
        lower.includes('mic') ||
        lower.includes('microphone') ||
        lower.includes('audio-capture') ||
        lower.includes('not-allowed') ||
        lower.includes('permission');
      const prefix = isMicErr ? 'Microphone error' : 'Voice upload failed';
      const statusPart = status ? ` (status ${status})` : '';
      const msgPart = raw
        ? `: ${raw}`
        : ': request failed — check connection and retry';
      const hint = isMissingAudio
        ? ' — audio part missing, try again or check mic permission'
        : ' — try again or type your command';
      setResponse(`${prefix}${statusPart}${msgPart}${hint}`);
      setState('error');
      setTimeout(() => {
        if (myReq !== aiRequestTokenRef.current) return;
        setState('idle');
      }, 2000);
    }
  };

  const clearAutoStop = () => {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  };

  /**
   * Double-tap kill-switch: stop whatever the orb is doing (listening /
   * thinking / speaking) and park at idle — no upload, no new listen, no
   * late play/speak side effects.
   *
   * - listening: discards mic audio (revoke blob on web, drop recorder uri
   *   natively) + aborts STT + freezes live partials via voice.cancel.
   * - thinking: invalidates the in-flight /ai/text + /ai/voice generation
   *   (aiRequestTokenRef) so late responses return early and trailing
   *   idle/close timers no-op.
   * - speaking: Speech.stop (expo-speech v57: interrupts + clears queue) +
   *   speakTokenRef invalidation so stale onDone/onStopped never fire.
   * Keeps transcript/response context (does not wipe the sheet) and clears
   * only placeholder "Listening..." text.
   */
  const stopAll = async (): Promise<void> => {
    aiRequestTokenRef.current++;
    actionInFlightRef.current = false;
    clearAutoStop();
    isListeningRef.current = false;
    try { voice.cancel(); } catch {}
    await stopSpeaking();
    if (Platform.OS === 'web') {
      try { recognitionRef.current?.stop(); } catch {}
      recognitionRef.current = null;
      try {
        const rec: any = mediaRecorderRef.current;
        if (rec && rec.state !== 'inactive') {
          try { rec.onstop = null; } catch {}
          try { rec.stop(); } catch {}
          try { rec.stream?.getTracks?.()?.forEach?.((t: any) => { try { t.stop(); } catch {} }); } catch {}
        } else {
          try { rec?.stream?.getTracks?.()?.forEach?.((t: any) => { try { t.stop(); } catch {} }); } catch {}
        }
      } catch {}
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
    } else {
      try { ExpoSpeechRecognitionModule.abort(); } catch {}
      try {
        const rec = recorderRef.current;
        recorderRef.current = null;
        if (rec) {
          try {
            const maybeStop = (rec as any).stop();
            if (maybeStop && typeof maybeStop.catch === 'function') maybeStop.catch(() => {});
          } catch {}
        }
      } catch {}
    }
    sttAudioUriRef.current = '';
    if (isPlaceholderTranscript(transcriptRef.current)) setTranscriptSync('');
    setState('idle');
  };

  // Stable waveform heights: random once per listening session (memo), not
  // on every render, so bars don't jitter with each state update.
  const waveHeights = React.useMemo(() => [...Array(12)].map(() => 8 + Math.random() * 28), [state === 'listening']);

  const stopWebMedia = async (): Promise<{ uri: string; transcript?: string }> => {
    const recorder: MediaRecorder | null = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      const transcriptAtStop = transcriptRef.current;
      // Stop web speech recognition
      try { recognitionRef.current?.stop(); } catch {}
      recognitionRef.current = null;
      return new Promise((resolve) => {
        let settled = false;
        const finish = (uri: string) => {
          if (settled) return;
          settled = true;
          // Always release mic tracks + refs, even on empty blobs.
          try { (recorder.stream as any)?.getTracks()?.forEach((t: any) => t.stop()); } catch {}
          mediaRecorderRef.current = null;
          resolve({ uri, transcript: transcriptAtStop });
        };
        recorder.onstop = async () => {
          try {
            const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
            // Create object URL for upload
            const uri = URL.createObjectURL(blob);
            audioChunksRef.current = [];
            finish(uri);
          } catch {
            audioChunksRef.current = [];
            finish('');
          }
        };
        try {
          recorder.stop();
        } catch {
          finish('');
        }
        // Safety: never hang the stop-tap if onstop never fires.
        setTimeout(() => finish(''), 3000);
      });
    }
    // No active recorder: still release any orphaned stream tracks.
    try {
      const rec: any = mediaRecorderRef.current;
      rec?.stream?.getTracks?.()?.forEach?.((t: any) => { try { t.stop(); } catch {} });
    } catch {}
    mediaRecorderRef.current = null;
    return { uri: '', transcript: transcriptRef.current };
  };

  // expo-audio (SDK 57): getRecordingPermissionsAsync -> requestRecordingPermissionsAsync
  // -> setAudioModeAsync({ allowsRecording, playsInSilentMode })
  // -> new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY)
  // -> prepareToRecordAsync() -> record() -> stop() -> .uri
  const startNativeRecording = async () => {
    try {
      const current = await getRecordingPermissionsAsync();
      if (current.status !== 'granted') {
        const req = await requestRecordingPermissionsAsync();
        console.log('[Mic] perm status', req?.status);
        if (!req.granted) {
          const err: any = new Error('Mic permission denied: ' + req.status);
          err.status = req.status;
          err.code = 'not-allowed';
          throw err;
        }
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
      await recorder.prepareToRecordAsync();
      await recorder.record();
      recorderRef.current = recorder;
      return recorder;
    } catch (e: any) {
      console.log('[Mic] startNativeRecording error', e?.message);
      throw e;
    }
  };

  const stopNativeRecording = async (): Promise<string> => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    // STT-only (single-mic) mode has no expo-audio recorder — return the
    // STT-persisted file so the stop path still uploads.
    if (!recorder) return sttAudioUriRef.current || '';
    try {
      await recorder.stop();
      const uri = (recorder as unknown as { uri?: string }).uri || '';
      if (!uri && sttAudioUriRef.current) {
        console.log('[Mic] recorder uri empty, using STT persisted audio');
        return sttAudioUriRef.current;
      }
      return uri;
    } catch (e: any) {
      const code = e?.code ?? e?.status ?? 'stop-failed';
      const detail = e?.message || String(e);
      console.log('[Mic] stopNativeRecording failed', code, detail);
      // Prefer the STT-persisted file over a hard failure when available.
      if (sttAudioUriRef.current) {
        console.log('[Mic] stop failed, falling back to STT persisted audio');
        return sttAudioUriRef.current;
      }
      // Propagate with code + Microphone prefix (never swallow as '').
      const err: any = new Error(`Microphone error: stop failed (${code}) — ${detail}`);
      err.code = code;
      err.cause = e;
      throw err;
    }
  };

  const isPlaceholderTranscript = (t?: string) =>
    !t || t === 'Listening...' || t === 'Listening... speak now' || t.trim() === '';

  type MicDeniedReason = 'denied' | 'busy' | 'no-service' | 'error';

  const showMicDenied = (reason: MicDeniedReason, detail?: string) => {
    const clean = (detail || '').trim();
    // Never surface a bare code — always human-readable with the raw detail.
    if (reason === 'denied') {
      const display = clean
        ? `Microphone error: permission denied (${clean}). Allow microphone in Settings to use voice. Please type your command or check Settings -> Apps -> SpotiBase -> Microphone -> Allow.`
        : 'Microphone error: permission denied. Allow microphone in Settings to use voice. Please type your command or check Settings -> Apps -> SpotiBase -> Microphone -> Allow.';
      setResponse(display);
      setState('idle');
      setIsKeyboardMode(true);
      setShowSheet(true);
      Alert.alert(
        'Microphone Permission',
        'SpotiBase needs microphone for AI voice. Please Allow in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings?.() || Linking.openURL('app-settings:') },
          { text: 'Type Instead', onPress: () => { setIsKeyboardMode(true); setShowSheet(true); } },
        ]
      );
      return;
    }
    if (reason === 'busy') {
      const display = clean
        ? `Microphone error: microphone is busy (${clean}). Another app or recorder holds the mic — tap to retry single-mic, or type instead.`
        : 'Microphone error: microphone is busy. Another app or recorder holds the mic — tap to retry single-mic, or type instead.';
      setResponse(display);
      setState('idle');
      setIsKeyboardMode(false);
      Alert.alert(
        'Microphone Busy',
        clean
          ? `Microphone is busy (${clean}). We released the extra recorder — tap the orb to retry with a single mic, or type instead.`
          : 'Microphone is busy (another app or recorder holds it). We released the extra recorder — tap the orb to retry with a single mic, or type instead.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retry', onPress: () => setShowSheet(true) },
          { text: 'Type Instead', onPress: () => setIsKeyboardMode(true) },
        ]
      );
      return;
    }
    if (reason === 'no-service') {
      const display = clean
        ? `Microphone error: speech service unavailable (${clean}). Check network and device recognition service, then retry or type instead.`
        : 'Microphone error: speech service unavailable. Check network and device recognition service, then retry or type instead.';
      setResponse(display);
      setState('idle');
      Alert.alert(
        'Speech Service Unavailable',
        clean
          ? `Speech recognition is unavailable (${clean}). Check network / device speech service, then retry or type instead.`
          : 'Speech recognition is unavailable. Check network / device speech service, then retry or type instead.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retry', onPress: () => setShowSheet(true) },
          { text: 'Type Instead', onPress: () => setIsKeyboardMode(true) },
        ]
      );
      return;
    }
    const display = clean
      ? `Microphone error: ${clean}. Try again or type your command instead.`
      : 'Microphone error: recognition failed. Try again or type your command instead.';
    setResponse(display);
    setState('idle');
    Alert.alert('Microphone Error', display, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Retry', onPress: () => setShowSheet(true) },
      { text: 'Type Instead', onPress: () => setIsKeyboardMode(true) },
    ]);
  };

  const scheduleAutoStop = () => {
    clearAutoStop();
    autoStopTimerRef.current = setTimeout(async () => {
      autoStopTimerRef.current = null;
      // Run once: ignore if the user already tapped to stop.
      if (!isListeningRef.current) {
        console.log('[Mic] auto-stop skipped, not listening');
        return;
      }
      isListeningRef.current = false;
      // Freeze live partials before the full stop-path upload owns the sheet.
      voice.cancel();
      if (Platform.OS === 'web') {
        const rec: any = mediaRecorderRef.current;
        if (!rec || rec.state !== 'recording') {
          console.log('[Mic] auto-stop web: no active recorder');
          return;
        }
        setState('thinking');
        try {
          const { uri } = await stopWebMedia();
          const raw = transcriptRef.current;
          const clean = isPlaceholderTranscript(raw) ? undefined : raw;
          if (uri) await handleVoiceUri(uri, clean);
          else if (clean) await handleText(clean);
          else {
            setResponse('No speech');
            setState('error');
            setTimeout(() => setState('idle'), 1500);
          }
        } catch (e: any) {
          const raw = e?.message || String(e);
          console.log('[Mic] auto-stop web failed', raw);
          const msg = raw.startsWith('Voice upload failed') || raw.startsWith('Microphone error')
            ? raw
            : `Voice upload failed: ${raw}. Try again or type your command.`;
          setResponse(msg);
          setState('error');
          setTimeout(() => setState('idle'), 1500);
        }
      } else {
        // Native: STT-only single-mic mode may have no expo-audio recorder,
        // but STT persisted audio / transcript can still upload — do not bail
        // just because recorderRef is null.
        if (!recorderRef.current && !sttAudioUriRef.current && isPlaceholderTranscript(sttTranscriptRef.current)) {
          console.log('[Mic] auto-stop native: no recorder, no STT audio/transcript yet — still stopping STT');
        }
        setState('thinking');
        try {
          try {
            ExpoSpeechRecognitionModule.stop();
          } catch (stopErr: any) {
            console.log('[Mic] auto-stop STT stop failed', stopErr?.message || stopErr);
          }
          // Sequence: STT stop() first frees the mic, then stop the recorder.
          const uri = await stopNativeRecording();
          const clean = isPlaceholderTranscript(sttTranscriptRef.current)
            ? undefined
            : sttTranscriptRef.current;
          if (uri) await handleVoiceUri(uri, clean);
          else if (clean) await handleText(clean);
          else {
            setResponse('No audio');
            setState('error');
            setTimeout(() => setState('idle'), 1500);
          }
        } catch (e: any) {
          const raw = e?.message || String(e);
          console.log('[Mic] auto-stop native failed', (e as any)?.code, raw);
          const msg =
            raw.startsWith('Microphone error') || raw.startsWith('Voice upload failed')
              ? `${raw}. Try again or type your command.`
              : `Microphone error: auto-stop failed — ${raw}. Try again or type your command.`;
          setResponse(msg);
          setState('error');
          setTimeout(() => setState('idle'), 1500);
        }
      }
    }, 7000);
  };

  const startWebListening = async () => {
    // Single getUserMedia: the stream below both proves permission and feeds MediaRecorder.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType =
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    audioChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setTranscriptSync('Listening... speak now');
    // Web-only realtime STT via the browser SpeechRecognition API.
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = 'en-US';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (event: any) => {
        // Handle interim vs final: interim updates live, final commits.
        const res = event.results?.[0];
        const t = res?.[0]?.transcript;
        const isFinal = res?.isFinal ?? true;
        if (t) {
          setTranscriptSync(t);
          voice.pushInterim(t);
        }
        void isFinal;
      };
      rec.onend = () => {
        recognitionRef.current = null;
      };
      rec.onerror = () => {
        recognitionRef.current = null;
      };
      recognitionRef.current = rec;
      try {
        rec.start();
      } catch {}
    }
    scheduleAutoStop();
  };

  const startNativeListening = async () => {
    // Realtime STT first (needs its own mic + speech permissions).
    const sttPerm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!sttPerm.granted) {
      const err: any = new Error('Mic permission denied: ' + sttPerm.status);
      err.status = sttPerm.status;
      err.code = 'not-allowed';
      throw err;
    }
    // Expo v57 pre-check: recognition service available (network/service).
    try {
      const available = (ExpoSpeechRecognitionModule as unknown as { isRecognitionAvailable?: () => boolean }).isRecognitionAvailable?.();
      if (available === false) {
        const err: any = new Error(
          'Speech service unavailable on this device. Check network and device recognition service.'
        );
        err.code = 'service-not-allowed';
        throw err;
      }
    } catch (e: any) {
      if (e?.code === 'service-not-allowed') throw e;
      console.log('[Mic] availability check skipped', e?.message || e);
    }
    sttAudioUriRef.current = '';
    singleMicModeRef.current = false;
    // Single mic owner: STT persists its own audio file so the upload works
    // even when expo-audio loses the mic race. expo-audio is kept as a
    // fallback for devices without recording support.
    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        recordingOptions: { persist: true },
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (isBusyMessage(msg)) {
        singleMicModeRef.current = true;
        console.log('[Mic] STT start busy — continuing STT-only single-mic mode', msg);
      } else {
        throw e;
      }
    }
    try {
      await startNativeRecording();
    } catch (e: any) {
      const msg = e?.message || String(e);
      // Dual-mic contention: keep STT as the single owner and keep listening.
      if (isBusyMessage(msg) || String((e as any)?.code || '').toLowerCase().includes('busy')) {
        singleMicModeRef.current = true;
        console.log('[Mic] mic busy — continuing STT-only single-mic mode', msg);
        setTranscriptSync('Listening... speak now');
        scheduleAutoStop();
        return;
      }
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {}
      throw e;
    }
    setTranscriptSync('Listening... speak now');
    scheduleAutoStop();
  };

  /**
   * Commit a live (partial) result chip: end the mic session WITHOUT
   * uploading (no /ai/voice call, so no double-play with the auto-stop
   * flow), then play the tapped live list at the tapped index via
   * playMultiple. The full stop path (tap orb / auto-stop -> handleVoiceUri
   * -> /ai/voice -> QUEUE_SYNC -> playMultiple) remains the only uploader.
   */
  const commitPartialSelection = async (songs: SongResponse[], index: number) => {
    const song = songs[index];
    if (!song) return;
    // Re-entrancy guard (same as handleText): ignore concurrent chip taps
    // so rapid double-taps result in a single playMultiple.
    if (shouldDedupeCommand(`partial:${song.id || song.title}`)) return;
    actionInFlightRef.current = true;
    const myReq = aiRequestTokenRef.current;
    clearAutoStop();
    isListeningRef.current = false;
    voice.cancel();
    // Free the mic without uploading: discard recorder audio + STT session.
    if (Platform.OS === 'web') {
      try {
        const dropped = await stopWebMedia();
        try {
          if (dropped.uri) URL.revokeObjectURL(dropped.uri);
        } catch {}
      } catch {}
    } else {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch {}
      try {
        await stopNativeRecording();
      } catch {}
    }
    setTranscriptSync(song.title);
    setState('thinking');
    try {
      await playerState.playMultiple(songs, index);
      if (myReq !== aiRequestTokenRef.current) return;
      const text = `Playing ${song.title}`;
      setResponse(text);
      // Jarvis voice: speak the confirmed play line.
      speakReply(text);
      setTimeout(() => {
        if (myReq !== aiRequestTokenRef.current) return;
        setState('idle');
        setTimeout(() => {
          if (myReq !== aiRequestTokenRef.current) return;
          setShowSheet(false);
        }, 1200);
      }, 900);
    } catch {
      if (myReq !== aiRequestTokenRef.current) return;
      setResponse(`Could not play ${song.title} — try again or type your command.`);
      setState('error');
      setTimeout(() => {
        if (myReq !== aiRequestTokenRef.current) return;
        setState('idle');
      }, 2000);
    } finally {
      if (myReq === aiRequestTokenRef.current) actionInFlightRef.current = false;
    }
  };

  const onOrbPress = async () => {
    // Haptic
    try { const Haptics = require('expo-haptics'); await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}

    // Double-tap kill-switch: two presses within DOUBLE_TAP_WINDOW_MS while
    // the orb is active stop everything (listening/thinking/speaking) and
    // park at idle — no upload, no new listen. Single-tap paths below are
    // unchanged (listening tap submits, thinking tap is ignored, idle tap
    // stops TTS then listens).
    const now = Date.now();
    const isDoubleTap = now - lastTapAtRef.current < DOUBLE_TAP_WINDOW_MS;
    lastTapAtRef.current = now;
    if (isDoubleTap && state !== 'idle') {
      lastTapAtRef.current = 0;
      await stopAll();
      return;
    }

    if (state === 'listening') {
      // Second tap stops: sequence STT stop() first (frees the mic), then the
      // recorder, then upload with transcript_fallback.
      // Generation guard: a double-tap stopAll during the async mic stop
      // bumps aiRequestTokenRef — discard instead of uploading.
      const myReq = aiRequestTokenRef.current;
      clearAutoStop();
      isListeningRef.current = false;
      // Freeze live partials before the full /ai/voice upload owns the sheet.
      voice.cancel();
      setState('thinking');
      if (Platform.OS === 'web') {
        try {
          const rec: any = mediaRecorderRef.current;
          if (rec) {
            const { uri, transcript: t } = await stopWebMedia();
            if (myReq !== aiRequestTokenRef.current) return;
            const raw = t && t.length > 2 ? t : transcriptRef.current;
            const fallback = isPlaceholderTranscript(raw) ? undefined : raw;
            if (uri) {
              await handleVoiceUri(uri, fallback);
            } else if (fallback) {
              await handleText(fallback);
            } else {
              setResponse('No audio captured');
              setState('error');
              setTimeout(() => setState('idle'), 1500);
            }
          }
        } catch (e: any) {
          if (myReq !== aiRequestTokenRef.current) return;
          const raw = e?.message || String(e);
          console.log('[Mic] stop-tap web failed', raw);
          const msg =
            raw.startsWith('Voice upload failed') || raw.startsWith('Microphone error')
              ? raw
              : `Voice upload failed: ${raw}. Try again or type your command.`;
          setResponse(msg);
          setState('error');
          setTimeout(() => setState('idle'), 1500);
        }
      } else {
        // Native
        try {
          try {
            ExpoSpeechRecognitionModule.stop();
          } catch (stopErr: any) {
            console.log('[Mic] stop-tap STT stop failed', stopErr?.message || stopErr);
          }
          const uri = await stopNativeRecording();
          if (myReq !== aiRequestTokenRef.current) return;
          const raw = sttTranscriptRef.current;
          const fallback = isPlaceholderTranscript(raw) ? undefined : raw;
          if (uri) {
            await handleVoiceUri(uri, fallback);
          } else if (fallback) {
            await handleText(fallback);
          } else {
            setResponse('No audio');
            setState('error');
            setTimeout(() => setState('idle'), 1500);
          }
        } catch (e: any) {
          if (myReq !== aiRequestTokenRef.current) return;
          const raw = e?.message || String(e);
          console.log('[Mic] stop-tap native failed', (e as any)?.code, raw);
          const msg =
            raw.startsWith('Microphone error') || raw.startsWith('Voice upload failed')
              ? `${raw}. Try again or type your command.`
              : `Microphone error: ${raw}. Try again or type your command.`;
          setResponse(msg);
          setState('error');
          setTimeout(() => setState('idle'), 1500);
        }
      }
      return;
    }

    if (state === 'thinking') return;

    // Mutual exclusion: tapping to speak again stops any in-flight Jarvis TTS
    // before the mic opens (also invalidates stale onDone/onStopped).
    // Generation guard: a double-tap stopAll during this await bumps the
    // token — do not reopen the mic after a cancel.
    const listenReq = aiRequestTokenRef.current;
    await stopSpeaking();
    if (listenReq !== aiRequestTokenRef.current) return;

    // Start listening
    setTranscriptSync('');
    transcriptRef.current = '';
    sttTranscriptRef.current = '';
    sttAudioUriRef.current = '';
    singleMicModeRef.current = false;
    // Fresh live session: clear prior partial chips/errors.
    voice.reset();
    setResponse('');
    setState('listening');
    isListeningRef.current = true;

    if (Platform.OS === 'web') {
      try {
        await startWebListening();
      } catch (e: any) {
        clearAutoStop();
        isListeningRef.current = false;
        const msg = e?.message || String(e?.name || e);
        const host = typeof window !== 'undefined' ? (window.location?.hostname || '') : '';
        const isLanHost = !!host && host !== 'localhost' && host !== '127.0.0.1';
        const isSecureError =
          msg.includes('secure') || msg.includes('NotAllowedError') || e?.name === 'NotAllowedError' || isLanHost;
        const display = isSecureError
          ? 'Microphone blocked: Open via http://localhost:8081 (not 10.247...) and Allow. Tap to retry or type.'
          : 'Microphone access is unavailable. Please type your command.';
        setResponse(display);
        setState('idle');
        setIsKeyboardMode(true);
        if (isSecureError) {
          Alert.alert('Use localhost:8081 for mic', 'Chrome blocks mic on http://10.247... Use http://localhost:8081 and Allow when prompted.');
        }
      }
    } else {
      // Native
      try {
        await startNativeListening();
      } catch (e: any) {
        clearAutoStop();
        isListeningRef.current = false;
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {}
        try {
          await stopNativeRecording();
        } catch (cleanupErr: any) {
          console.log('[Mic] cleanup stop failed', cleanupErr?.code, cleanupErr?.message || cleanupErr);
        }
        const msg = e?.message || String(e);
        const code = String((e as any)?.code || (e as any)?.status || '').toLowerCase();
        console.log('[Mic] native start failed', code, msg);
        const lower = `${code} ${msg}`.toLowerCase();
        if (lower.includes('denied') || lower.includes('not-allowed') || lower.includes('permission')) {
          showMicDenied('denied', msg);
        } else if (isBusyMessage(msg) || lower.includes('busy') || lower.includes('audio-capture')) {
          showMicDenied('busy', msg);
        } else if (
          lower.includes('network') ||
          lower.includes('service-not-allowed') ||
          lower.includes('service') ||
          lower.includes('unavailable') ||
          lower.includes('language-not-supported')
        ) {
          showMicDenied('no-service', msg);
        } else {
          showMicDenied('error', msg);
        }
      }
    }
  };

  const onLongPress = () => {
    // Typing interrupts any in-flight Jarvis speech.
    speakTokenRef.current++;
    try {
      const maybe = (Speech as any)?.stop?.();
      if (maybe && typeof maybe.catch === 'function') maybe.catch(() => {});
    } catch {}
    setIsKeyboardMode(true);
    setShowSheet(true);
    setState('idle');
  };

  // Backdrop close: abort any in-flight listening (timer/STT/recorder +
  // live partials) AND stop Jarvis TTS before hiding, so closing mid-listen
  // or mid-speech never leaves the mic running, TTS talking, or a stale
  // upload racing the next tap.
  const closeSheet = () => {
    clearAutoStop();
    isListeningRef.current = false;
    try { voice.cancel(); } catch {}
    speakTokenRef.current++;
    try {
      const maybe = (Speech as any)?.stop?.();
      if (maybe && typeof maybe.catch === 'function') maybe.catch(() => {});
    } catch {}
    if (Platform.OS === 'web') {
      try { recognitionRef.current?.stop(); } catch {}
      recognitionRef.current = null;
      try {
        const rec: any = mediaRecorderRef.current;
        if (rec && rec.state !== 'inactive') {
          try { rec.stop(); } catch {}
          try { rec.stream?.getTracks?.()?.forEach?.((t: any) => { try { t.stop(); } catch {} }); } catch {}
        }
      } catch {}
      mediaRecorderRef.current = null;
    } else {
      try { ExpoSpeechRecognitionModule.abort(); } catch {}
      try {
        const rec = recorderRef.current;
        recorderRef.current = null;
        if (rec) {
          try {
            const maybeStop = (rec as any).stop();
            if (maybeStop && typeof maybeStop.catch === 'function') maybeStop.catch(() => {});
          } catch {}
        }
      } catch {}
    }
    setShowSheet(false);
  };

  const glowColors = AI_ORB_GLOW_COLORS[variant] || AI_ORB_GLOW_COLORS.classic;

  return (
    <>
      {/* Floating Orb with Natural Dynamic Light Glow Matching Orb Colors */}
      <View style={styles.orbWrapper} pointerEvents="box-none">
        {/* Seamless Borderless Volumetric Light Glow */}
        <Animated.View
          pointerEvents="none"
          style={[styles.radialGlowWrapper, naturalGlowStyle]}
        >
          <Svg width={112} height={112} viewBox="0 0 112 112">
            <Defs>
              <RadialGradient id={`orbRadialGlow_${variant}`} cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0%" stopColor={glowColors.inner} stopOpacity="0.95" />
                <Stop offset="35%" stopColor={glowColors.outer} stopOpacity="0.65" />
                <Stop offset="65%" stopColor={glowColors.outer} stopOpacity="0.25" />
                <Stop offset="88%" stopColor={glowColors.outer} stopOpacity="0.06" />
                <Stop offset="100%" stopColor={glowColors.outer} stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle cx="56" cy="56" r="56" fill={`url(#orbRadialGlow_${variant})`} />
          </Svg>
        </Animated.View>

        {/* Orb - switches between Siri and Star Duo based on Settings variant */}
        <Animated.View style={[orbScaleStyle]}>
          <TouchableOpacity
            testID="ai-orb-button"
            accessibilityLabel="AI voice button"
            accessibilityHint="Tap to speak. Double tap to stop speaking, thinking, or listening."
            onPress={onOrbPress}
            onLongPress={onLongPress}
            activeOpacity={1}
            style={styles.siriTouch}
          >
            {/* Thick 100% opaque base shield */}
            <View style={styles.thickBaseLayer} pointerEvents="none" />

            {/* Normal orb layer — compresses + fades out when user activates */}
            <Animated.View style={[styles.orbLayer, normalOrbAnimatedStyle]} pointerEvents="none">
              {variant === 'midnight' ? (
                <StarOrb size="58px" />
              ) : (
                <SiriOrb
                  size="58px"
                  colors={orbColors}
                  animationDuration={state === 'listening' ? 6 : 20}
                />
              )}
            </Animated.View>

            {/* Strands layer — blooms in when user activates */}
            <Animated.View style={[styles.orbLayer, strandsAnimatedStyle]} pointerEvents="none">
              <Strands
                size={58}
                count={4}
                speed={state === 'speaking' ? 1.4 : 1.0}
                amplitude={state === 'speaking' ? 1.3 : 1.0}
                waviness={1.4}
                thickness={0.8}
                glow={3.0}
                colors={
                  variant === 'midnight'
                    ? ['#ff3e1c', '#1c8cff', '#a855f7', '#38bdf8']
                    : ['#1DB954', '#1ed760', '#38bdf8', '#a855f7']
                }
                style={{ width: 58, height: 58, borderRadius: 29, overflow: 'hidden' }}
              />
            </Animated.View>
          </TouchableOpacity>
        </Animated.View>

        {/* Label below orb */}
        <View style={styles.labelWrap}>
          <Text style={[styles.label, { color: state === 'listening' ? '#FF3B30' : state === 'thinking' ? '#A78BFA' : state === 'speaking' ? '#1DB954' : theme.colors.textSecondary }]}>
            {state === 'idle' ? 'AI' : state === 'listening' ? 'Listening...' : state === 'thinking' ? 'Thinking...' : state === 'speaking' ? 'Speaking...' : state === 'done' ? 'Done' : 'Try again'}
          </Text>
        </View>

        {/* Accessible non-disruptive feedback container when not in keyboard mode */}
        {!isKeyboardMode && (
          <View style={styles.srOnly} pointerEvents="none" aria-live="polite">
            {!!transcript && <Text style={styles.bubbleText}>"{transcript}"</Text>}
            {!!response && <Text style={styles.bubbleText}>{response}</Text>}
          </View>
        )}
      </View>

      {/* Full-screen sheet only when in keyboard mode / explicit text entry */}
      <Modal visible={showSheet && isKeyboardMode} transparent animationType="fade" onRequestClose={closeSheet}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeSheet} />
          <View style={[styles.sheet, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            {/* Header illusion */}
            <View style={styles.sheetHeader}>
              <View style={[styles.sheetGlow, { backgroundColor: theme.colors.primary }]} />
              <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>SpotiBase AI</Text>
              <Text style={[styles.sheetSub, { color: theme.colors.textSecondary }]}>
                {isKeyboardMode ? 'Type your command below' : state === 'listening' ? `Listening... (live) · ${listenSecsLeft}s — tap orb to stop` : state === 'thinking' ? 'Understanding...' : state === 'speaking' ? 'Speaking... — tap orb to interrupt' : 'Tap orb and speak'}
              </Text>
            </View>

            {/* Mode Toggle Button */}
            <TouchableOpacity 
              style={styles.toggleModeBtn} 
              onPress={() => {
                setIsKeyboardMode(!isKeyboardMode);
                if (state === 'listening') {
                  onOrbPress();
                }
              }}
            >
              <Text style={{ color: theme.colors.primary, fontSize: 13, fontWeight: '600' }}>
                {isKeyboardMode ? '🎙️ Switch to Voice' : '⌨️ Switch to Keyboard'}
              </Text>
            </TouchableOpacity>

            {/* Waveform + LIVE countdown when listening (heights memoized) */}
            {!isKeyboardMode && state === 'listening' && (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityRole="progressbar"
                accessibilityLabel={`Listening live, ${listenSecsLeft} seconds remaining`}
                style={styles.liveWrap}
              >
                <Text style={[styles.liveBadge, { color: '#FF3B30' }]}>● LIVE · {listenSecsLeft}s</Text>
                <View style={styles.waveWrap}>
                {waveHeights.map((h, i) => (
                  <Animated.View
                    key={i}
                    style={[
                      styles.waveBar,
                      { backgroundColor: theme.colors.primary, height: h },
                      pulseStyle,
                    ]}
                  />
                ))}
                </View>
              </View>
            )}

            {state === 'thinking' && (
              <View style={styles.thinkingWrap}>
                <Animated.View style={[styles.thinkingRing, rotationStyle, { borderColor: theme.colors.primary }]} />
                <ActivityIndicator color={theme.colors.primary} style={{ position: 'absolute' }} />
              </View>
            )}

            {!!transcript && (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={`You said ${transcript}`}
                style={[styles.bubble, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}
              >
                <Text style={[styles.bubbleLabel, { color: theme.colors.textSecondary }]}>You said</Text>
                <Text style={[styles.bubbleText, { color: theme.colors.text }]}>"{transcript}"</Text>
              </View>
            )}

            {/* Realtime live results: skeleton while partials load, top-5 song
                chips when they resolve, Retry + Type-instead on failure.
                Tapping a chip commits it (mic freed, no /ai/voice upload)
                and plays via playMultiple. */}
            {!isKeyboardMode && (state === 'listening' || state === 'thinking') && (
              <VoiceLiveResults
                theme={theme}
                loading={voice.partialLoading}
                songs={voice.partialSongs}
                error={voice.partialError}
                query={voice.partialQuery}
                onSelect={(songs, index) => {
                  void commitPartialSelection(songs, index);
                }}
                onRetry={voice.retry}
                onTypeInstead={() => setIsKeyboardMode(true)}
              />
            )}

            {!!response && (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={`Jarvis says ${response}`}
                style={[styles.bubble, styles.responseBubble, { backgroundColor: theme.dark ? '#1DB95415' : '#F0FDF4', borderColor: theme.colors.primary + '30' }]}>
                <Text style={[styles.bubbleLabel, { color: theme.colors.primary }]}>AI</Text>
                <Text style={[styles.bubbleText, { color: theme.colors.text }]}>{response}</Text>
              </View>
            )}

            {/* Keyboard input box when in keyboard mode */}
            {isKeyboardMode && (
              <View style={[styles.inputContainer, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
                <TextInput
                  style={[styles.textInput, { color: theme.colors.text }]}
                  placeholder="Type a command (e.g. Play calm Tamil songs)..."
                  placeholderTextColor={theme.colors.textSecondary}
                  value={inputText}
                  onChangeText={setInputText}
                  onSubmitEditing={() => {
                    if (inputText.trim()) {
                      handleText(inputText);
                      setInputText('');
                      Keyboard.dismiss();
                    }
                  }}
                />
                <TouchableOpacity
                  style={[styles.sendButton, { backgroundColor: theme.colors.primary }]}
                  onPress={() => {
                    if (inputText.trim()) {
                      handleText(inputText);
                      setInputText('');
                      Keyboard.dismiss();
                    }
                  }}
                >
                  <Text style={styles.sendButtonText}>Send</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Quick chips when idle/done */}
            {(state === 'idle' || state === 'done' || state === 'error') && (
              <View style={styles.chipsWrap}>
                <Text style={[styles.chipsTitle, { color: theme.colors.textSecondary }]}>Try saying</Text>
                <View style={styles.chips}>
                  {[
                    'Play calm Tamil songs',
                    'Play Anirudh hits',
                    'Next song',
                    'Pause music',
                    'Play energetic songs',
                    'Like this song',
                    'Shuffle on',
                  ].map((chip) => (
                    <TouchableOpacity key={chip} style={[styles.chip, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]} onPress={() => handleText(chip)}>
                      <Text style={[styles.chipText, { color: theme.colors.text }]}>{chip}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {!isKeyboardMode && (
                  <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>Long press orb for text input • Tap orb to speak • Double-tap to stop</Text>
                )}
              </View>
            )}

            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: theme.colors.background }]} onPress={closeSheet}>
              <Text style={[styles.closeText, { color: theme.colors.textSecondary }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  orbWrapper: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 12 : 6,
    left: '50%',
    marginLeft: -36,
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 10,
  },
  radialGlowWrapper: {
    position: 'absolute',
    width: 112,
    height: 112,
    top: -20,
    left: -20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    opacity: 0.35,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 8,
  },
  ring: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    opacity: 0.7,
  },
  ring2: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 1,
    borderStyle: 'dotted',
    opacity: 0.35,
  },
  orb: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
    overflow: 'hidden',
  },
  micEmoji: { fontSize: 26, textAlign: 'center' },
  innerHighlight: {
    position: 'absolute',
    top: 6,
    left: 10,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  siriTouch: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  thickBaseLayer: {
    position: 'absolute',
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#000',
    zIndex: 0,
  },
  orbLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  siriOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  listeningBars: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  bar: { width: 3, borderRadius: 2, minHeight: 8 },
  labelWrap: {
    position: 'absolute',
    bottom: -18,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  label: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    opacity: 0,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '78%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 24,
  },
  sheetHeader: { alignItems: 'center', marginBottom: 16, gap: 6 },
  sheetGlow: { width: 40, height: 4, borderRadius: 2, opacity: 0.8 },
  sheetTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  sheetSub: { fontSize: 12, fontWeight: '500' },
  waveWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 40, marginVertical: 12 },
  waveBar: { width: 4, borderRadius: 2, minHeight: 6 },
  liveWrap: { alignItems: 'center', justifyContent: 'center', marginVertical: 8, gap: 8 },
  liveBadge: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  thinkingWrap: { alignItems: 'center', justifyContent: 'center', height: 48, marginVertical: 8 },
  thinkingRing: { position: 'absolute', width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderTopColor: 'transparent', opacity: 0.8 },
  bubble: { borderWidth: 1, borderRadius: 16, padding: 14, marginTop: 12 },
  bubbleLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  bubbleText: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  responseBubble: { borderWidth: 1 },
  chipsWrap: { marginTop: 16, gap: 10 },
  chipsTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: '600' },
  hint: { fontSize: 10, textAlign: 'center', marginTop: 4 },
  closeBtn: { marginTop: 16, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  closeText: { fontSize: 13, fontWeight: '700' },
  toggleModeBtn: {
    marginTop: 8,
    alignSelf: 'center',
    padding: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 16,
    width: '100%',
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  sendButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  sendButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default AiOrb;
