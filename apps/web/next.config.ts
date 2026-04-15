import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    transpilePackages: ['@outpost/db', '@outpost/shared'],
};

export default nextConfig;
