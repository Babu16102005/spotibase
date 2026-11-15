/**
 * Babel configuration for SpotiBase mobile (Expo SDK 58 / RN 0.88).
 * babel-preset-expo automatically adds the react-native-worklets babel
 * plugin when react-native-worklets / react-native-reanimated is installed.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
