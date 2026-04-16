import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    transpilePackages: ['@outpost/db', '@outpost/shared', '@outpost/ai'],
};

export default nextConfig;
