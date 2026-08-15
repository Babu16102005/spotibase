import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useThemeStore } from '../store';
import { getGreeting } from '../utils';
import Icon from './Icon';
import GlassButton from './GlassButton';
import VelarisShader from './VelarisShader';

interface GreetingHeaderProps {
  greetingText?: string;
  loading?: boolean;
  onPillPress?: (pillLabel: string) => void;
  colors?: string[];
  bg?: string;
  speed?: number;
  grain?: number;
  pattern?: 'fluid' | 'aurora' | 'cosmic' | 'geometric';
}

const PILLS = [
  { label: 'Songs', icon: 'songs' as const },
  { label: 'Albums', icon: 'library' as const },
  { label: 'Playlists', icon: 'music' as const },
  { label: 'Liked Songs', icon: 'heart' as const },
];

export const PATTERN_PALETTES: Record<'fluid' | 'aurora' | 'cosmic' | 'geometric', string[]> = {
  fluid: ['#5227FF', '#FF9FFC', '#FFFFFF', '#07080D'],     // Signature Molten Metal (Violet, Neon Pink, White Core)
  aurora: ['#f7f7f7', '#e100ff', '#3A29FF', '#07080D'],    // Official ReactBits Soft Aurora (Pearl White, Radiant Magenta, Deep Indigo)
  cosmic: ['#332FD0', '#9254C8', '#E15FED', '#6EDCD9'],    // Cosmic Plasma Vortex
  geometric: ['#063B00', '#266210', '#90B800', '#E1E100'], // Emerald Matrix Lattice
};

export const MULTICOLOR_PALETTES = {
  morning: ['#063B00', '#266210', '#90B800', '#E1E100'],   // Dark Forest Green, Lush Green, Olive Lime, Morning Yellow
  afternoon: ['#2C5EAD', '#1591DC', '#4BB8FA', '#C4E2F5'], // Deep Ocean Blue, Electric Blue, Sky Blue, Soft Cyan
  evening: ['#332FD0', '#9254C8', '#E15FED', '#6EDCD9'],   // Deep Violet/Indigo, Rich Violet, Pink Magenta, Glowing Teal/Cyan
  default: ['#063B00', '#266210', '#90B800', '#E1E100'],   // Default Morning palette
  fluid: ['#5227FF', '#FF9FFC', '#FFFFFF', '#07080D'],     // Exact ReactBits Molten Metal Palette
  molten: ['#5227FF', '#FF9FFC', '#FFFFFF', '#07080D'],
  aurora: ['#f7f7f7', '#e100ff', '#3A29FF', '#07080D'],    // Exact ReactBits Soft Aurora Palette
};

const PATTERN_TYPES = ['fluid', 'aurora', 'cosmic', 'geometric'] as const;

const resolveHeaderColors = (textStr: string, customColors?: string[], currentPattern?: 'fluid' | 'aurora' | 'cosmic' | 'geometric'): string[] => {
  if (customColors && customColors.length >= 4) return customColors;
  if (currentPattern && PATTERN_PALETTES[currentPattern]) {
    return PATTERN_PALETTES[currentPattern];
  }
  const lower = textStr.toLowerCase();
  if (lower.includes('morning')) return MULTICOLOR_PALETTES.morning;
  if (lower.includes('afternoon')) return MULTICOLOR_PALETTES.afternoon;
  if (lower.includes('evening')) return MULTICOLOR_PALETTES.evening;
  return MULTICOLOR_PALETTES.default;
};

export const GreetingHeader: React.FC<GreetingHeaderProps> = ({
  greetingText,
  loading = false,
  onPillPress,
  colors,
  bg,
  speed,
  grain = 0.3,
  pattern,
}) => {
  const { theme, greetingPattern: storeGreetingPattern } = useThemeStore();

  // Stable resolver — maps store pattern to valid active pattern string
  const resolvePattern = React.useCallback((): 'fluid' | 'aurora' | 'cosmic' | 'geometric' => {
    if (pattern) return pattern;
    if (storeGreetingPattern && storeGreetingPattern !== 'RANDOM') {
      const lower = storeGreetingPattern.toLowerCase();
      if (lower === 'aurora' || lower === 'radial') return 'aurora';
      if (lower === 'cosmic') return 'cosmic';
      if (lower === 'geometric') return 'geometric';
      return 'fluid';
    }
    return PATTERN_TYPES[Math.floor(Math.random() * PATTERN_TYPES.length)];
  }, [pattern, storeGreetingPattern]);

  // State for pattern and animation speed combination
  const [activePattern, setActivePattern] = React.useState<'fluid' | 'aurora' | 'cosmic' | 'geometric'>(
    resolvePattern()
  );
  const [activeSpeed, setActiveSpeed] = React.useState<number>(
    speed || (resolvePattern() === 'fluid' ? 0.35 : resolvePattern() === 'aurora' ? 0.6 : 1.0)
  );

  // React directly to store changes
  useEffect(() => {
    if (pattern) {
      setActivePattern(pattern);
      setActiveSpeed(speed || (pattern === 'fluid' ? 0.35 : pattern === 'aurora' ? 0.6 : 1.0));
      return;
    }
    if (storeGreetingPattern && storeGreetingPattern !== 'RANDOM') {
      const lower = storeGreetingPattern.toLowerCase();
      const nextPat: 'fluid' | 'aurora' | 'cosmic' | 'geometric' =
        lower === 'aurora' || lower === 'radial'
          ? 'aurora'
          : lower === 'cosmic'
          ? 'cosmic'
          : lower === 'geometric'
          ? 'geometric'
          : 'fluid';
      setActivePattern(nextPat);
      setActiveSpeed(speed || (nextPat === 'fluid' ? 0.35 : nextPat === 'aurora' ? 0.6 : 1.0));
    } else {
      // RANDOM: pick a new random pattern
      const randPat = PATTERN_TYPES[Math.floor(Math.random() * PATTERN_TYPES.length)];
      setActivePattern(randPat);
      setActiveSpeed(speed || (randPat === 'fluid' ? 0.35 : randPat === 'aurora' ? 0.6 : 1.0));
    }
  }, [storeGreetingPattern, pattern, speed]);

  const text = greetingText || getGreeting();
  const headerColors = React.useMemo(
    () => resolveHeaderColors(text, colors, activePattern),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, colors?.join(','), activePattern]
  );

  const effectiveBg = bg || (theme.dark ? '#000000' : '#FFFFFF');

  return (
    <VelarisShader
      bg={effectiveBg}
      colors={headerColors}
      speed={activeSpeed}
      grain={grain}
      pattern={activePattern}
      style={[
        styles.container,
        { backgroundColor: theme.dark ? '#07080d' : '#1A1C24' }
      ]}
    >
      {/* Content Container */}
      <View style={styles.content}>
        <View style={styles.greetingHeaderRow}>
          <Text style={styles.greetingText}>{text}</Text>
        </View>

        {/* Quick Filter Pills - Glass buttons rendered for consistent liquid glass aesthetic */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}
          style={styles.pillScroll}
        >
          {PILLS.map((pill) => (
            <GlassButton
              key={pill.label}
              variant="metal"
              size="sm"
              icon={pill.icon}
              iconSize={14}
              title={pill.label}
              onPress={() => onPillPress?.(pill.label)}
              accessibilityLabel={pill.label}
            />
          ))}
        </ScrollView>
      </View>
    </VelarisShader>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    paddingTop: Platform.OS === 'web' ? 24 : 48,
    paddingBottom: 20,
    borderRadius: 0,
    overflow: 'hidden',
    backgroundColor: '#07080d',
  },
  content: {
    position: 'relative',
    zIndex: 2,
  },
  greetingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  greetingText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.8,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  pillScroll: {
    marginTop: 4,
  },
  pillRow: {
    paddingHorizontal: 20,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default GreetingHeader;
