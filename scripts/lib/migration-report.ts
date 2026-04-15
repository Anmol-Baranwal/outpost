// ─── Migration Report ───────────────────────────────────────────────────────
// Tracks and summarizes migration results.

export interface EntityStats {
    created: number;
    skipped: number;
    failed: number;
    errors: Array<{ id: string; message: string }>;
}

export interface MigrationReport {
    accounts: EntityStats;
    users: EntityStats;
    tickets: EntityStats;
    messages: { total: number };
    startedAt: Date;
    completedAt: Date | null;
    durationMs: number | null;
    dryRun: boolean;
}

export function createReport(dryRun: boolean): MigrationReport {
    return {
        accounts: { created: 0, skipped: 0, failed: 0, errors: [] },
        users: { created: 0, skipped: 0, failed: 0, errors: [] },
        tickets: { created: 0, skipped: 0, failed: 0, errors: [] },
        messages: { total: 0 },
        startedAt: new Date(),
        completedAt: null,
        durationMs: null,
        dryRun,
    };
}

export function finalizeReport(report: MigrationReport): MigrationReport {
    report.completedAt = new Date();
    report.durationMs = report.completedAt.getTime() - report.startedAt.getTime();
    return report;
}

export function formatReport(report: MigrationReport): string {
    const lines: string[] = [];
    const divider = '─'.repeat(60);

    lines.push('');
    lines.push(divider);
    lines.push(report.dryRun ? '  MIGRATION DRY RUN REPORT' : '  MIGRATION REPORT');
    lines.push(divider);
    lines.push('');

    lines.push(`  Accounts:  ${report.accounts.created} created, ${report.accounts.skipped} skipped, ${report.accounts.failed} failed`);
    lines.push(`  Users:     ${report.users.created} created, ${report.users.skipped} skipped, ${report.users.failed} failed`);
    lines.push(`  Tickets:   ${report.tickets.created} created, ${report.tickets.skipped} skipped, ${report.tickets.failed} failed`);
    lines.push(`  Messages:  ${report.messages.total} imported`);
    lines.push('');

    if (report.durationMs !== null) {
        const seconds = (report.durationMs / 1000).toFixed(1);
        lines.push(`  Duration:  ${seconds}s`);
        lines.push('');
    }

    const allErrors = [
        ...report.accounts.errors.map(e => `  [account ${e.id}] ${e.message}`),
        ...report.users.errors.map(e => `  [user ${e.id}] ${e.message}`),
        ...report.tickets.errors.map(e => `  [ticket ${e.id}] ${e.message}`),
    ];

    if (allErrors.length > 0) {
        lines.push('  ERRORS:');
        for (const err of allErrors) {
            lines.push(err);
        }
        lines.push('');
    }

    lines.push(divider);
    lines.push('');

    return lines.join('\n');
}
