import type { Config } from 'tailwindcss';

const config: Config = {
    content: [
        './src/app/**/*.{ts,tsx}',
        './src/components/**/*.{ts,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                sidebar: {
                    DEFAULT: 'hsl(220, 20%, 97%)',
                    foreground: 'hsl(220, 15%, 30%)',
                    hover: 'hsl(220, 20%, 93%)',
                    active: 'hsl(220, 40%, 95%)',
                    'active-foreground': 'hsl(220, 60%, 45%)',
                },
            },
        },
    },
    plugins: [require('tailwindcss-animate')],
};

export default config;
