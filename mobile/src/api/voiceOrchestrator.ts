import { useCallback, useEffect, useRef, useState } from 'react';
import { aiApi, searchApi } from './client';
import type { SongResponse } from '../types';

/**
 * Realtime voice search orchestrator.
 *
 * Interim STT transcripts stream in via `pushInterim` (called from the
 * expo-speech-recognition `result` handler and the web SpeechRecognition
 * `onresult` handler). Each push is debounced (250ms), cancels the prior
 * in-flight request via AbortController, and only the latest `requestId`
 * may commit results — older (stale) responses are dropped.
 *
 * Live source order:
 *   1. POST /ai/voice-partial { text, context } when the backend supports
 *      it. A 404/405 (or a client without `aiApi.voicePartial`) marks the
 *      route unavailable for the session and falls through.
 *   2. Fallback: lightweight GET /search?types=song (top-5 songs).
 *      (/search/suggestions returns plain strings, so song chips come from
 *      /search. `aiApi.text` is deliberately NOT used here — a full text
 *      call would run executeAction/playback side effects per keystroke.)
 *
 * The full stop path is untouched: tap-to-stop / auto-stop still call
 * handleVoiceUri -> POST /ai/voice -> executeAction -> playMultiple
 * (backend QUEUE_SYNC). This orchestrator only drives the live chips.
 */

export const VOICE_PARTIAL_DEBOUNCE_MS = 250;
export const VOICE_PARTIAL_MIN_CHARS = 2;
export const VOICE_PARTIAL_MAX_SONGS = 5;

export type VoicePartialSource = 'voice-partial' | 'search-fallback';

export interface UseVoiceOrchestratorOptions {
  debounceMs?: number;
  minChars?: number;
  getContext?: () => unknown;
}

export interface VoiceOrchestrator {
  partialQuery: string;
  partialSongs: SongResponse[];
  partialLoading: boolean;
  partialError: string | null;
  /** Stream an interim transcript in (debounced fetch happens inside). */
  pushInterim: (transcript: string) => void;
  /** Re-run the last query immediately (error-row Retry button). */
  retry: () => void;
  /** Abort pending work and freeze (call on stop; keeps visible chips). */
  cancel: () => void;
  /** Abort and clear everything (call on listen start). */
  reset: () => void;
}

// Module-level probe cache: once /ai/voice-partial 404s/405s (or the client
// has no voicePartial), skip the probe and go straight to /search fallback.
let voicePartialAvailable: boolean | null = null;

/** Test-only reset for the /ai/voice-partial availability probe. */
export const __resetVoicePartialProbe = (): void => {
  voicePartialAvailable = null;
};

const isAbortError = (e: unknown): boolean => {
  const err = e as { code?: string; name?: string; message?: string };
  return (
    err?.code === 'ERR_CANCELED' ||
    err?.name === 'CanceledError' ||
    err?.name === 'AbortError' ||
    String(err?.message ?? '').toLowerCase() === 'canceled'
  );
};

const isPartialUnsupported = (e: unknown): boolean => {
  const status = (e as { response?: { status?: number } })?.response?.status;
  return status === 404 || status === 405;
};

const isSongLike = (v: unknown): v is SongResponse => {
  const s = v as SongResponse | undefined;
  return !!s && typeof s?.id === 'string' && typeof s?.title === 'string';
};

/** Normalize the shapes a future /ai/voice-partial may return into songs. */
export const extractPartialSongs = (data: unknown): SongResponse[] => {
  const d = data as {
    songs?: unknown;
    data?: { songs?: unknown };
    partialSongs?: unknown;
    results?: Array<{ songs?: unknown }>;
  } | null | undefined;
  if (!d || typeof d !== 'object') return [];
  const out: SongResponse[] = [];
  const push = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) {
        if (isSongLike(item)) out.push(item);
      }
    }
  };
  push(d.songs);
  push(d.data?.songs);
  push(d.partialSongs);
  if (Array.isArray(d.results)) {
    for (const r of d.results) push(r?.songs);
  }
  const seen = new Set<string>();
  const unique: SongResponse[] = [];
  for (const s of out) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      unique.push(s);
    }
  }
  return unique.slice(0, VOICE_PARTIAL_MAX_SONGS);
};

const callVoicePartial = (
  query: string,
  context: unknown,
  signal: AbortSignal,
): Promise<unknown> => {
  const fn = (
    aiApi as {
      voicePartial?: (text: string, ctx?: unknown, s?: AbortSignal) => Promise<unknown>;
    }
  ).voicePartial;
  if (typeof fn !== 'function') {
    const err = new Error(
      'POST /ai/voice-partial unsupported — using search fallback',
    ) as Error & { response: { status: number } };
    err.response = { status: 404 };
    return Promise.reject(err);
  }
  return fn(query, context, signal);
};

export function useVoiceOrchestrator(options?: UseVoiceOrchestratorOptions): VoiceOrchestrator {
  const debounceMs = options?.debounceMs ?? VOICE_PARTIAL_DEBOUNCE_MS;
  const minChars = options?.minChars ?? VOICE_PARTIAL_MIN_CHARS;
  const contextRef = useRef<UseVoiceOrchestratorOptions['getContext']>(undefined);
  contextRef.current = options?.getContext;

  const [partialQuery, setPartialQuery] = useState<string>('');
  const [partialSongs, setPartialSongs] = useState<SongResponse[]>([]);
  const [partialLoading, setPartialLoading] = useState<boolean>(false);
  const [partialError, setPartialError] = useState<string | null>(null);

  const requestIdRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>('');

  const runPartial = useCallback(
    async (query: string, requestId: number, signal: AbortSignal): Promise<void> => {
      const isCurrent = (): boolean =>
        requestIdRef.current === requestId && !signal.aborted;
      const context = contextRef.current?.();

      // 1) Prefer POST /ai/voice-partial while the backend supports it.
      if (voicePartialAvailable !== false) {
        try {
          const res = await callVoicePartial(query, context, signal);
          if (!isCurrent()) return; // superseded — drop stale results
          voicePartialAvailable = true;
          setPartialSongs(
            extractPartialSongs((res as { data?: unknown })?.data),
          );
          setPartialError(null);
          setPartialLoading(false);
          return;
        } catch (e) {
          if (!isCurrent() || isAbortError(e)) return; // cancelled — silent
          if (isPartialUnsupported(e)) {
            voicePartialAvailable = false; // remember: skip the probe next time
          }
          // Fall through to the /search fallback so live chips still appear.
        }
      }

      // 2) Fallback: lightweight GET /search (songs only, top-5).
      try {
        const res = await searchApi.search(query, 'song', 0, signal);
        if (!isCurrent()) return; // superseded — drop stale results
        const songs = (
          (res as { data?: { songs?: SongResponse[] } } | undefined)?.data
            ?.songs ?? []
        ).slice(0, VOICE_PARTIAL_MAX_SONGS);
        setPartialSongs(songs);
        setPartialError(null);
        setPartialLoading(false);
      } catch (e) {
        if (!isCurrent() || isAbortError(e)) return;
        const detail =
          (e as { response?: { data?: { message?: string } } })?.response?.data
            ?.message ??
          (e as { message?: string })?.message ??
          'request failed';
        // Keep previously shown chips; surface a specific retry affordance.
        setPartialError(`Live search failed: ${detail}. Tap Retry or type instead.`);
        setPartialLoading(false);
      }
    },
    [],
  );

  const pushInterim = useCallback(
    (transcript: string): void => {
      const q = (transcript || '').trim();
      lastQueryRef.current = q;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (q.length < minChars) {
        // Too short to search: invalidate flights, clear live UI.
        abortRef.current?.abort();
        abortRef.current = null;
        requestIdRef.current += 1;
        setPartialQuery(q);
        setPartialSongs([]);
        setPartialError(null);
        setPartialLoading(false);
        return;
      }
      setPartialQuery(q);
      setPartialLoading(true);
      setPartialError(null);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const id = requestIdRef.current + 1;
        requestIdRef.current = id;
        void runPartial(q, id, controller.signal);
      }, debounceMs);
    },
    [debounceMs, minChars, runPartial],
  );

  const retry = useCallback((): void => {
    const q = lastQueryRef.current.trim();
    if (q.length < minChars) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = requestIdRef.current + 1;
    requestIdRef.current = id;
    setPartialQuery(q);
    setPartialLoading(true);
    setPartialError(null);
    void runPartial(q, id, controller.signal);
  }, [minChars, runPartial]);

  const cancel = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    // Invalidate flights so late responses are dropped as stale.
    requestIdRef.current += 1;
    setPartialLoading(false);
  }, []);

  const reset = useCallback((): void => {
    cancel();
    lastQueryRef.current = '';
    setPartialQuery('');
    setPartialSongs([]);
    setPartialError(null);
  }, [cancel]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  return {
    partialQuery,
    partialSongs,
    partialLoading,
    partialError,
    pushInterim,
    retry,
    cancel,
    reset,
  };
}
