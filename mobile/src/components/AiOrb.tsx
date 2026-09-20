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
} from 'react-native-reanimated';
import { usePlayerStore, useThemeStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { useAiOrbStore, AI_ORB_VARIANTS, AI_ORB_GLOW_COLORS } from '../store/aiOrbStore';
import apiClient, { aiApi } from '../api/client';
import { SiriOrb } from './SiriOrb';
import { StarOrb } from './StarOrb';
import Icon from './Icon';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';

// Platform-specific audio
let AudioModule: any = null;
try {
  // expo-audio for SDK 57
  AudioModule = require('expo-audio');
} catch (e) {
  AudioModule = null;
}

type AiState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'done' | 'error';

const { width: SCREEN_W } = Dimensions.get('window');

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
    }))
  );

  const [state, setState] = useState<AiState>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [response, setResponse] = useState<string>('');
  const [showSheet, setShowSheet] = useState(false);
  const [recording, setRecording] = useState<any>(null);
  const [inputText, setInputText] = useState<string>('');
  const [isKeyboardMode, setIsKeyboardMode] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<any>(null);

  const audioChunksRef = useRef<Blob[]>([]);

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

  // Web Speech Recognition fallback
  const startWebSpeech = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        reject(new Error('Speech recognition not supported'));
        return;
      }
      const rec = new SpeechRecognition();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.continuous = false;
      let finalTranscript = '';
      rec.onresult = (event: any) => {
        finalTranscript = event.results[0][0].transcript;
      };
      rec.onend = () => {
        recognitionRef.current = null;
        if (finalTranscript) resolve(finalTranscript);
        else reject(new Error('No speech detected'));
      };
      rec.onerror = (e: any) => {
        recognitionRef.current = null;
        reject(new Error(e.error || 'Speech error'));
      };
      recognitionRef.current = rec;
      rec.start();
    });
  };

  const executeAction = async (data: any) => {
    const actions: any[] = data.actions || [];
    const results: any[] = data.results || [];
    for (let i = 0; i < actions.length; i++) {
      const act = actions[i];
      const action = act.action as string;
      const params = act.parameters || {};
      const result = results[i] || {};
      try {
        switch (action) {
          case 'NEXT':
            await playerState.next();
            break;
          case 'PREVIOUS':
            await playerState.previous();
            break;
          case 'PAUSE':
            await playerState.pause();
            break;
          case 'RESUME':
          case 'PLAY':
            await playerState.resume();
            break;
          case 'SHUFFLE_ON':
            playerState.setShuffle(true);
            break;
          case 'SHUFFLE_OFF':
            playerState.setShuffle(false);
            break;
          case 'LIKE_CURRENT': {
            // call like API if current track exists
            try {
              const { songApi } = require('../api/client');
              const curId = playerState.currentTrack?.id;
              if (curId) await songApi.like(curId);
            } catch {}
            break;
          }
          case 'SEARCH_ARTIST':
          case 'SEARCH_SONG':
          case 'SEARCH_ALBUM': {
            const artist = params.artist || params.query || params.song || '';
            if (artist) {
              try {
                const { searchApi } = require('../api/client');
                const res = await searchApi.search(artist, 'song,artist', 0);
                const songs = res.data?.songs || res.data?.content || [];
                // Pick first artist's songs: search returns songs + artists, try songs first
                let toPlay: any[] = songs;
                if ((!toPlay || toPlay.length === 0) && res.data?.artists?.length) {
                  // Fetch artist songs via artistApi
                  const { artistApi } = require('../api/client');
                  const aRes = await artistApi.getById(res.data.artists[0].id).catch(() => null);
                  if (aRes) {
                    // fallback: search again with song type
                    const s2 = await searchApi.search(artist, 'song', 0);
                    toPlay = s2.data?.songs || [];
                  }
                }
                if (toPlay && toPlay.length > 0) {
                  await playerState.playMultiple(toPlay, 0);
                  setResponse(`Playing ${artist} - ${toPlay[0].title}`);
                } else {
                  // Try direct song search
                  const { searchApi: sApi } = require('../api/client');
                  const r2 = await sApi.search(artist, 'song', 0);
                  const s2 = r2.data?.songs || [];
                  if (s2.length > 0) await playerState.playMultiple(s2, 0);
                }
              } catch (e) { console.warn('SEARCH failed', e); }
            }
            break;
          }
          case 'PLAY_BY_MOOD':
          case 'PLAY_BY_GENRE':
          case 'PLAY_BY_LANGUAGE': {
            // Backend already queued via ActionDispatcher, but also play client-side for instant feedback
            const songIds: string[] = result.songs || [];
            if (songIds.length > 0) {
              try {
                const { songApi } = require('../api/client');
                // Fetch song details for ids
                const songs: any[] = [];
                for (const sid of songIds.slice(0, 5)) {
                  try {
                    const r = await songApi.getById(sid);
                    if (r.data) songs.push(r.data);
                  } catch {}
                }
                if (songs.length > 0) {
                  await playerState.playMultiple(songs, 0);
                } else {
                  // Fallback: fetch recommendations
                  const { searchApi } = require('../api/client');
                  const mood = params.mood || 'CALM';
                  const r = await searchApi.search(mood, 'song', 0);
                  const s = r.data?.songs || [];
                  if (s.length > 0) await playerState.playMultiple(s, 0);
                }
              } catch (e) { console.warn('PLAY_BY_MOOD client play failed', e); }
            } else {
              // No songs in result, try search by mood
              try {
                const { searchApi } = require('../api/client');
                const mood = params.mood || params.genre || params.language || 'chill';
                const r = await searchApi.search(mood, 'song', 0);
                const s = r.data?.songs || [];
                if (s.length > 0) await playerState.playMultiple(s, 0);
              } catch {}
            }
            break;
          }
          case 'PLAY_SIMILAR': {
            const curId = playerState.currentTrack?.id || params.source;
            if (curId) {
              try {
                const { songApi } = require('../api/client');
                // Try similar via recommendations
                const s = await searchApiSearch('similar');
              } catch {}
            }
            break;
          }
          case 'ADD_TO_QUEUE': {
            const cur = playerState.currentTrack;
            if (cur) await playerState.play(cur); // placeholder: add to queue is similar to play
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
  };
  const searchApiSearch = async (q: string) => {
    try {
      const { searchApi } = require('../api/client');
      const r = await searchApi.search(q, 'song', 0);
      const s = r.data?.songs || [];
      if (s.length > 0) await playerState.playMultiple(s, 0);
    } catch {}
  };

  const handleText = async (text: string) => {
    if (!text.trim()) return;
    setTranscript(text);
    setState('thinking');
    setShowSheet(true);
    try {
      const ctx = {
        currentSongId: playerState.currentTrack?.id,
        currentArtist: playerState.currentTrack?.artistName,
        playing: true,
      };
      const res = await aiApi.text(text, ctx);
      const data: any = res.data;
      if (data.clarificationNeeded) {
        setResponse(data.clarificationQuestion || 'Could you rephrase?');
        setState('error');
      } else {
        setResponse(data.response || `Done: ${data.actions?.map((a: any) => a.action).join(', ')}`);
        setState('done');
        await executeAction(data);
      }
      setTimeout(() => {
        setState('idle');
        // keep sheet open for 2s to show response
        setTimeout(() => setShowSheet(false), 1200);
      }, 900);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'AI unavailable';
      setResponse(msg);
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  };

  const handleVoiceUri = async (uri: string, transcriptFallback?: string) => {
    const isPlaceholder = (t?: string) => !t || t === 'Listening...' || t === 'Listening... speak now' || t.trim() === '';
    const cleanFallback = isPlaceholder(transcriptFallback) ? undefined : transcriptFallback;
    if (!uri && !cleanFallback) return;
    setTranscript(cleanFallback || 'Listening...');
    setState('thinking');
    setShowSheet(true);
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
        // Direct post to Spring Boot /ai/voice (which forwards to FastAPI)
        res = await apiClient.post('/ai/voice', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 30000,
        });
        // Revoke blob URI after use
        try { URL.revokeObjectURL(uri); } catch {}
      } else {
        // Native file:// or http : use existing helper
        res = await aiApi.voice(uri, cleanFallback, ctx, uri && uri.endsWith('.webm') ? 'audio.webm' : 'audio.m4a');
      }
      const data: any = res.data;
      // backend may echo transcript in data.transcript
      if (data.transcript) setTranscript(data.transcript);
      if (data.clarificationNeeded) {
        setResponse(data.clarificationQuestion || 'Could you rephrase?');
        setState('error');
      } else {
        setResponse(data.response || `Done: ${data.actions?.map((a: any) => a.action).join(', ')}`);
        setState('done');
        await executeAction(data);
      }
      setTimeout(() => {
        setState('idle');
        setTimeout(() => setShowSheet(false), 1200);
      }, 900);
    } catch (e: any) {
      // If backend complained about missing audio part, try fallback to text if we have transcript
      const isMissingAudio = e?.response?.data?.message?.includes('Required part') || e?.response?.status === 400;
      if (cleanFallback) {
        console.log('Voice failed, fallback to text', cleanFallback, e?.message);
        return handleText(cleanFallback);
      }
      const msg = isMissingAudio ? 'Voice upload failed - try tapping chip or checking mic permission' : (e?.response?.data?.message || e?.message || 'Voice failed');
      setResponse(msg);
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  };

  const startListeningWebMedia = async (): Promise<string> => {
    // Web: try SpeechRecognition first (faster, gives transcript)
    // Also record raw audio via MediaRecorder for backend STT fallback
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    let transcriptFromSpeech: string | undefined;

    // Start MediaRecorder
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    audioChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    mediaRecorderRef.current = recorder;
    recorder.start();

    // Start speech recognition in parallel
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = (event: any) => {
        transcriptFromSpeech = event.results[0][0].transcript;
        setTranscript(transcriptFromSpeech!);
      };
      rec.onerror = () => {};
      try { rec.start(); recognitionRef.current = rec; } catch {}
    }

    // Auto stop after 6 seconds or on manual stop
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        stopWebMedia().then(({ uri }) => resolve(transcriptFromSpeech || uri));
      }, 6000);
      // store timeout to allow manual stop to clear
      (recorder as any)._aiTimeout = timeout;
      // Resolve will be handled by manual stop as well - we store resolver
      (recorder as any)._aiResolve = (val: string) => {
        clearTimeout(timeout);
        resolve(val);
      };
    }) as any;
  };

  const stopWebMedia = async (): Promise<{ uri: string; transcript?: string }> => {
    const recorder: MediaRecorder | null = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      const transcriptAtStop = transcript;
      // Stop speech rec
      try { recognitionRef.current?.stop(); } catch {}
      return new Promise((resolve) => {
        recorder.onstop = async () => {
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          // Create object URL for upload
          const uri = URL.createObjectURL(blob);
          // Cleanup stream
          try { (recorder.stream as any)?.getTracks()?.forEach((t: any) => t.stop()); } catch {}
          mediaRecorderRef.current = null;
          audioChunksRef.current = [];
          resolve({ uri, transcript: transcriptAtStop });
        };
        recorder.stop();
        // clear timeout if exists
        const t = (recorder as any)._aiTimeout;
        if (t) clearTimeout(t);
      });
    }
    return { uri: '', transcript: transcript };
  };

  const startNativeRecording = async () => {
    if (!AudioModule) throw new Error('expo-audio not installed');
    let recording: any = null;
    try {
      // Correct import: require('expo-audio') returns { AudioModule, Recording, ... }
      const pkg: any = AudioModule;
      const AM = pkg.AudioModule || pkg;
      const RecClass = pkg.Recording || AM?.Recording;
      const reqPerm = AM?.requestRecordingPermissionsAsync || pkg?.requestRecordingPermissionsAsync;
      if (reqPerm) {
        const perm = await reqPerm();
        console.log('[Mic] perm status', perm?.status);
        if (perm && perm.status !== 'granted') throw new Error('Mic permission denied: ' + perm.status);
      }
      if (!RecClass) throw new Error('Recording class not found in expo-audio');
      recording = new RecClass();
      await recording.prepareToRecordAsync({
        android: { extension: '.m4a', outputFormat: 2, audioEncoder: 3, sampleRate: 44100, numberOfChannels: 2, bitRate: 128000 },
        ios: { extension: '.m4a', outputFormat: 'mpeg4AAC', audioQuality: 'high', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
        web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
      });
      await recording.startAsync();
      setRecording(recording);
      return recording;
    } catch (e: any) {
      console.log('[Mic] startNativeRecording error', e?.message);
      throw e;
    }
  };

  const stopNativeRecording = async (): Promise<string> => {
    if (!recording) return '';
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      return uri || '';
    } catch (e) {
      setRecording(null);
      return '';
    }
  };

  const onOrbPress = async () => {
    // Haptic
    try { const Haptics = require('expo-haptics'); await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}

    if (state === 'listening') {
      // Stop listening - user taps again to stop
      setState('thinking');
      if (Platform.OS === 'web') {
        try {
          const rec: any = mediaRecorderRef.current;
          if (rec) {
            // Resolve the pending promise
            const { uri, transcript: t } = await stopWebMedia();
            // If we have transcript from SpeechRecognition, use it as fallback
            const fallback = t && t.length > 2 ? t : transcript;
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
          setResponse(e.message);
          setState('error');
          setTimeout(() => setState('idle'), 1500);
        }
      } else {
        // Native
        try {
          const uri = await stopNativeRecording();
          if (uri) {
            // For native, we don't have transcript yet, so let backend mock use fallback if provided via STT mock
            // We'll try to send with no fallback and let backend return clarification if needed, then fallback to a prompt?
            // For demo, we will assume mock will need fallback, so we show a quick prompt for fallback
            // Instead, send uri with no fallback; speech.py will try STT (mock = empty) -> returns clarification, we handle via fallback text
            await handleVoiceUri(uri, undefined);
          } else {
            setResponse('No audio');
            setState('error');
            setTimeout(() => setState('idle'), 1500);
          }
        } catch (e: any) {
          setResponse(e.message);
          setState('error');
          setTimeout(() => setState('idle'), 1500);
        }
      }
      return;
    }

    if (state === 'thinking' || state === 'speaking') return;

    // Start listening
    setTranscript('');
    setResponse('');
    setState('listening');
    setShowSheet(true);

    if (Platform.OS === 'web') {
      try {
        // Check permission first
        await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
        // Start combined media + speech
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        audioChunksRef.current = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
        mediaRecorderRef.current = recorder;
        recorder.start();
        setTranscript('Listening... speak now');
        // Start speech recognition parallel
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
          const rec = new SpeechRecognition();
          rec.lang = 'en-US';
          rec.interimResults = true;
          rec.maxAlternatives = 1;
          rec.onresult = (event: any) => {
            const t = event.results[0][0].transcript;
            setTranscript(t);
          };
          rec.onend = () => { recognitionRef.current = null; };
          rec.onerror = () => { recognitionRef.current = null; };
          recognitionRef.current = rec;
          try { rec.start(); } catch {}
        }
        // Auto stop after 7s if user doesn't tap
        setTimeout(async () => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            // Auto stop and process
            const wasListening = true;
            // Need to check current state value via closure - use ref instead, so just check via variable
            // We will trigger orb press logic programmatically
            // Simulate tap to stop
            // Instead directly call handling
            try {
              const { uri } = await stopWebMedia();
              const fallback = transcript;
              if (uri) await handleVoiceUri(uri, fallback && fallback !== 'Listening... speak now' ? fallback : undefined);
              else if (fallback && fallback !== 'Listening... speak now') await handleText(fallback);
              else { setResponse('No speech'); setState('error'); setTimeout(()=>setState('idle'),1500); }
            } catch {}
          }
        }, 7000);
      } catch (e: any) {
        const msg = e?.message || '';
        const isSecureError = msg.includes('secure') || msg.includes('NotAllowedError');
        const display = isSecureError
          ? 'Microphone blocked: Open via http://localhost:8081 (not 10.247...) and Allow. Tap to retry or type.'
          : 'Microphone access is unavailable. Please type your command.';
        setResponse(display);
        setState('idle');
        setIsKeyboardMode(true);
        // Offer to open settings on native if permanently denied
        if (Platform.OS !== 'web' && (msg.includes('denied') || e?.status === 'denied')) {
          Alert.alert(
            'Microphone Permission',
            'SpotiBase needs microphone for AI voice. Please Allow in Settings.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings?.() || Linking.openURL('app-settings:') },
              { text: 'Type Instead', onPress: () => setIsKeyboardMode(true) },
            ]
          );
        } else if (Platform.OS === 'web' && isSecureError) {
          Alert.alert('Use localhost:8081 for mic', 'Chrome blocks mic on http://10.247... Use http://localhost:8081 and Allow when prompted.');
        }
      }
    } else {
      // Native
      try {
        await startNativeRecording();
        setTranscript('Listening... speak now');
        // Auto stop after 7s
        setTimeout(async () => {
          if (recording) {
            const uri = await stopNativeRecording();
            if (uri) await handleVoiceUri(uri, undefined);
          }
        }, 7000);
      } catch (e: any) {
        const msg = e?.message || String(e);
        console.log('[Mic] native error', msg);
        setResponse(`Microphone error: ${msg}. Please type your command or check Settings -> Apps -> SpotiBase -> Microphone -> Allow.`);
        setState('idle');
        setIsKeyboardMode(true);
        Alert.alert(
          'Microphone Permission',
          'Allow microphone for AI voice? This lets you say "Play calm songs" etc.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings?.() || Linking.openURL('app-settings:') },
            { text: 'Type Instead', onPress: () => setIsKeyboardMode(true) },
          ]
        );
      }
    }
  };

  const onLongPress = () => {
    setIsKeyboardMode(true);
    setShowSheet(true);
    setState('idle');
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
            onPress={onOrbPress}
            onLongPress={onLongPress}
            activeOpacity={1}
            style={styles.siriTouch}
          >
            {/* Thick 100% opaque base shield */}
            <View style={styles.thickBaseLayer} pointerEvents="none" />

            {variant === 'midnight' ? (
              <StarOrb size="58px" />
            ) : (
              <SiriOrb
                size="58px"
                colors={orbColors}
                animationDuration={state === 'listening' ? 6 : state === 'thinking' ? 4 : 20}
              />
            )}
            {/* Mic / state overlay on top of Siri orb */}
            <View style={styles.siriOverlay} pointerEvents="none">
              {state === 'thinking' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : state === 'listening' ? (
                <View style={styles.listeningBars}>
                  <View style={[styles.bar, { height: 10, backgroundColor: '#fff', opacity: 0.9 }]} />
                  <View style={[styles.bar, { height: 16, backgroundColor: '#fff' }]} />
                  <View style={[styles.bar, { height: 12, backgroundColor: '#fff', opacity: 0.9 }]} />
                </View>
              ) : state === 'done' ? (
                <Text style={{ fontSize: 16 }}>✨</Text>
              ) : state === 'error' ? (
                <Text style={{ fontSize: 14 }}>⚠️</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Label below orb */}
        <View style={styles.labelWrap}>
          <Text style={[styles.label, { color: state === 'listening' ? '#FF3B30' : state === 'thinking' ? '#A78BFA' : theme.colors.textSecondary }]}>
            {state === 'idle' ? 'AI' : state === 'listening' ? 'Listening...' : state === 'thinking' ? 'Thinking...' : state === 'done' ? 'Done' : 'Try again'}
          </Text>
        </View>
      </View>

      {/* Full-screen sheet when active */}
      <Modal visible={showSheet} transparent animationType="fade" onRequestClose={() => setShowSheet(false)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => state === 'idle' && setShowSheet(false)} />
          <View style={[styles.sheet, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            {/* Header illusion */}
            <View style={styles.sheetHeader}>
              <View style={[styles.sheetGlow, { backgroundColor: theme.colors.primary }]} />
              <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>SpotiBase AI</Text>
              <Text style={[styles.sheetSub, { color: theme.colors.textSecondary }]}>
                {isKeyboardMode ? 'Type your command below' : state === 'listening' ? 'Speak now - tap orb to stop' : state === 'thinking' ? 'Understanding...' : 'Tap orb and speak'}
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

            {/* Waveform illusion when listening */}
            {!isKeyboardMode && state === 'listening' && (
              <View style={styles.waveWrap}>
                {[...Array(12)].map((_, i) => (
                  <Animated.View
                    key={i}
                    style={[
                      styles.waveBar,
                      { backgroundColor: theme.colors.primary, height: 8 + Math.random() * 28 },
                      pulseStyle,
                    ]}
                  />
                ))}
              </View>
            )}

            {state === 'thinking' && (
              <View style={styles.thinkingWrap}>
                <Animated.View style={[styles.thinkingRing, rotationStyle, { borderColor: theme.colors.primary }]} />
                <ActivityIndicator color={theme.colors.primary} style={{ position: 'absolute' }} />
              </View>
            )}

            {!!transcript && (
              <View style={[styles.bubble, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
                <Text style={[styles.bubbleLabel, { color: theme.colors.textSecondary }]}>You said</Text>
                <Text style={[styles.bubbleText, { color: theme.colors.text }]}>"{transcript}"</Text>
              </View>
            )}

            {!!response && (
              <View style={[styles.bubble, styles.responseBubble, { backgroundColor: theme.dark ? '#1DB95415' : '#F0FDF4', borderColor: theme.colors.primary + '30' }]}>
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
                  <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>Long press orb for text input • Tap orb to speak</Text>
                )}
              </View>
            )}

            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: theme.colors.background }]} onPress={() => setShowSheet(false)}>
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
    zIndex: 99,
    elevation: 12,
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
