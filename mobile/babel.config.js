/**
 * Babel configuration for SpotiBase mobile (Expo SDK 57 / RN 0.86).
 * babel-preset-expo automatically adds the react-native-worklets babel
 * plugin when react-native-worklets / react-native-reanimated is installed.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
