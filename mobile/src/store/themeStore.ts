import { create } from 'zustand';
import { Theme, DarkTheme, AmoledTheme, LightTheme } from '../theme';
import { getStorage } from '../utils';

const storage = getStorage('spotibase-theme');

export type GreetingPattern = 'FLUID' | 'AURORA';

interface ThemeState {
  theme: Theme;
  themeMode: 'DARK' | 'AMOLED' | 'LIGHT';
  greetingPattern: GreetingPattern;
  setThemeMode: (mode: 'DARK' | 'AMOLED' | 'LIGHT') => void;
  setGreetingPattern: (pattern: GreetingPattern) => void;
  loadTheme: () => void;
}

const themeMap = {
  DARK: DarkTheme,
  AMOLED: AmoledTheme,
  LIGHT: LightTheme,
};

export const useThemeStore = create<ThemeState>((set) => ({
  theme: DarkTheme,
  themeMode: 'DARK',
  greetingPattern: 'FLUID',

  setThemeMode: (mode) => {
    storage.set('themeMode', mode);
    set({ theme: themeMap[mode], themeMode: mode });
  },

  setGreetingPattern: (pattern) => {
    storage.set('greetingPattern', pattern);
    set({ greetingPattern: pattern });
  },

  loadTheme: () => {
    const savedMode = storage.getString('themeMode') as 'DARK' | 'AMOLED' | 'LIGHT' | undefined;
    const mode = savedMode || 'DARK';
    const savedPattern = storage.getString('greetingPattern') as string | undefined;
    // Only FLUID and AURORA are supported. FLUID is the default.
    // Legacy values (RANDOM, COSMIC, GEOMETRIC, unknown) migrate to FLUID;
    // RADIAL migrates to AURORA. Persist the migration back.
    const pattern: GreetingPattern =
      savedPattern === 'AURORA' || savedPattern === 'RADIAL' ? 'AURORA' : 'FLUID';
    if (savedPattern !== pattern) {
      storage.set('greetingPattern', pattern);
    }
    set({ theme: themeMap[mode], themeMode: mode, greetingPattern: pattern });
  },
}));
