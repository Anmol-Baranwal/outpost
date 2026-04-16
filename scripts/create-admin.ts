import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@copilotkit/outpost/shared';
import * as readline from 'readline';

interface AdminArgs {
    email: string;
    name: string;
    password: string;
}

function parseArgs(): Partial<AdminArgs> {
    const args = process.argv.slice(2);
    const result: Partial<AdminArgs> = {};

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--email' && args[i + 1]) {
            result.email = args[++i];
        } else if (args[i] === '--name' && args[i + 1]) {
            result.name = args[++i];
        } else if (args[i] === '--password' && args[i + 1]) {
            result.password = args[++i];
        }
    }

    return result;
}

function prompt(question: string, hidden = false): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        if (hidden) {
            // For password input, mute output
            process.stdout.write(question);
            const stdin = process.stdin;
            const wasRaw = stdin.isRaw;
            if (stdin.isTTY) stdin.setRawMode(true);

            let input = '';
            const onData = (char: Buffer) => {
                const c = char.toString();
                if (c === '\n' || c === '\r') {
                    stdin.removeListener('data', onData);
                    if (stdin.isTTY && wasRaw !== undefined) stdin.setRawMode(wasRaw);
                    process.stdout.write('\n');
                    rl.close();
                    resolve(input);
                } else if (c === '\u0003') {
                    // Ctrl+C
                    process.exit(1);
                } else if (c === '\u007f') {
                    // Backspace
                    input = input.slice(0, -1);
                } else {
                    input += c;
                }
            };
            stdin.on('data', onData);
        } else {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
        }
    });
}

export async function createAdmin(args: AdminArgs, prismaOverride?: unknown): Promise<void> {
    const prisma = (prismaOverride ?? new PrismaClient()) as PrismaClient;

    try {
        // Validate
        if (!args.name || args.name.trim().length === 0) {
            throw new Error('Name is required.');
        }
        if (!args.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email)) {
            throw new Error('A valid email is required.');
        }
        if (!args.password || args.password.length < 8) {
            throw new Error('Password must be at least 8 characters.');
        }

        const passwordHash = await hashPassword(args.password);

        const member = await prisma.teamMember.create({
            data: {
                name: args.name.trim(),
                email: args.email.trim().toLowerCase(),
                passwordHash,
                role: 'ADMIN',
            },
        });

        console.log(`Admin account created successfully.`);
        console.log(`  ID:    ${member.id}`);
        console.log(`  Name:  ${member.name}`);
        console.log(`  Email: ${member.email}`);
        console.log(`  Role:  ${member.role}`);
    } finally {
        if (!prismaOverride) {
            await prisma.$disconnect();
        }
    }
}

async function main() {
    const parsed = parseArgs();

    const name = parsed.name || (await prompt('Name: '));
    const email = parsed.email || (await prompt('Email: '));
    const password = parsed.password || (await prompt('Password: ', true));

    await createAdmin({ name, email, password });
}

// Only run main when executed directly (not imported)
const isDirectRun = process.argv[1] && (
    process.argv[1].endsWith('create-admin.ts') ||
    process.argv[1].endsWith('create-admin.js')
);

if (isDirectRun) {
    main().catch((err) => {
        console.error('Error:', err.message);
        process.exit(1);
    });
}
