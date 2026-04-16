import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    transpilePackages: ['@copilotkit/outpost'],
};

export default nextConfig;
