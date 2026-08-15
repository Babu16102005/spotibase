import { create } from 'zustand';
import { Theme, DarkTheme, AmoledTheme, LightTheme } from '../theme';
import { getStorage } from '../utils';

const storage = getStorage('spotibase-theme');

export type GreetingPattern = 'RANDOM' | 'FLUID' | 'AURORA' | 'COSMIC' | 'GEOMETRIC';

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
  greetingPattern: 'RANDOM',

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
    const pattern: GreetingPattern =
      savedPattern === 'RADIAL'
        ? 'AURORA'
        : (savedPattern as GreetingPattern) || 'RANDOM';
    set({ theme: themeMap[mode], themeMode: mode, greetingPattern: pattern });
  },
}));
