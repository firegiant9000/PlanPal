// Monorepo-aware Metro config (Expo + pnpm workspace).
// Watches the repo root so changes in packages/* hot-reload, and resolves
// modules from both the app and the hoisted root node_modules.
// See https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// `@planpal/recurrence` is authored for NodeNext: its internal imports carry a
// `.js` extension that TypeScript maps back to the `.ts` source. Metro does no
// such mapping and fails with "Unable to resolve module ./expand.js". Strip the
// extension for relative specifiers originating inside that package, so mobile
// can consume the same `buildRRule` the Edge Functions and web do (T28, AD-3).
//
// Scoped to that one directory deliberately — a blanket rule would also rewrite
// legitimate `.js` imports elsewhere in the tree.
const recurrenceSrc = path.resolve(workspaceRoot, 'packages', 'recurrence', 'src');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isInternalEsmSpecifier =
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    typeof context.originModulePath === 'string' &&
    context.originModulePath.startsWith(recurrenceSrc);

  return context.resolveRequest(
    context,
    isInternalEsmSpecifier ? moduleName.slice(0, -'.js'.length) : moduleName,
    platform,
  );
};

module.exports = config;
