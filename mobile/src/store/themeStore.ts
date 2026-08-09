import { create } from 'zustand';
import { Theme, DarkTheme, AmoledTheme, LightTheme } from '../theme';
import { getStorage } from '../utils';

const storage = getStorage('spotibase-theme');

interface ThemeState {
  theme: Theme;
  themeMode: 'DARK' | 'AMOLED' | 'LIGHT';
  setThemeMode: (mode: 'DARK' | 'AMOLED' | 'LIGHT') => void;
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

  setThemeMode: (mode) => {
    storage.set('themeMode', mode);
    set({ theme: themeMap[mode], themeMode: mode });
  },

  loadTheme: () => {
    const saved = storage.getString('themeMode') as 'DARK' | 'AMOLED' | 'LIGHT' | undefined;
    const mode = saved || 'DARK';
    set({ theme: themeMap[mode], themeMode: mode });
  },
}));
