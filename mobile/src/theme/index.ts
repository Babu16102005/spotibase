import { ViewStyle, TextStyle, ImageStyle } from 'react-native';

export interface Theme {
  dark: boolean;
  colors: {
    background: string;
    surface: string;
    surfaceLight: string;
    primary: string;
    primaryDark: string;
    secondary: string;
    text: string;
    textSecondary: string;
    textTertiary: string;
    border: string;
    error: string;
    success: string;
    warning: string;
    overlay: string;
    glass: string;
    tabBar: string;
    playerBackground: string;
    skeleton: string;
    shimmer: string;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
  fontSize: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    title: number;
  };
  borderRadius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    full: number;
  };
}

export type NamedStyles<T> = {
  [P in keyof T]: ViewStyle | TextStyle | ImageStyle;
};

export const DarkTheme: Theme = {
  dark: true,
  colors: {
    background: '#121212',
    surface: '#1E1E1E',
    surfaceLight: '#282828',
    primary: '#1DB954',
    primaryDark: '#169C46',
    secondary: '#E040FB',
    text: '#FFFFFF',
    textSecondary: '#B3B3B3',
    textTertiary: '#727272',
    border: '#333333',
    error: '#E74C3C',
    success: '#2ECC71',
    warning: '#F39C12',
    overlay: 'rgba(0, 0, 0, 0.7)',
    glass: 'rgba(255, 255, 255, 0.08)',
    tabBar: '#101010',
    playerBackground: '#282828',
    skeleton: '#2A2A2A',
    shimmer: '#3A3A3A',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  fontSize: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20, xxl: 24, title: 32 },
  borderRadius: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
};

export const AmoledTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#000000',
    surface: '#0A0A0A',
    surfaceLight: '#1A1A1A',
    tabBar: '#000000',
    playerBackground: '#0A0A0A',
  },
};

export const LightTheme: Theme = {
  dark: false,
  colors: {
    background: '#FFFFFF',
    surface: '#F5F5F5',
    surfaceLight: '#E8E8E8',
    primary: '#1DB954',
    primaryDark: '#169C46',
    secondary: '#E040FB',
    text: '#191919',
    textSecondary: '#535353',
    textTertiary: '#A0A0A0',
    border: '#DEDEDE',
    error: '#E74C3C',
    success: '#2ECC71',
    warning: '#F39C12',
    overlay: 'rgba(0, 0, 0, 0.5)',
    glass: 'rgba(0, 0, 0, 0.05)',
    tabBar: '#F0F0F0',
    playerBackground: '#FFFFFF',
    skeleton: '#E0E0E0',
    shimmer: '#F0F0F0',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  fontSize: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20, xxl: 24, title: 32 },
  borderRadius: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
};

export const themeMap: Record<string, Theme> = {
  DARK: DarkTheme,
  AMOLED: AmoledTheme,
  LIGHT: LightTheme,
};
