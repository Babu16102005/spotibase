import { homeApi } from '../api/client';
import { getGreeting, getStorage } from '../utils';

export const HOME_FRESH_MS = 30_000;
const storage = getStorage('spotibase-cache');

export const readHomeFeed = (): any | null => {
  try {
    const cached = storage.getString('homeData');
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

export const isHomeFeedFresh = (): boolean => {
  try {
    const cachedAt = storage.getNumber('homeDataAt') ?? 0;
    return cachedAt > 0 && Date.now() - cachedAt < HOME_FRESH_MS;
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
