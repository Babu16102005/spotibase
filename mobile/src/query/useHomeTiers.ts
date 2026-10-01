/**
 * Staged home tiers: concurrent critical + secondary + heavy.
 *
 * Each tier carries its own AbortController, so a superseded tier never
 * resolves over a newer run (cancel-safe via a session generation + mounted
 * guard). Paint is stale-while-revalidate: MMKV tier buckets (plus the legacy
 * full feed as the critical seed) render synchronously, then stale tiers hit
 * the network concurrently via Promise.allSettled — each tier commits on
 * settle so progressive paint is preserved. A tier failure never overwrites
 * fresh data — the last good sections stay on screen with
 * `statusPerTier[tier] === 'error'`.
 *
 * Order is guaranteed by the merge: critical (recently-played → trending) →
 * secondary (browse/catalog, server order) → heavy (made-for-you, daily
 * mixes), regardless of completion order; HomeScreen additionally defers
 * mounting heavy rows until `InteractionManager.runAfterInteractions` fires.
 *
 * A tier that fails with empty sections retries once after ~500ms (same
 * session, still mounted; no retry on 401/403 or cancel).
 *
 * Expo SDK 57 / RN 0.86: AbortController is core RN — no version-specific
 * API is used.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { homeApi, type HomeTierParam } from '../api/client';
import {
  HOME_TIER_ORDER,
  getSectionTier,
  isHomeTierFresh,
  orderTierSections,
  readHomeFeed,
  readHomeTier,
  writeHomeTier,
} from '../cache/homeFeedCache';
import { useAuthStore } from '../store';
import { getGreeting } from '../utils';
import type { HomeSection } from '../types';

export type { HomeTierParam };
export { HOME_TIER_ORDER };
export type HomeTierStatus = 'idle' | 'pending' | 'success' | 'error';

type TierMap<T> = Record<HomeTierParam, T>;

const emptyTierMap = <T,>(make: () => T): TierMap<T> => ({
  critical: make(),
  secondary: make(),
  heavy: make(),
});

const sanitize = (sections: unknown): HomeSection[] =>
  Array.isArray(sections)
    ? (sections.filter(Boolean) as HomeSection[])
    : [];

const isCancelError = (err: any): boolean =>
  err?.code === 'ERR_CANCELED' ||
  err?.name === 'AbortError' ||
  err?.name === 'CanceledError';

/** Single automatic retry delay for an empty tier (~500ms). */
const TIER_RETRY_DELAY_MS = 500;

const delay = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

interface InitialSnapshot {
  sections: TierMap<HomeSection[]>;
  greeting: string;
}

/**
 * Synchronous SWR seed: tier buckets first, legacy full feed as the
 * critical seed (filtered to critical sections; the whole legacy feed only
 * when it classifies nothing critical and no other tier has data, so the
 * merge dedupe can never duplicate rows).
 */
const readInitialSnapshot = (): InitialSnapshot => {
  const sections = emptyTierMap<HomeSection[]>(() => []);
  let greeting: string | undefined;
  try {
    const c = readHomeTier('critical');
    const s = readHomeTier('secondary');
    const h = readHomeTier('heavy');
    sections.critical = sanitize(c?.sections);
    sections.secondary = sanitize(s?.sections);
    sections.heavy = sanitize(h?.sections);
    greeting = c?.greeting ?? s?.greeting ?? h?.greeting;
    if (sections.critical.length === 0) {
      const merged = readHomeFeed();
      const mergedSections = sanitize(merged?.sections);
      if (mergedSections.length > 0) {
        const seed = mergedSections.filter(
          (sec) => getSectionTier(sec) === 'critical'
        );
        const hasOtherTiers =
          sections.secondary.length > 0 || sections.heavy.length > 0;
        sections.critical =
          seed.length > 0 || hasOtherTiers ? seed : mergedSections;
        greeting = greeting ?? merged?.greeting;
      }
    }
  } catch {}
  return { sections, greeting: greeting ?? getGreeting() };
};

const initialStatusFor = (
  tier: HomeTierParam,
  sections: TierMap<HomeSection[]>
): HomeTierStatus => {
  try {
    return sections[tier].length > 0 && isHomeTierFresh(tier)
      ? 'success'
      : 'idle';
  } catch {
    return sections[tier].length > 0 ? 'success' : 'idle';
  }
};

interface UseHomeTiersOptions {
  /** Skip network fetches (e.g. while logged out). Defaults to true. */
  enabled?: boolean;
}

export const useHomeTiers = ({ enabled = true }: UseHomeTiersOptions = {}) => {
  const [snapshot] = useState<InitialSnapshot>(() => readInitialSnapshot());
  const [tierSections, setTierSections] =
    useState<TierMap<HomeSection[]>>(snapshot.sections);
  const [greeting, setGreeting] = useState<string>(snapshot.greeting);
  const [statusPerTier, setStatusPerTier] = useState<TierMap<HomeTierStatus>>(
    () => ({
      critical: initialStatusFor('critical', snapshot.sections),
      secondary: initialStatusFor('secondary', snapshot.sections),
      heavy: initialStatusFor('heavy', snapshot.sections),
    })
  );
  const [errorsPerTier, setErrorsPerTier] = useState<TierMap<unknown>>(() =>
    emptyTierMap<unknown>(() => null)
  );

  const sectionsRef = useRef<TierMap<HomeSection[]>>(snapshot.sections);
  const enabledRef = useRef(enabled);
  const sessionRef = useRef(0);
  const controllersRef = useRef<Partial<Record<HomeTierParam, AbortController>>>(
    {}
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      for (const c of Object.values(controllersRef.current)) {
        try {
          c?.abort();
        } catch {}
      }
      controllersRef.current = {};
    },
    []
  );

  const touchGreeting = useCallback(() => {
    setGreeting((prev) => {
      const fresh = getGreeting();
      return prev === fresh ? prev : fresh;
    });
  }, []);

  const applyTierSections = useCallback(
    (tier: HomeTierParam, sections: HomeSection[]) => {
      sectionsRef.current = { ...sectionsRef.current, [tier]: sections };
      setTierSections(sectionsRef.current);
    },
    []
  );

  const applyStatus = useCallback(
    (tier: HomeTierParam, status: HomeTierStatus) => {
      setStatusPerTier((prev) =>
        prev[tier] === status ? prev : { ...prev, [tier]: status }
      );
    },
    []
  );

  const revertPending = useCallback(
    (tier: HomeTierParam) => {
      applyStatus(
        tier,
        sectionsRef.current[tier].length > 0 ? 'success' : 'idle'
      );
    },
    [applyStatus]
  );

  const fetchTier = useCallback(
    async (
      tier: HomeTierParam,
      opts?: { force?: boolean; session?: number; retry?: boolean }
    ): Promise<void> => {
      const force = opts?.force ?? false;
      const session = opts?.session ?? sessionRef.current;
      const isRetry = opts?.retry ?? false;

      // Stale-tier-only gate: fresh buckets with data never refetch.
      if (
        !force &&
        sectionsRef.current[tier].length > 0 &&
        isHomeTierFresh(tier)
      ) {
        applyStatus(tier, 'success');
        return;
      }
      // Never hit a protected endpoint while logged out.
      if (!useAuthStore.getState().isAuthenticated) return;
      // Concurrent tiers all paint via the ordered merge (critical →
      // secondary → heavy); HomeScreen additionally defers mounting heavy
      // rows until interactions settle.
      if (session !== sessionRef.current || !mountedRef.current) {
        return;
      }

      try {
        controllersRef.current[tier]?.abort();
      } catch {}
      const controller = new AbortController();
      controllersRef.current[tier] = controller;
      applyStatus(tier, 'pending');
      setErrorsPerTier((prev) =>
        prev[tier] === null ? prev : { ...prev, [tier]: null }
      );

      try {
        const res = await homeApi.getHomeTier(tier, controller.signal);
        if (
          controller.signal.aborted ||
          session !== sessionRef.current ||
          !mountedRef.current
        ) {
          return;
        }
        const sections = sanitize(res.data?.sections);
        try {
          writeHomeTier(tier, {
            ...res.data,
            greeting: res.data?.greeting ?? getGreeting(),
          });
        } catch {}
        // Fresh write wins: only the current session commits.
        applyTierSections(tier, sections);
        applyStatus(tier, 'success');
        touchGreeting();
      } catch (err: any) {
        if (
          controller.signal.aborted ||
          session !== sessionRef.current ||
          !mountedRef.current ||
          isCancelError(err)
        ) {
          // Cancel-safe: drop back to a non-pending status, keep data.
          if (mountedRef.current && session === sessionRef.current) {
            revertPending(tier);
          }
          return;
        }
        const status = err?.response?.status;
        const isAuthError =
          (status === 401 || status === 403) && !err?._refreshNetworkError;
        if (
          isAuthError &&
          useAuthStore.getState().isAuthenticated
        ) {
          // Session expired/revoked: log out once (RootNavigator redirects
          // to Login). A refresh network failure keeps the cached feed.
          // Auth path never retries.
          try {
            useAuthStore.getState().logout();
          } catch {}
        } else if (!isAuthError && !isRetry && sectionsRef.current[tier].length === 0) {
          // Single automatic retry for a flaky first failure with nothing
          // on screen (e.g. timeout): wait ~500ms then retry once in the
          // same session if still current + mounted. The retry re-enters
          // fetchTier with retry=true so it can only fire once.
          try {
            await delay(TIER_RETRY_DELAY_MS);
          } catch {}
          if (
            mountedRef.current &&
            session === sessionRef.current &&
            !controller.signal.aborted &&
            useAuthStore.getState().isAuthenticated
          ) {
            // Fresh controller for the retry; the finally below cleans up
            // this attempt's controller before the retry creates its own.
            try {
              if (controllersRef.current[tier] === controller) {
                delete controllersRef.current[tier];
              }
            } catch {}
            await fetchTier(tier, { force, session, retry: true });
            return;
          }
          // Superseded while waiting: drop without overwriting newer state.
          if (mountedRef.current && session === sessionRef.current) {
            revertPending(tier);
          }
          return;
        } else if (!err?.response) {
          // Offline/transient: keep the cached feed silently.
        } else if (!isAuthError) {
          console.error(`Failed to fetch home tier ${tier}:`, err);
        }
        // Never overwrite fresh data with a failure — sections stay as-is.
        if (mountedRef.current && session === sessionRef.current) {
          setErrorsPerTier((prev) => ({ ...prev, [tier]: err }));
          applyStatus(tier, 'error');
        }
      } finally {
        if (controllersRef.current[tier] === controller) {
          delete controllersRef.current[tier];
        }
      }
    },
    [applyStatus, applyTierSections, revertPending, touchGreeting]
  );

  const runTiers = useCallback(
    async (opts?: {
      force?: boolean;
      tiers?: HomeTierParam[];
    }): Promise<void> => {
      const force = opts?.force ?? false;
      const tiers = opts?.tiers ?? [...HOME_TIER_ORDER];
      const session = ++sessionRef.current;
      if (force) {
        for (const c of Object.values(controllersRef.current)) {
          try {
            c?.abort();
          } catch {}
        }
        controllersRef.current = {};
      }
      touchGreeting();
      // Concurrent: all requested tiers start together via Promise.allSettled.
      // Each tier commits on settle (progressive paint preserved) and the
      // ordered merge guarantees critical → secondary → heavy paint order
      // regardless of completion order.
      if (!enabledRef.current && !force) return;
      if (session !== sessionRef.current || !mountedRef.current) return;
      await Promise.allSettled(
        tiers.map((tier) => fetchTier(tier, { force, session }))
      );
    },
    [fetchTier, touchGreeting]
  );

  /** Fetch only stale tiers (focus / mount path). */
  const refetchStale = useCallback(
    () => runTiers({ force: false }),
    [runTiers]
  );

  /** Force every tier (pull-to-refresh path; heavy is not deferred). */
  const refetchAll = useCallback(() => runTiers({ force: true }), [runTiers]);

  /** Force a single tier. */
  const refetchTier = useCallback(
    (tier: HomeTierParam, force = true) =>
      runTiers({ force, tiers: [tier] }),
    [runTiers]
  );

  /** Abort all in-flight tier requests (blur / unmount path). */
  const abortAll = useCallback(() => {
    sessionRef.current++;
    for (const c of Object.values(controllersRef.current)) {
      try {
        c?.abort();
      } catch {}
    }
    controllersRef.current = {};
    if (!mountedRef.current) return;
    setStatusPerTier((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const tier of HOME_TIER_ORDER) {
        if (next[tier] === 'pending') {
          next[tier] =
            sectionsRef.current[tier].length > 0 ? 'success' : 'idle';
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  /**
   * SWR merge, order guaranteed: critical (recently-played → trending) →
   * secondary → heavy, deduped by id, legacy continue-listening dropped,
   * empty sections skipped.
   */
  const sections = useMemo(() => {
    const seen = new Set<string>();
    const out: HomeSection[] = [];
    for (const tier of HOME_TIER_ORDER) {
      for (const s of orderTierSections(tier, tierSections[tier])) {
        const section = s as HomeSection;
        if (
          !section ||
          typeof section.id !== 'string' ||
          section.id === 'continue-listening'
        ) {
          continue;
        }
        if (seen.has(section.id)) continue;
        seen.add(section.id);
        if (!Array.isArray(section.items) || section.items.length === 0) {
          continue;
        }
        out.push(section);
      }
    }
    return out;
  }, [tierSections]);

  const data = useMemo(
    () => ({ greeting, sections }),
    [greeting, sections]
  );

  const pendingTiers = useMemo(
    () =>
      (HOME_TIER_ORDER as readonly HomeTierParam[]).filter(
        (t) => statusPerTier[t] === 'pending'
      ),
    [statusPerTier]
  );

  return {
    data,
    sections,
    greeting,
    tierSections,
    statusPerTier,
    errorsPerTier,
    pendingTiers,
    isPending: pendingTiers.length > 0,
    refetchTier,
    refetchStale,
    refetchAll,
    abortAll,
  };
};
