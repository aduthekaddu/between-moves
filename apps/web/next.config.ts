import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // TypeScript 6 provides the compiler API; avoid Next 16's empty CLI-output capture.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
