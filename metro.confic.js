const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add svg extension to asset extensions
config.resolver.assetExts.push('svg');

// Configure transformer for SVG files
config.transformer.babelTransformerPath = require.resolve('react-native-svg-transformer');

// Exclude svg from source extensions and add it to asset extensions
config.resolver.sourceExts = config.resolver.sourceExts.filter(ext => ext !== 'svg');

module.exports = config;