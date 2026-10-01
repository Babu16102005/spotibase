import { homeApi, type HomeTierParam } from '../api/client';
import { getGreeting, getStorage } from '../utils';
import { TTL_MS, isBucketFresh, isFresh } from './ttl';

/** Home feed freshness window — single source of truth lives in cache/ttl. */
export const HOME_FRESH_MS = TTL_MS.HOME;
const storage = getStorage('spotibase-cache');

export type { HomeTierParam };

/** Canonical tier order: critical paints first, heavy last. */
export const HOME_TIER_ORDER: readonly HomeTierParam[] = [
  'critical',
  'secondary',
  'heavy',
] as const;

const tierDataKey = (tier: HomeTierParam): string => `homeData:${tier}`;
const tierAtKey = (tier: HomeTierParam): string => `homeData:${tier}At`;

const tierTtlBucket = (
  tier: HomeTierParam
): 'HOME_CRITICAL' | 'HOME_SECONDARY' | 'HOME_HEAVY' =>
  tier === 'critical'
    ? 'HOME_CRITICAL'
    : tier === 'secondary'
      ? 'HOME_SECONDARY'
      : 'HOME_HEAVY';

/** Raw tier payload (`{ greeting, sections }`) or null when absent/corrupt. */
export const readHomeTier = (tier: HomeTierParam): any | null => {
  try {
    const cached = storage.getString(tierDataKey(tier));
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

export const readHomeTierAt = (tier: HomeTierParam): number => {
  try {
    return storage.getNumber(tierAtKey(tier)) ?? 0;
  } catch {
    return 0;
  }
};

export const isHomeTierFresh = (
  tier: HomeTierParam,
  now: number = Date.now()
): boolean => {
  try {
    return isBucketFresh(readHomeTierAt(tier), tierTtlBucket(tier), now);
  } catch {
    return false;
  }
};

export const writeHomeTier = (tier: HomeTierParam, data: any) => {
  try {
    storage.set(tierDataKey(tier), JSON.stringify(data));
    storage.set(tierAtKey(tier), Date.now());
  } catch {}
};

/**
 * Which tier owns a section. Mirrors the backend split:
 * critical = recently-played + trending, heavy = made-for-you + daily mixes,
 * everything else is secondary (browse/catalog).
 */
export const getSectionTier = (section: {
  id?: string;
  title?: string;
}): HomeTierParam => {
  const hay = `${section?.id ?? ''} ${section?.title ?? ''}`.toLowerCase();
  if (
    hay.includes('recently-played') ||
    hay.includes('recently_played') ||
    hay.includes('recently played') ||
    hay.includes('trending')
  ) {
    return 'critical';
  }
  if (
    hay.includes('made-for-you') ||
    hay.includes('made_for_you') ||
    hay.includes('made for you') ||
    hay.includes('daily-mix') ||
    hay.includes('daily_mix') ||
    hay.includes('daily mix')
  ) {
    return 'heavy';
  }
  return 'secondary';
};

/**
 * Display order inside a tier. Critical is pinned to
 * recently-played → trending → rest; other tiers keep server order.
 * Never mutates the input.
 */
export const orderTierSections = (
  tier: HomeTierParam,
  sections: any
): any[] => {
  const list = Array.isArray(sections) ? sections.filter(Boolean) : [];
  if (tier !== 'critical') return list;
  const score = (s: any): number => {
    const hay = `${s?.id ?? ''} ${s?.title ?? ''}`.toLowerCase();
    if (
      hay.includes('recently-played') ||
      hay.includes('recently_played') ||
      hay.includes('recently played')
    ) {
      return 0;
    }
    if (hay.includes('trending')) return 1;
    return 2;
  };
  return [...list].sort((a, b) => score(a) - score(b));
};

const sanitizeSections = (sections: any): any[] =>
  Array.isArray(sections) ? sections.filter(Boolean) : [];

/**
 * Ordered merge: critical → secondary → heavy, deduped by section id.
 * The legacy client-side `continue-listening` section is dropped (the
 * backend is the source of truth) and empty sections are skipped.
 */
export const mergeHomeTiers = (
  critical: any,
  secondary: any,
  heavy: any
): { greeting: string; sections: any[] } => {
  const seen = new Set<string>();
  const sections: any[] = [];
  const payloads: Array<{ tier: HomeTierParam; payload: any }> = [
    { tier: 'critical', payload: critical },
    { tier: 'secondary', payload: secondary },
    { tier: 'heavy', payload: heavy },
  ];
  for (const { tier, payload } of payloads) {
    for (const s of orderTierSections(tier, payload?.sections)) {
      if (!s || typeof s.id !== 'string' || s.id === 'continue-listening') {
        continue;
      }
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      if (!Array.isArray(s.items) || s.items.length === 0) continue;
      sections.push(s);
    }
  }
  return {
    greeting:
      critical?.greeting ??
      secondary?.greeting ??
      heavy?.greeting ??
      getGreeting(),
    sections,
  };
};

/** Raw legacy full-feed payload (`homeData`), kept as the critical seed. */
export const readLegacyHomeFeed = (): any | null => {
  try {
    const cached = storage.getString('homeData');
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

/**
 * Merged ordered view over the tier buckets. When the critical bucket is
 * empty but a legacy full feed exists, the legacy critical sections seed
 * the paint (legacy full feed as critical seed, deduped against real tier
 * data). Returns null when nothing is cached anywhere.
 */
export const readHomeFeed = (): any | null => {
  try {
    const critical = readHomeTier('critical');
    const secondary = readHomeTier('secondary');
    const heavy = readHomeTier('heavy');
    const legacy = readLegacyHomeFeed();

    let criticalPayload = critical;
    if (!Array.isArray(critical?.sections) || critical.sections.length === 0) {
      const legacySections = sanitizeSections(legacy?.sections);
      if (legacySections.length > 0) {
        const seed = legacySections.filter(
          (s) => getSectionTier(s) === 'critical'
        );
        criticalPayload = {
          ...(legacy ?? {}),
          sections: seed.length > 0 ? seed : legacySections,
        };
      }
    }

    const hasAnything =
      sanitizeSections(criticalPayload?.sections).length > 0 ||
      sanitizeSections(secondary?.sections).length > 0 ||
      sanitizeSections(heavy?.sections).length > 0;
    if (!hasAnything) return null;

    const merged = mergeHomeTiers(criticalPayload, secondary, heavy);
    // Preserve a legacy greeting when no tier payload carries one.
    if (!critical?.greeting && !secondary?.greeting && !heavy?.greeting) {
      merged.greeting = legacy?.greeting ?? merged.greeting;
    }
    return merged;
  } catch {
    return null;
  }
};

/**
 * Fresh when the legacy feed OR the critical tier is fresh, so existing
 * callers keep working during the tiered migration.
 */
export const isHomeFeedFresh = (): boolean => {
  try {
    const cachedAt = storage.getNumber('homeDataAt') ?? 0;
    if (isFresh(cachedAt, HOME_FRESH_MS)) return true;
  } catch {}
  try {
    return isHomeTierFresh('critical');
  } catch {
    return false;
  }
};

export const writeHomeFeed = (data: any) => {
  try {
    storage.set('homeData', JSON.stringify(data));
    storage.set('homeDataAt', Date.now());
  } catch {}
};

export const prefetchHomeFeed = async () => {
  try {
    if (isHomeFeedFresh()) return;
    const res = await homeApi.getHome();
    writeHomeFeed({ ...res.data, greeting: getGreeting() });
  } catch {
    // Warmup is best-effort; HomeScreen still fetches on focus.
  }
};
