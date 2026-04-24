import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    transpilePackages: ['@copilotkit/outpost'],
    serverExternalPackages: [
        'discord.js',
        '@discordjs/rest',
        '@discordjs/ws',
        '@discordjs/collection',
        'zlib-sync',
        'bufferutil',
        'utf-8-validate',
        '@slack/web-api',
        '@slack/bolt',
        'postmark',
        'nodemailer',
    ],
};

export default nextConfig;
