import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    transpilePackages: ['@copilotkit/outpost'],
    serverExternalPackages: ['discord.js', '@discordjs/rest', 'zlib-sync'],
    webpack: (config, { isServer }) => {
        if (isServer) {
            config.externals = config.externals || [];
            config.externals.push({
                'zlib-sync': 'commonjs zlib-sync',
                'bufferutil': 'commonjs bufferutil',
                'utf-8-validate': 'commonjs utf-8-validate',
                '@discordjs/opus': 'commonjs @discordjs/opus',
                'erlpack': 'commonjs erlpack',
            });
        }
        return config;
    },
};

export default nextConfig;
