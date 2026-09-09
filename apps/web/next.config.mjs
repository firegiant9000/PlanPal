/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship raw TS/ESM — let Next transpile them rather than
  // requiring each to pre-build a dist/.
  transpilePackages: [
    '@planpal/ui',
    '@planpal/design-tokens',
    '@planpal/types',
    '@planpal/analytics',
    '@planpal/calendar-core',
    '@planpal/api-client',
    '@planpal/recurrence',
  ],
  webpack: (config) => {
    // `@planpal/recurrence` is authored for NodeNext, so its internal imports
    // carry a `.js` extension that TypeScript maps back to the `.ts` source.
    // webpack does not do that mapping and fails with
    // "Can't resolve './timezone.js'". `extensionAlias` tells it to try `.ts`
    // first and fall back to a real `.js`, so genuine JavaScript still resolves.
    //
    // The mobile app needs the same thing for Metro — see
    // apps/mobile/metro.config.js. Both exist because the package is consumed
    // as source rather than as a built dist/.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
