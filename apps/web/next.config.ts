import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    output: 'standalone',
    transpilePackages: ['@copilotkit/outpost'],
    webpack: (config, { isServer }) => {
        if (isServer) {
            // Platform SDK packages have native/optional deps that webpack can't resolve.
            // These are only used by bot services, not the web app, but get pulled in
            // transitively via the shared package barrel export.
            const externalPkgs = [
                'discord.js', '@discordjs/rest', '@discordjs/ws', '@discordjs/collection',
                'zlib-sync', 'bufferutil', 'utf-8-validate',
                '@slack/web-api', '@slack/bolt',
                'postmark', 'nodemailer',
            ];
            config.externals = [
                ...(Array.isArray(config.externals) ? config.externals : config.externals ? [config.externals] : []),
                ({ request }: { request?: string }, callback: (err?: null, result?: string) => void) => {
                    if (request && externalPkgs.some(pkg => request === pkg || request.startsWith(pkg + '/'))) {
                        return callback(null, `commonjs ${request}`);
                    }
                    callback();
                },
            ];
        }
        return config;
    },
};

export default nextConfig;
