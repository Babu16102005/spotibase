import { ViewStyle, TextStyle, ImageStyle, Platform } from 'react-native';

export interface Theme {
  dark: boolean;
  colors: {
    background: string;
    surface: string;
    surfaceLight: string;
    primary: string;
    primaryDark: string;
    primaryHover: string;
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
    playerBar: string;
    sidebar: string;
    cardHover: string;
    heroTop: string;
    heroBottom: string;
    skeleton: string;
    shimmer: string;
  };
  fonts: {
    display: string;
    bold: string;
    semibold: string;
    medium: string;
    regular: string;
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

const isWeb = Platform.OS === 'web';

export const DarkTheme: Theme = {
  dark: true,
  colors: {
    background: isWeb ? 'rgba(20, 20, 25, 0.45)' : '#121212',
    surface: isWeb ? 'rgba(28, 28, 35, 0.45)' : '#181818',
    surfaceLight: isWeb ? 'rgba(45, 45, 55, 0.55)' : '#282828',
    primary: '#1DB954',
    primaryDark: '#169C46',
    primaryHover: '#1ED760',
    secondary: '#E040FB',
    text: '#FFFFFF',
    textSecondary: 'rgba(255, 255, 255, 0.7)',
    textTertiary: 'rgba(255, 255, 255, 0.45)',
    border: isWeb ? 'rgba(255, 255, 255, 0.08)' : '#2A2A2A',
    error: '#E74C3C',
    success: '#2ECC71',
    warning: '#F39C12',
    overlay: 'rgba(0, 0, 0, 0.7)',
    glass: 'rgba(255, 255, 255, 0.10)',
    tabBar: isWeb ? 'rgba(15, 15, 18, 0.5)' : '#000000',
    playerBackground: isWeb ? 'rgba(28, 28, 35, 0.6)' : '#282828',
    playerBar: isWeb ? 'rgba(20, 20, 25, 0.6)' : '#181818',
    sidebar: isWeb ? 'rgba(18, 18, 22, 0.45)' : '#000000',
    cardHover: 'rgba(255, 255, 255, 0.08)',
    heroTop: isWeb ? 'rgba(30, 58, 43, 0.4)' : '#1E3A2B',
    heroBottom: isWeb ? 'rgba(20, 20, 25, 0.45)' : '#121212',
    skeleton: 'rgba(255, 255, 255, 0.05)',
    shimmer: 'rgba(255, 255, 255, 0.1)',
  },
  fonts: {
    display: 'Montserrat_800ExtraBold',
    bold: 'Montserrat_700Bold',
    semibold: 'Montserrat_600SemiBold',
    medium: 'Montserrat_500Medium',
    regular: 'Montserrat_400Regular',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  fontSize: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20, xxl: 24, title: 32 },
  borderRadius: { sm: 4, md: 8, lg: 12, xl: 16, full: 9999 },
};

export const AmoledTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: isWeb ? 'rgba(0, 0, 0, 0.6)' : '#000000',
    surface: isWeb ? 'rgba(10, 10, 10, 0.6)' : '#0A0A0A',
    surfaceLight: isWeb ? 'rgba(26, 26, 26, 0.7)' : '#1A1A1A',
    tabBar: isWeb ? 'rgba(0, 0, 0, 0.65)' : '#000000',
    playerBackground: isWeb ? 'rgba(10, 10, 10, 0.75)' : '#0A0A0A',
    playerBar: isWeb ? 'rgba(10, 10, 10, 0.75)' : '#0A0A0A',
    sidebar: isWeb ? 'rgba(0, 0, 0, 0.65)' : '#000000',
    heroTop: isWeb ? 'rgba(15, 31, 22, 0.55)' : '#0F1F16',
    heroBottom: isWeb ? 'rgba(0, 0, 0, 0.6)' : '#000000',
  },
};

export const LightTheme: Theme = {
  dark: false,
  colors: {
    background: isWeb ? 'rgba(245, 245, 250, 0.5)' : '#FFFFFF',
    surface: isWeb ? 'rgba(255, 255, 255, 0.45)' : '#F6F6F6',
    surfaceLight: isWeb ? 'rgba(0, 0, 0, 0.06)' : '#E8E8E8',
    primary: '#1DB954',
    primaryDark: '#169C46',
    primaryHover: '#1ED760',
    secondary: '#E040FB',
    text: '#1C1C1E',
    textSecondary: 'rgba(0, 0, 0, 0.6)',
    textTertiary: 'rgba(0, 0, 0, 0.4)',
    border: isWeb ? 'rgba(0, 0, 0, 0.08)' : '#DEDEDE',
    error: '#E74C3C',
    success: '#2ECC71',
    warning: '#F39C12',
    overlay: 'rgba(0, 0, 0, 0.5)',
    glass: 'rgba(0, 0, 0, 0.06)',
    tabBar: isWeb ? 'rgba(255, 255, 255, 0.6)' : '#FFFFFF',
    playerBackground: isWeb ? 'rgba(255, 255, 255, 0.65)' : '#FFFFFF',
    playerBar: isWeb ? 'rgba(245, 245, 250, 0.65)' : '#F0F0F0',
    sidebar: isWeb ? 'rgba(255, 255, 255, 0.5)' : '#121212',
    cardHover: 'rgba(0, 0, 0, 0.04)',
    heroTop: isWeb ? 'rgba(214, 245, 224, 0.5)' : '#D6F5E0',
    heroBottom: isWeb ? 'rgba(245, 245, 250, 0.5)' : '#FFFFFF',
    skeleton: 'rgba(0, 0, 0, 0.05)',
    shimmer: 'rgba(0, 0, 0, 0.08)',
  },
  fonts: {
    display: 'Montserrat_800ExtraBold',
    bold: 'Montserrat_700Bold',
    semibold: 'Montserrat_600SemiBold',
    medium: 'Montserrat_500Medium',
    regular: 'Montserrat_400Regular',
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
