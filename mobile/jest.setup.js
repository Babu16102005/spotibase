globalThis._WORKLETS_BUNDLE_MODE_ENABLED = false;
globalThis.__workletsModuleProxy = new Proxy(
  {
    loadUnpackers: jest.fn(),
    createSerializableNull: jest.fn(() => ({})),
    createSerializableUndefined: jest.fn(() => ({})),
    createSerializableBoolean: jest.fn(() => ({})),
    createSerializableString: jest.fn(() => ({})),
    createSerializableNumber: jest.fn(() => ({})),
    createSerializableObject: jest.fn(() => ({})),
    createSerializableArray: jest.fn(() => ({})),
    createSerializableWorklet: jest.fn(() => ({})),
    createCustomSerializable: jest.fn(() => ({})),
    registerCustomSerializable: jest.fn(),
  },
  {
    get(target, prop) {
      if (prop in target) return target[prop];
      target[prop] = jest.fn(() => ({}));
      return target[prop];
    },
  }
);

if (typeof Function.prototype.resolveWeak !== 'function') {
  Function.prototype.resolveWeak = (id) => id;
}

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef((props, ref) => React.createElement(View, { ...props, ref })),
  };
});

// RN's Animated.loop/timing would keep JS timers alive and fire state updates
// after test teardown (act warnings, "import after teardown" failures).
// Replace the animation primitives with inert no-ops for the test environment.
const { Animated } = require('react-native');
jest.spyOn(Animated, 'loop').mockImplementation(() => ({ start: () => {}, stop: () => {} }));
jest.spyOn(Animated, 'sequence').mockImplementation((animations) => animations[0]);
jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: () => {}, stop: () => {} }));

// Silence noisy RN warnings that are expected in a jsdom-less test env but
// don't indicate a failure. Kept opt-in per-file via console spies where needed.
