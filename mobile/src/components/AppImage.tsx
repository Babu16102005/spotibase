/**
 * AppImage — Expo Go / jest-safe image with an expo-image fast path.
 *
 * Per https://docs.expo.dev/versions/v57.0.0/sdk/image/ (SDK 57, RN 0.86):
 * install with `npx expo install expo-image` (never pin manually). When the
 * package is present this wrapper renders expo-image with
 * `cachePolicy="memory-disk"` + `recyclingKey` (prevents recycled rows from
 * flashing the previous cover in virtualized lists); when it is absent
 * (Expo Go without the native module, jest, web fallback) it renders RN
 * Image with identical props. Call sites never branch.
 *
 * Sizing contract: list thumbs via coverSource(url, 200), detail art via
 * coverSource(url, 800) — the CDN serves a small cached variant instead of
 * the full-size original.
 */
import React from 'react';
import { Image as RNImage, StyleProp, ImageStyle } from 'react-native';
import { PLACEHOLDER_IMAGE } from '../utils';

// Optional peer: resolved at runtime so the bundle/test env never hard-fails
// when expo-image is not installed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
let ExpoImageComp: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('expo-image');
  ExpoImageComp = mod?.Image ?? mod?.default ?? null;
} catch {
  ExpoImageComp = null;
}

/** `true` when the expo-image fast path is active (native module present). */
export const isExpoImageAvailable = (): boolean => ExpoImageComp != null;

export type AppImageSource = number | { uri: string } | undefined;

interface AppImageProps {
  source: AppImageSource;
  style?: StyleProp<ImageStyle>;
  /** Stable id (song/album/artist/playlist id): expo-image recyclingKey. */
  recyclingKey?: string;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  cachePolicy?: 'none' | 'disk' | 'memory' | 'memory-disk';
  transition?: number;
  accessibilityLabel?: string;
  testID?: string;
}

const AppImage: React.FC<AppImageProps> = ({
  source,
  style,
  recyclingKey,
  contentFit = 'cover',
  cachePolicy = 'memory-disk',
  transition = 200,
  accessibilityLabel,
  testID,
}) => {
  if (ExpoImageComp) {
    return (
      <ExpoImageComp
        source={source}
        style={style}
        contentFit={contentFit}
        cachePolicy={cachePolicy}
        recyclingKey={recyclingKey ?? null}
        transition={transition}
        placeholder={PLACEHOLDER_IMAGE}
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      />
    );
  }
  return (
    <RNImage
      source={source ?? PLACEHOLDER_IMAGE}
      defaultSource={PLACEHOLDER_IMAGE}
      style={style as any}
      resizeMode={contentFit === 'contain' ? 'contain' : 'cover'}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  );
};

export default React.memo(AppImage);
