import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    transpilePackages: ['@copilotkit/outpost'],
    webpack: (config, { isServer }) => {
        if (isServer) {
            // Platform SDK packages are only used by bot services, not the web app,
            // but get pulled in transitively via the queue/shared barrel exports.
            // Replace with empty modules so webpack doesn't try to require them.
            const nullPkgs = [
                'discord.js', '@discordjs/rest', '@discordjs/ws', '@discordjs/collection',
                'zlib-sync', 'bufferutil', 'utf-8-validate',
                '@slack/web-api', '@slack/bolt',
                'postmark', 'nodemailer',
            ];
            for (const pkg of nullPkgs) {
                config.resolve.alias[pkg] = false;
            }
        }
        return config;
    },
};

export default nextConfig;
