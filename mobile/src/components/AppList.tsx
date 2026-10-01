/**
 * AppList — FlashList fast path with FlatList fallback.
 *
 * Per https://docs.expo.dev/versions/v57.0.0/sdk/flash-list/ (SDK 57):
 * install with `npx expo install @shopify/flash-list` (never pin manually).
 * When installed, lists render with FlashList (recycling, `estimatedItemSize`,
 * `drawDistance`); otherwise the same props render a tuned FlatList
 * (stable keyExtractor, getItemLayout, removeClippedSubviews) so Expo Go,
 * jest and web never break. Call sites never branch.
 */
import React from 'react';
import { FlatList, FlatListProps } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-require-imports
let FlashListComp: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@shopify/flash-list');
  FlashListComp = mod?.FlashList ?? mod?.default ?? null;
} catch {
  FlashListComp = null;
}

/** `true` when the FlashList fast path is active. */
export const isFlashListAvailable = (): boolean => FlashListComp != null;

export interface AppListProps<T> extends FlatListProps<T> {
  /** Required by FlashList; ignored by the FlatList fallback. */
  estimatedItemSize?: number;
  /** Overscan window in pixels; FlashList-only. */
  drawDistance?: number;
}

function AppListInner<T>(props: AppListProps<T>, ref: React.Ref<any>) {
  if (FlashListComp) {
    const { estimatedItemSize = 60, drawDistance = 500, ...rest } = props as any;
    return (
      <FlashListComp
        ref={ref}
        estimatedItemSize={estimatedItemSize}
        drawDistance={drawDistance}
        {...rest}
      />
    );
  }
  // FlatList fallback: strip FlashList-only props React Native would warn on.
  const { estimatedItemSize: _e, drawDistance: _d, ...rest } = props as any;
  void _e;
  void _d;
  return <FlatList ref={ref} {...rest} />;
}

const AppList = React.forwardRef(AppListInner) as <T>(
  props: AppListProps<T> & { ref?: React.Ref<any> }
) => React.ReactElement;

export default React.memo(AppList) as typeof AppList;
