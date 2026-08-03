/**
 * Month-window math for dashboard date filtering.
 *
 * All windows are built in LOCAL time to match how ticket createdAt values
 * are bucketed elsewhere in the dashboard. Mixing local and UTC here would
 * shift counts across month boundaries by the server's UTC offset.
 */

/** A month identifier in `YYYY-MM` form. */
export type MonthKey = string;

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/** Format a date as its `YYYY-MM` key. */
export function currentMonthKey(now: Date = new Date()): MonthKey {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** True when the value is a syntactically valid `YYYY-MM` key. */
export function isValidMonthKey(raw: unknown): boolean {
    return typeof raw === 'string' && MONTH_KEY_PATTERN.test(raw);
}

/** Split a valid key into its numeric year and zero-based month. */
function parts(key: MonthKey): { year: number; monthIndex: number } {
    const [year, month] = key.split('-');
    return { year: Number(year), monthIndex: Number(month) - 1 };
}

/**
 * The inclusive start/end instants of a month, plus its length.
 *
 * `end` is the last millisecond of the month, so it pairs with Prisma's
 * `lte` without excluding tickets created late on the final day.
 */
export function monthWindow(key: MonthKey): {
    start: Date;
    end: Date;
    daysInMonth: number;
} {
    const { year, monthIndex } = parts(key);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    return {
        start: new Date(year, monthIndex, 1, 0, 0, 0, 0),
        end: new Date(year, monthIndex, daysInMonth, 23, 59, 59, 999),
        daysInMonth,
    };
}

/** Human label for a month key, e.g. `"July 2026"`. */
export function monthLabel(key: MonthKey): string {
    const { year, monthIndex } = parts(key);
    return `${MONTH_NAMES[monthIndex]} ${year}`;
}

/**
 * Every month from `oldest` through `now`, ascending and gap-free.
 *
 * With no oldest date (no tickets yet) the only selectable month is the
 * current one.
 */
export function listMonths(oldest: Date | null, now: Date = new Date()): MonthKey[] {
    const current = currentMonthKey(now);
    if (!oldest) return [current];

    const months: MonthKey[] = [];
    const cursor = new Date(oldest.getFullYear(), oldest.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 1);

    while (cursor <= last) {
        months.push(currentMonthKey(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
}

/**
 * Resolve a raw `month` query param to a month we can actually render.
 *
 * Anything malformed, out of range, or absent yields the current month —
 * a bad query param must not blank the dashboard.
 */
export function resolveMonthKey(
    raw: string | null,
    oldest: Date | null,
    now: Date = new Date(),
): MonthKey {
    const current = currentMonthKey(now);
    if (!isValidMonthKey(raw)) return current;
    return listMonths(oldest, now).includes(raw as MonthKey) ? (raw as MonthKey) : current;
}
