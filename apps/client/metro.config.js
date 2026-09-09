// Expo auto-configures Metro for pnpm monorepos (SDK 52+); only PowerSync-specific tweaks live here.
// See https://docs.powersync.com/client-sdks/frameworks/react-native-web-support
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Expo drops the `react-native` export condition on web. `@powersync/web` ships a build
// for React Native Web under this condition, so add it back for the web platform.
config.resolver.unstable_conditionsByPlatform.web.push('react-native-web');

// Platform-specific PowerSync adapters live in `*.native.ts` / `*.web.ts` files, so the
// other platform's SDK is never imported directly. This guard keeps transitive imports from
// pulling native-only or web-only SDK code into the wrong bundle.
const nativeOnlyModules = new Set(['@powersync/react-native', '@op-engineering/op-sqlite']);
const webOnlyModules = new Set(['@powersync/web']);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const excluded =
    platform === 'web' ? nativeOnlyModules.has(moduleName) : webOnlyModules.has(moduleName);
  if (excluded) {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
