/**
 * Jest setup file (runs after jest-expo's own setup).
 * - Provides a defensive Reanimated mock (nothing under test imports it today,
 *   but screens/stores may pull it in later).
 * - Reanimated v4 ships its own mock, which also covers react-native-worklets
 *   requirements for jest.
 */
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// RN's Animated.loop/timing would keep JS timers alive and fire state updates
// after test teardown (act warnings, "import after teardown" failures).
// Replace the animation primitives with inert no-ops for the test environment.
const { Animated } = require('react-native');
jest.spyOn(Animated, 'loop').mockImplementation(() => ({ start: () => {}, stop: () => {} }));
jest.spyOn(Animated, 'sequence').mockImplementation((animations) => animations[0]);
jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: () => {}, stop: () => {} }));

// Silence noisy RN warnings that are expected in a jsdom-less test env but
// don't indicate a failure. Kept opt-in per-file via console spies where needed.
