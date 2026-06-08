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
  ],
};

export default nextConfig;
