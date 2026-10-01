import { useThemeStore } from './themeStore';
import { DarkTheme, LightTheme, AmoledTheme } from '../theme';
import { getStorage } from '../utils';

const storage = getStorage('spotibase-theme');

describe('themeStore', () => {
  beforeEach(() => {
    storage.clearAll();
    useThemeStore.setState({ theme: DarkTheme, themeMode: 'DARK', greetingPattern: 'FLUID' });
  });

  it('starts with the dark theme by default', () => {
    const { theme, themeMode } = useThemeStore.getState();
    expect(themeMode).toBe('DARK');
    expect(theme.dark).toBe(true);
    expect(theme.colors.background).toBe('#121212');
  });

  it('setThemeMode("LIGHT") switches the theme and persists it', () => {
    useThemeStore.getState().setThemeMode('LIGHT');
    const { theme, themeMode } = useThemeStore.getState();
    expect(themeMode).toBe('LIGHT');
    expect(theme).toBe(LightTheme);
    expect(theme.dark).toBe(false);
    expect(storage.getString('themeMode')).toBe('LIGHT');
  });

  it('setThemeMode("AMOLED") switches to the amoled theme and persists it', () => {
    useThemeStore.getState().setThemeMode('AMOLED');
    const { theme, themeMode } = useThemeStore.getState();
    expect(themeMode).toBe('AMOLED');
    expect(theme).toBe(AmoledTheme);
    expect(theme.colors.background).toBe('#000000');
    expect(storage.getString('themeMode')).toBe('AMOLED');
  });

  it('loadTheme restores a persisted mode', () => {
    storage.set('themeMode', 'AMOLED');
    useThemeStore.setState({ theme: DarkTheme, themeMode: 'DARK' });
    useThemeStore.getState().loadTheme();
    const { theme, themeMode } = useThemeStore.getState();
    expect(themeMode).toBe('AMOLED');
    expect(theme.colors.background).toBe('#000000');
  });

  it('loadTheme falls back to DARK when nothing is persisted', () => {
    useThemeStore.setState({ theme: LightTheme, themeMode: 'LIGHT' });
    useThemeStore.getState().loadTheme();
    const { theme, themeMode } = useThemeStore.getState();
    expect(themeMode).toBe('DARK');
    expect(theme).toBe(DarkTheme);
  });

  it('setThemeMode then loadTheme round-trips through storage', () => {
    useThemeStore.getState().setThemeMode('LIGHT');
    useThemeStore.setState({ theme: DarkTheme, themeMode: 'DARK' });
    useThemeStore.getState().loadTheme();
    const { theme, themeMode } = useThemeStore.getState();
    expect(themeMode).toBe('LIGHT');
    expect(theme).toBe(LightTheme);
  });

  it('starts with FLUID greeting pattern by default', () => {
    const { greetingPattern } = useThemeStore.getState();
    expect(greetingPattern).toBe('FLUID');
  });

  it('setGreetingPattern updates state and persists to storage', () => {
    useThemeStore.getState().setGreetingPattern('AURORA');
    const { greetingPattern } = useThemeStore.getState();
    expect(greetingPattern).toBe('AURORA');
    expect(storage.getString('greetingPattern')).toBe('AURORA');
  });

  it('loadTheme restores persisted greeting pattern', () => {
    storage.set('greetingPattern', 'AURORA');
    useThemeStore.getState().loadTheme();
    expect(useThemeStore.getState().greetingPattern).toBe('AURORA');
  });

  it('loadTheme migrates legacy RADIAL pattern to AURORA', () => {
    storage.set('greetingPattern', 'RADIAL');
    useThemeStore.getState().loadTheme();
    expect(useThemeStore.getState().greetingPattern).toBe('AURORA');
  });

  it('loadTheme migrates legacy RANDOM/COSMIC/GEOMETRIC patterns to FLUID', () => {
    for (const legacy of ['RANDOM', 'COSMIC', 'GEOMETRIC', 'unknown']) {
      storage.set('greetingPattern', legacy);
      useThemeStore.getState().loadTheme();
      expect(useThemeStore.getState().greetingPattern).toBe('FLUID');
    }
  });
});
