const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('mjs', 'cjs');

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

config.resolver.alias = {
  ...config.resolver.alias,
  'react-native$': 'react-native-web',
};

module.exports = config;