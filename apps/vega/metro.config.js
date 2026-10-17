const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('path');

const nodeModules = path.resolve(__dirname, 'node_modules');

// Libraries that have Vega ports under @amazon-devices. Shared code imports the usual names.
const amazonPorts = {
  '@react-navigation/native': '@amazon-devices/react-navigation__native',
  '@react-navigation/native-stack':
    '@amazon-devices/react-navigation__native-stack',
  '@react-navigation/core': '@amazon-devices/react-navigation__core',
  '@react-navigation/routers': '@amazon-devices/react-navigation__routers',
  '@react-navigation/elements': '@amazon-devices/react-navigation__elements',
  'react-native-gesture-handler':
    '@amazon-devices/react-native-gesture-handler',
  'react-native-reanimated': '@amazon-devices/react-native-reanimated',
  'react-native-safe-area-context':
    '@amazon-devices/react-native-safe-area-context',
  'react-native-screens': '@amazon-devices/react-native-screens',
  'react-native-svg': '@amazon-devices/react-native-svg',
  'react-native-qrcode-svg': '@amazon-devices/react-native-qrcode-svg',
  '@react-native-async-storage/async-storage':
    '@amazon-devices/react-native-async-storage__async-storage',
};

const extraNodeModules = {
  react: path.join(nodeModules, 'react'),
  'react-native': path.join(nodeModules, 'react-native'),
  '@babel/runtime': path.join(nodeModules, '@babel/runtime'),
};
Object.keys(amazonPorts).forEach((name) => {
  extraNodeModules[name] = path.join(nodeModules, amazonPorts[name]);
});

const escape = (p) => p.replace(/[/\\]/g, '[/\\\\]');
const blockedFromParent = [
  '@react-navigation',
  'react-native-gesture-handler',
  'react-native-reanimated',
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-svg',
].map(
  (name) =>
    new RegExp(escape(path.resolve(__dirname, '..', 'node_modules', name))),
);

// The IAP library depends on the community async storage package; send everyone to the Vega port.
blockedFromParent.push(new RegExp(escape(path.join(nodeModules, '@react-native-async-storage'))));

const config = {
  watchFolders: [
    path.resolve(__dirname, '../../packages/shared-ui'),
    path.resolve(__dirname, '../../packages/contracts'),
  ],
  resolver: {
    unstable_enableSymlinks: true,
    sourceExts: [
      'vega.tsx',
      'vega.ts',
      'vega.js',
      'tsx',
      'ts',
      'jsx',
      'js',
      'cjs',
      'json',
    ],
    nodeModulesPaths: [
      nodeModules,
      path.resolve(__dirname, '../../node_modules'),
    ],
    extraNodeModules,
    resolverMainFields: ['react-native', 'browser', 'main'],
    platforms: ['native', 'ios', 'android', 'tv'],
    blockList: blockedFromParent,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
