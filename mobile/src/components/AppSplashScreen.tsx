import React, { useEffect, useRef } from 'react';
import { View, Image, StyleSheet, Animated, Dimensions, Platform } from 'react-native';
import { useThemeStore } from '../store';

const WORD_IMAGE = require('../../assets/word.png');
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface AppSplashScreenProps {
  onAnimationComplete?: () => void;
  isReady?: boolean;
}

export default function AppSplashScreen({ onAnimationComplete, isReady = true }: AppSplashScreenProps) {
  const { theme } = useThemeStore();
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const containerOpacity = useRef(new Animated.Value(1)).current;

  const useNative = Platform.OS !== 'web' && process.env.NODE_ENV !== 'test';

  useEffect(() => {
    // 1. Fade in & scale up the wording logo smoothly
    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 450,
        useNativeDriver: useNative,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 40,
        friction: 8,
        useNativeDriver: useNative,
      }),
    ]).start();

    // 2. When ready, hold briefly and fade out smoothly
    if (isReady) {
      const timer = setTimeout(() => {
        Animated.timing(containerOpacity, {
          toValue: 0,
          duration: 350,
          useNativeDriver: useNative,
        }).start(() => {
          if (onAnimationComplete) {
            onAnimationComplete();
          }
        });

        if (process.env.NODE_ENV === 'test' && onAnimationComplete) {
          onAnimationComplete();
        }
      }, 950);

      return () => clearTimeout(timer);
    }
  }, [isReady]);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.container,
        {
          backgroundColor: theme.dark ? '#09090b' : '#0c0d12',
          opacity: containerOpacity,
          zIndex: 99999,
        },
      ]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[
          styles.imageWrapper,
          {
            opacity: opacityAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Image
          source={WORD_IMAGE}
          style={styles.wordImage}
          resizeMode="contain"
          accessibilityLabel="SpotiBase"
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: Math.min(SCREEN_WIDTH * 0.75, 320),
    height: 160,
  },
  wordImage: {
    width: '100%',
    height: '100%',
  },
});
