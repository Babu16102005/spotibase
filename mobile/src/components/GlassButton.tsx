import React, { useRef, useState } from 'react';
import {
  Text,
  StyleSheet,
  View,
  Animated,
  TouchableOpacity,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  Platform,
  StyleProp,
} from 'react-native';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useThemeStore } from '../store/themeStore';
import Icon from './Icon';

export type GlassButtonVariant =
  | 'default'
  | 'primary'
  | 'cool'
  | 'metal'
  | 'glass'
  | 'liquid'
  | 'destructive'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'success'
  | 'gold'
  | 'bronze';

export type GlassButtonSize = 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'icon';

export interface GlassButtonProps {
  title?: string;
  children?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  shape?: 'rounded' | 'pill';
  icon?: string;
  iconSize?: number;
  iconColor?: string;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export const GlassButton: React.FC<GlassButtonProps> = ({
  title,
  children,
  onPress,
  onLongPress,
  variant = 'default',
  size = 'md',
  shape = 'rounded',
  icon,
  iconSize,
  iconColor,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}) => {
  const { theme } = useThemeStore();
  const isDark = theme.dark;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [hovered, setHovered] = useState(false);
  const isTest = process.env.NODE_ENV === 'test';
  const buttonId = useRef(`liq_${Math.random().toString(36).substring(2, 9)}`).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: !isTest && Platform.OS !== 'web',
      speed: 40,
      bounciness: 0,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 160,
      useNativeDriver: !isTest && Platform.OS !== 'web',
    }).start();
  };

  // Glassy styling with subtle matching border and liquid surface sheen
  const getVariantStyles = () => {
    const baseGlassBorder = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)';
    const baseWebGlassShadow = isDark
      ? '0 10px 28px -4px rgba(0, 0, 0, 0.40), inset 0 0 20px 2px rgba(255, 255, 255, 0.05)'
      : '0 10px 24px -4px rgba(0, 0, 0, 0.10), inset 0 0 20px 2px rgba(255, 255, 255, 0.40)';

    switch (variant) {
      case 'primary':
        return {
          bg: isDark ? 'rgba(29, 185, 84, 0.38)' : '#1DB954',
          borderColor: isDark ? 'rgba(29, 185, 84, 0.45)' : 'rgba(20, 140, 60, 0.35)',
          textColor: isDark ? '#FFFFFF' : '#000000',
          liquidGlossTop: isDark ? 0.35 : 0.45,
          glowColor: '#1DB954',
          webBoxShadow: isDark
            ? '0 10px 28px -4px rgba(29, 185, 84, 0.35), inset 0 0 18px 2px rgba(255, 255, 255, 0.10)'
            : '0 10px 24px -4px rgba(29, 185, 84, 0.35), inset 0 0 18px 2px rgba(255, 255, 255, 0.30)',
        };
      case 'cool':
        return {
          bg: isDark ? 'rgba(6, 182, 212, 0.35)' : '#06B6D4',
          borderColor: isDark ? 'rgba(6, 182, 212, 0.45)' : 'rgba(8, 145, 178, 0.35)',
          textColor: isDark ? '#FFFFFF' : '#000000',
          liquidGlossTop: isDark ? 0.35 : 0.45,
          glowColor: '#06B6D4',
          webBoxShadow: isDark
            ? '0 10px 28px -4px rgba(6, 182, 212, 0.35), inset 0 0 18px 2px rgba(255, 255, 255, 0.10)'
            : '0 10px 24px -4px rgba(6, 182, 212, 0.35), inset 0 0 18px 2px rgba(255, 255, 255, 0.30)',
        };
      case 'destructive':
        return {
          bg: isDark ? 'rgba(239, 68, 68, 0.30)' : '#EF4444',
          borderColor: isDark ? 'rgba(239, 68, 68, 0.45)' : 'rgba(185, 28, 28, 0.35)',
          textColor: '#FFFFFF',
          liquidGlossTop: 0.32,
          glowColor: '#EF4444',
          webBoxShadow: '0 10px 24px -4px rgba(239, 68, 68, 0.30), inset 0 0 18px 2px rgba(255, 255, 255, 0.12)',
        };
      case 'success':
        return {
          bg: isDark ? 'rgba(16, 185, 129, 0.30)' : '#10B981',
          borderColor: isDark ? 'rgba(16, 185, 129, 0.45)' : 'rgba(4, 120, 87, 0.35)',
          textColor: '#FFFFFF',
          liquidGlossTop: 0.32,
          glowColor: '#10B981',
          webBoxShadow: '0 10px 24px -4px rgba(16, 185, 129, 0.30), inset 0 0 18px 2px rgba(255, 255, 255, 0.12)',
        };
      case 'gold':
        return {
          bg: isDark ? 'rgba(234, 179, 8, 0.30)' : '#EAB308',
          borderColor: isDark ? 'rgba(234, 179, 8, 0.45)' : 'rgba(161, 98, 7, 0.35)',
          textColor: '#000000',
          liquidGlossTop: 0.32,
          glowColor: '#EAB308',
          webBoxShadow: '0 10px 24px -4px rgba(234, 179, 8, 0.30), inset 0 0 18px 2px rgba(255, 255, 255, 0.12)',
        };
      case 'bronze':
        return {
          bg: isDark ? 'rgba(217, 119, 6, 0.30)' : '#D97706',
          borderColor: isDark ? 'rgba(217, 119, 6, 0.45)' : 'rgba(146, 64, 14, 0.35)',
          textColor: '#FFFFFF',
          liquidGlossTop: 0.32,
          glowColor: '#D97706',
          webBoxShadow: '0 10px 24px -4px rgba(217, 119, 6, 0.30), inset 0 0 18px 2px rgba(255, 255, 255, 0.12)',
        };
      case 'metal':
        return {
          bg: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.85)',
          borderColor: baseGlassBorder,
          textColor: isDark ? '#FFFFFF' : '#111111',
          liquidGlossTop: isDark ? 0.32 : 0.45,
          glowColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)',
          webBoxShadow: baseWebGlassShadow,
        };
      case 'secondary':
        return {
          bg: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.65)',
          borderColor: baseGlassBorder,
          textColor: theme.colors.text,
          liquidGlossTop: 0.22,
          glowColor: 'transparent',
          webBoxShadow: baseWebGlassShadow,
        };
      case 'outline':
        return {
          bg: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
          borderColor: isDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.18)',
          textColor: theme.colors.text,
          liquidGlossTop: 0.15,
          glowColor: 'transparent',
          webBoxShadow: baseWebGlassShadow,
        };
      case 'ghost':
        return {
          bg: hovered ? (isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)') : 'transparent',
          borderColor: 'transparent',
          textColor: theme.colors.text,
          liquidGlossTop: 0,
          glowColor: 'transparent',
          webBoxShadow: 'none',
        };
      case 'liquid':
      case 'glass':
      case 'default':
      default:
        return {
          bg: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.78)',
          borderColor: baseGlassBorder,
          textColor: isDark ? '#FFFFFF' : '#111111',
          liquidGlossTop: isDark ? 0.32 : 0.45,
          glowColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)',
          webBoxShadow: baseWebGlassShadow,
        };
    }
  };

  const currentVariant = getVariantStyles();

  // Size metrics - Clean rounded rectangles with moderate smooth corner curves matching the email input (24px for lg, 20px for md)
  const getSizeMetrics = () => {
    switch (size) {
      case 'sm':
        return {
          height: 36,
          paddingHorizontal: 16,
          borderRadius: 16,
          fontSize: 12,
          iconSize: 14,
          gap: 6,
        };
      case 'lg':
        return {
          height: 52,
          paddingHorizontal: 24,
          borderRadius: 24,
          fontSize: 15,
          iconSize: 18,
          gap: 8,
        };
      case 'xl':
        return {
          height: 58,
          paddingHorizontal: 28,
          borderRadius: 26,
          fontSize: 16,
          iconSize: 20,
          gap: 10,
        };
      case 'xxl':
        return {
          height: 64,
          paddingHorizontal: 32,
          borderRadius: 30,
          fontSize: 17,
          iconSize: 22,
          gap: 12,
        };
      case 'icon':
        return {
          height: 44,
          width: 44,
          paddingHorizontal: 0,
          borderRadius: 16,
          fontSize: 14,
          iconSize: 18,
          gap: 0,
        };
      case 'md':
      default:
        return {
          height: 46,
          paddingHorizontal: 20,
          borderRadius: 20,
          fontSize: 14,
          iconSize: 16,
          gap: 8,
        };
    }
  };

  const sizeMetrics = getSizeMetrics();
  const effectiveIconSize = iconSize || sizeMetrics.iconSize;
  const effectiveIconColor = iconColor || currentVariant.textColor;
  const flattenedStyle = StyleSheet.flatten(style);
  const effectiveRadius =
    typeof flattenedStyle?.borderRadius === 'number'
      ? flattenedStyle.borderRadius
      : shape === 'pill'
      ? 9999
      : sizeMetrics.borderRadius;

  const onHoverProps =
    Platform.OS === 'web'
      ? {
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
        }
      : {};

  return (
    <Animated.View
      style={[
        styles.wrapper,
        fullWidth && styles.fullWidth,
        {
          transform: [{ scale: scaleAnim }],
          shadowColor: currentVariant.glowColor || '#000000',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: isDark ? 0.28 : 0.15,
          shadowRadius: 14,
          elevation: variant === 'ghost' ? 0 : 3,
        },
      ]}
    >
      <TouchableOpacity
        onPress={onPress}
        onLongPress={onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        activeOpacity={0.85}
        accessibilityLabel={accessibilityLabel || title}
        testID={testID}
        {...onHoverProps}
        style={[
          styles.buttonContainer,
          {
            height: sizeMetrics.height,
            paddingHorizontal: sizeMetrics.paddingHorizontal,
            borderRadius: effectiveRadius,
            backgroundColor: currentVariant.bg,
            borderWidth: variant === 'ghost' ? 0 : 1,
            borderColor: currentVariant.borderColor,
            opacity: disabled ? 0.45 : 1,
            gap: sizeMetrics.gap,
            width: fullWidth ? '100%' : (size === 'icon' ? sizeMetrics.width : undefined),
            ...(size === 'icon' ? { justifyContent: 'center' } : {}),
            ...(Platform.OS === 'web'
              ? ({
                  boxShadow: currentVariant.webBoxShadow,
                  WebkitBoxShadow: currentVariant.webBoxShadow,
                  backdropFilter: 'blur(24px) saturate(190%)',
                  WebkitBackdropFilter: 'blur(24px) saturate(190%)',
                  transition: 'all 200ms cubic-bezier(0.16, 1, 0.3, 1)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  transform: hovered && !disabled ? 'translateY(-1px)' : 'translateY(0)',
                } as any)
              : {}),
          },
          style,
        ]}
      >
        {/* Seamless Fluid Convex Liquid Lens Sheen Overlay */}
        {variant !== 'ghost' && (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id={`${buttonId}_sheen`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={currentVariant.liquidGlossTop} />
                  <Stop offset="36%" stopColor="#FFFFFF" stopOpacity={currentVariant.liquidGlossTop * 0.28} />
                  <Stop offset="55%" stopColor="#FFFFFF" stopOpacity={0} />
                  <Stop offset="85%" stopColor="#FFFFFF" stopOpacity={currentVariant.liquidGlossTop * 0.08} />
                  <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={currentVariant.liquidGlossTop * 0.20} />
                </LinearGradient>
              </Defs>

              {/* Surface Glass Curvature Lens Body */}
              <Rect
                x="0"
                y="0"
                width="100%"
                height="100%"
                rx={effectiveRadius}
                ry={effectiveRadius}
                fill={`url(#${buttonId}_sheen)`}
              />
            </Svg>
          </View>
        )}

        {loading && (
          <ActivityIndicator size="small" color={currentVariant.textColor} style={{ marginRight: title ? 6 : 0 }} />
        )}

        {icon && iconPosition === 'left' && !loading && (
          <Icon name={icon as any} size={effectiveIconSize} color={effectiveIconColor} />
        )}

        {title && (
          <Text
            style={[
              styles.buttonText,
              {
                fontSize: sizeMetrics.fontSize,
                color: currentVariant.textColor,
              },
              textStyle,
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
        )}

        {children}

        {icon && iconPosition === 'right' && !loading && (
          <Icon name={icon as any} size={effectiveIconSize} color={effectiveIconColor} />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
};

// Aliases for compatibility
export const Button = GlassButton;
export const LiquidButton = GlassButton;
export const MetalButton = GlassButton;

const styles = StyleSheet.create({
  wrapper: {
    alignSelf: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  buttonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  buttonText: {
    fontWeight: '700',
    letterSpacing: 0.25,
  },
});

export default GlassButton;
