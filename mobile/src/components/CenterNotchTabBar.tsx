import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Svg, { Path } from 'react-native-svg';
import { usePlayerStore, useThemeStore } from '../store';
import Icon from './Icon';

type Props = BottomTabBarProps & {
  icons: Partial<Record<string, React.ComponentProps<typeof Icon>['name']>>;
};

// Subtle center scoop for the floating AI orb:
// Songs nudged left, Library nudged right, orb half-docks into the curve.
const BAR_HEIGHT = 68;
// Concentric circular cradle: same center as the 58px orb, radius matched + GAP,
// so daylight between orb edge and bar is equal all around the lower half.
const ORB_RADIUS = 29;
const CRADLE_GAP = 8;
const EDGE_TOP = 10;
const SHOULDER_RADIUS = 10; // Smooth blend radius on left & right rims to eliminate sharp circle cutting

const CenterNotchTabBar: React.FC<Props> = ({ state, navigation, icons }) => {
  const { theme } = useThemeStore();
  const { width: W } = useWindowDimensions();
  const cx = W / 2;
  // When the MiniPlayer is up it spans the full width - a scooped top edge would
  // leave a notch-shaped gap of background between player and bar, so go flat.
  const miniPlayerUp = usePlayerStore((s) => s.isMiniPlayerVisible);

  // Smooth cradle with tangent shoulder fillets:
  // 1. Left flat bar smoothly rounds down via a shoulder arc (radius r)
  // 2. Concentric circular cradle hugs the orb with equal circular gap (radius R)
  // 3. Right shoulder arc (radius r) smoothly rounds up and blends into the flat bar
  const R = ORB_RADIUS + CRADLE_GAP;
  const r = SHOULDER_RADIUS;
  const ORB_CY = EDGE_TOP + (Platform.OS === 'web' ? 10 : 16);

  const sy = EDGE_TOP + r;
  const dy = ORB_CY - sy;
  const dist = R + r;
  const dx = Math.sqrt(Math.max(dist * dist - dy * dy, 1));

  const leftTopX = cx - dx;
  const rightTopX = cx + dx;
  const t = r / dist;
  const leftContactX = cx - dx + dx * t;
  const leftContactY = sy + dy * t;
  const rightContactX = cx + dx - dx * t;
  const rightContactY = leftContactY;

  const scoop = !miniPlayerUp
    ? [
        `L ${leftTopX} ${EDGE_TOP}`,
        `A ${r} ${r} 0 0 1 ${leftContactX} ${leftContactY}`,
        `A ${R} ${R} 0 1 0 ${rightContactX} ${rightContactY}`,
        `A ${r} ${r} 0 0 1 ${rightTopX} ${EDGE_TOP}`,
      ]
    : [];
  const bgPath = [
    `M 0 ${BAR_HEIGHT}`,
    `L 0 ${EDGE_TOP + 8}`,
    `Q 0 ${EDGE_TOP} 8 ${EDGE_TOP}`,
    ...scoop,
    `L ${W - 8} ${EDGE_TOP}`,
    `Q ${W} ${EDGE_TOP} ${W} ${EDGE_TOP + 8}`,
    `L ${W} ${BAR_HEIGHT}`,
    'Z',
  ].join(' ');

  // Hairline follows the same curve.
  const edgePath = [
    `M 8 ${EDGE_TOP}`,
    ...scoop,
    `L ${W - 8} ${EDGE_TOP}`,
  ].join(' ');

  const renderSlot = (routeName: string, index: number, extraStyle?: object) => {
    const route = state.routes[index];
    const focused = state.index === index;
    const color = focused ? theme.colors.primary : theme.colors.textSecondary;
    return (
      <TouchableOpacity
        key={route.key}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        onPress={() => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        }}
        style={[styles.slot, extraStyle]}
        activeOpacity={0.7}
      >
        <Icon name={icons[routeName] || 'music'} size={22} color={color} />
        <Text style={[styles.label, { color }]}>{routeName}</Text>
      </TouchableOpacity>
    );
  };

  // Route order is Home, Songs, Library, Profile - spacer goes between Songs and Library.
  return (
    <View style={styles.wrap}>
      <Svg
        width={W}
        height={BAR_HEIGHT}
        viewBox={`0 0 ${W} ${BAR_HEIGHT}`}
        style={StyleSheet.absoluteFill}
      >
        <Path d={bgPath} fill={theme.colors.tabBar} />
        <Path
          d={edgePath}
          fill="none"
          stroke={theme.colors.border}
          strokeWidth={0.5}
        />
      </Svg>
      <View style={styles.row}>
        {renderSlot('Home', 0)}
        {renderSlot('Songs', 1, styles.nudgeLeft)}
        <View style={styles.spacer} pointerEvents="none" />
        {renderSlot('Library', 2, styles.nudgeRight)}
        {renderSlot('Profile', 3)}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    height: BAR_HEIGHT,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingTop: EDGE_TOP,
  },
  slot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingBottom: 8,
  },
  // Push the two middle tabs outward so the orb + label clear them.
  nudgeLeft: { marginRight: 12 },
  nudgeRight: { marginLeft: 12 },
  spacer: { flex: 1 },
  label: { fontSize: 10, fontWeight: '700' },
});

export default CenterNotchTabBar;
