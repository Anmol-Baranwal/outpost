import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    transpilePackages: ['@copilotkit/outpost'],
    serverExternalPackages: ['discord.js', '@discordjs/rest', 'zlib-sync'],
};

export default nextConfig;
