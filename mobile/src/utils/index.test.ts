import {
  formatDuration,
  formatCount,
  formatDate,
  getGreeting,
  getRelativeTime,
  getImageUrl,
  getStorage,
} from './index';

describe('utils: formatDuration', () => {
  it('formats zero milliseconds', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('pads seconds with a leading zero', () => {
    expect(formatDuration(61_000)).toBe('1:01');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(214_000)).toBe('3:34');
  });

  it('rolls over to 60 minutes', () => {
    expect(formatDuration(3_600_000)).toBe('60:00');
  });
});

describe('utils: formatCount', () => {
  it('returns the raw number below 1000', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
  });

  it('formats thousands with one decimal', () => {
    expect(formatCount(1000)).toBe('1.0K');
    expect(formatCount(1500)).toBe('1.5K');
    expect(formatCount(999_999)).toBe('1000.0K');
  });

  it('formats millions with one decimal', () => {
    expect(formatCount(1_000_000)).toBe('1.0M');
    expect(formatCount(2_500_000)).toBe('2.5M');
  });
});

describe('utils: formatDate', () => {
  // Midday-UTC timestamps are used so the local date is stable across timezones
  // (the exact day can shift by one at extreme offsets, so assert month+year).
  it('formats an ISO date as a long US date', () => {
    expect(formatDate('2024-03-05T12:00:00.000Z')).toMatch(/^March \d{1,2}, 2024$/);
  });

  it('formats a full ISO timestamp', () => {
    expect(formatDate('2024-06-15T12:00:00.000Z')).toMatch(/^June \d{1,2}, 2024$/);
  });
});

describe('utils: getGreeting', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-15T08:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // getGreeting() uses LOCAL hours, so the expected greeting depends on the
  // machine's timezone. Compute it from the same instant the mock reports.
  const expectedGreeting = (utc: string) => {
    const hour = new Date(utc).getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  it('says Good Morning before noon', () => {
    jest.setSystemTime(new Date('2024-06-15T09:00:00.000Z'));
    expect(getGreeting()).toBe(expectedGreeting('2024-06-15T09:00:00.000Z'));
  });

  it('says Good Afternoon between noon and 5pm', () => {
    jest.setSystemTime(new Date('2024-06-15T14:00:00.000Z'));
    expect(getGreeting()).toBe(expectedGreeting('2024-06-15T14:00:00.000Z'));
  });

  it('says Good Evening after 5pm', () => {
    jest.setSystemTime(new Date('2024-06-15T20:00:00.000Z'));
    expect(getGreeting()).toBe(expectedGreeting('2024-06-15T20:00:00.000Z'));
  });
});

describe('utils: getRelativeTime', () => {
  const now = new Date('2024-06-15T12:00:00.000Z').getTime();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(now));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "Just now" for less than a minute', () => {
    expect(getRelativeTime(new Date(now - 30_000).toISOString())).toBe('Just now');
  });

  it('returns minutes ago', () => {
    expect(getRelativeTime(new Date(now - 5 * 60_000).toISOString())).toBe('5m ago');
  });

  it('returns hours ago', () => {
    expect(getRelativeTime(new Date(now - 3 * 3_600_000).toISOString())).toBe('3h ago');
  });

  it('returns days ago within a week', () => {
    expect(getRelativeTime(new Date(now - 2 * 86_400_000).toISOString())).toBe('2d ago');
  });

  it('falls back to formatDate after a week', () => {
    // 8 days before now -> long date form (day may vary by timezone).
    expect(getRelativeTime(new Date(now - 8 * 86_400_000).toISOString())).toMatch(
      /^June \d{1,2}, 2024$/
    );
  });
});

describe('utils: getImageUrl', () => {
  it('returns an empty string for no url', () => {
    expect(getImageUrl()).toBe('');
    expect(getImageUrl(undefined)).toBe('');
  });

  it('returns non-supabase urls untouched', () => {
    expect(getImageUrl('https://cdn.example.com/art/1.jpg')).toBe('https://cdn.example.com/art/1.jpg');
  });

  it('appends resize params to supabase urls', () => {
    expect(getImageUrl('https://xyz.supabase.co/storage/art/1.jpg')).toBe(
      'https://xyz.supabase.co/storage/art/1.jpg?width=300&quality=80'
    );
  });

  it('honors a custom size', () => {
    expect(getImageUrl('https://xyz.supabase.co/storage/art/1.jpg', 500)).toBe(
      'https://xyz.supabase.co/storage/art/1.jpg?width=500&quality=80'
    );
  });
});

describe('utils: getStorage', () => {
  const storage = getStorage('spotibase-test');

  beforeEach(() => {
    storage.clearAll();
  });

  it('returns a storage object with getString/set/clearAll', () => {
    expect(typeof storage.getString).toBe('function');
    expect(typeof storage.set).toBe('function');
    expect(typeof storage.clearAll).toBe('function');
  });

  it('round-trips values', () => {
    storage.set('key', 'value');
    expect(storage.getString('key')).toBe('value');
  });

  it('returns undefined for missing keys', () => {
    expect(storage.getString('missing')).toBeUndefined();
  });

  it('clearAll empties the store', () => {
    storage.set('a', '1');
    storage.set('b', '2');
    storage.clearAll();
    expect(storage.getString('a')).toBeUndefined();
    expect(storage.getString('b')).toBeUndefined();
  });
});
