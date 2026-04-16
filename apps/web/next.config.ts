import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    transpilePackages: ['@copilotkit/outpost-db', '@copilotkit/outpost-shared', '@copilotkit/outpost-ai'],
};

export default nextConfig;
