/**
 * Jest configuration for SpotiBase mobile (Expo SDK 57 / RN 0.86).
 * Uses jest-expo preset; the allowlist in transformIgnorePatterns is the
 * documented Expo pattern extended for the native modules used by this app
 * (react-native-track-player, react-native-mmkv, reanimated/worklets, etc.).
 */
module.exports = {
  preset: 'jest-expo',

  // Files that must be transpiled even though they live in node_modules.
  transformIgnorePatterns: [
    // Prefix-based allowlist (mirrors jest-expo preset, extended for the
    // native modules used by this app). A prefix match covers any sub-package
    // such as expo-modules-core, @react-native-community/*, react-native-mmkv...
    '/node_modules/(?!((jest-)?react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|react-native-svg|react-native-reanimated|react-native-worklets|react-native-mmkv|react-native-track-player|react-native-gesture-handler|react-native-safe-area-context|react-native-screens|react-native-vector-icons|react-native-pager-view|react-native-nitro-modules|@tanstack|zustand))',
    // Never transform the reanimated babel plugin or the RN babel preset.
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],

  // Global setup: applied after the test framework is installed.
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Static asset imports -> stub module.
  moduleNameMapper: {
    '\\.(png|jpg|jpeg|gif|webp|svg|mp4|ttf|otf)$': '<rootDir>/__mocks__/fileMock.js',
  },

  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // Tests must not hit the network; force the node environment.
  testEnvironment: 'node',

  // Do not collect coverage from mocks/fixtures.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/test/**',
  ],
};
