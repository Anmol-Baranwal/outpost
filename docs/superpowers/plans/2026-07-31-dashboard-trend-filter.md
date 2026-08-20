# Tickets Trend Month Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator pick which month the Tickets Trend chart shows, and make its "total tickets" figure describe that same month.

**Architecture:** A pure date-window helper module holds all month math and validation so it can be unit-tested without Prisma or Next. `GET /api/dashboard/stats` accepts `?month=YYYY-MM`, derives its window from that helper, and returns the list of selectable months alongside the trend. The dashboard page owns the selected month as state and refetches on change; `TicketsTrend` renders a `<select>` and reports changes upward.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma, Vitest, Recharts.

This is PR 1 of three from `docs/superpowers/specs/2026-07-31-dashboard-usability-design.md`. Branch: `feat/dashboard-trend-filter` (already created off `main`; the spec commit 6f2df1a is on it).

## Global Constraints

- Invalid, malformed, or out-of-range `month` values fall back to the current month. A bad query param must never blank the dashboard or return an error status.
- `slaBreaches` stays in the stats response. It is removed in PR 2 along with the card that reads it — removing it here breaks a card still on screen.
- `totalTickets` changes meaning to the **selected month's** count. The all-time count is dropped; no other consumer exists (verified: only `apps/web/src/app/dashboard/page.tsx` reads it).
- Month math uses **local time**, matching the existing route (`new Date(year, month, 1)`), not UTC. Mixing the two shifts ticket counts across month boundaries by the UTC offset.
- Verification runs against the prod-data clone on `localhost:5433`, where June 2026 holds 4 tickets and July 2026 holds 47.
- Every code change ships with a test. No exceptions.

---

## File Structure

- **Create** `apps/web/src/lib/month-window.ts` — all month-key parsing, window construction, labelling, and month listing. Pure functions, no I/O, no Prisma import.
- **Create** `apps/web/src/__tests__/month-window.test.ts` — unit tests for the above.
- **Modify** `apps/web/src/app/api/dashboard/stats/route.ts` — accept `request`, read `month`, use the helper, add `availableMonths`, scope `totalTickets` to the window.
- **Modify** `apps/web/src/__tests__/dashboard-api.test.ts` — existing stats tests call `statsGet()` with no argument and will break on the new signature; they need a `Request` and a `findFirst` mock.
- **Modify** `apps/web/src/components/dashboard/tickets-trend.tsx` — month `<select>` in the header.
- **Modify** `apps/web/src/app/dashboard/page.tsx` — own the selected month, refetch on change.

---

### Task 1: Month-window helper

**Files:**
- Create: `apps/web/src/lib/month-window.ts`
- Test: `apps/web/src/__tests__/month-window.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, relied on by Tasks 2 and 3:
  - `type MonthKey = string` — always `YYYY-MM`.
  - `currentMonthKey(now?: Date): MonthKey`
  - `isValidMonthKey(raw: unknown): boolean`
  - `monthWindow(key: MonthKey): { start: Date; end: Date; daysInMonth: number }`
  - `monthLabel(key: MonthKey): string` — `"2026-07"` → `"July 2026"`.
  - `listMonths(oldest: Date | null, now?: Date): MonthKey[]` — ascending, oldest first; `[currentMonthKey(now)]` when `oldest` is null.
  - `resolveMonthKey(raw: string | null, oldest: Date | null, now?: Date): MonthKey` — the single entry point routes use: returns `raw` when it is a valid key within `listMonths(oldest, now)`, else `currentMonthKey(now)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/__tests__/month-window.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
    currentMonthKey,
    isValidMonthKey,
    monthWindow,
    monthLabel,
    listMonths,
    resolveMonthKey,
} from '@/lib/month-window';

describe('month-window', () => {
    describe('currentMonthKey', () => {
        it('formats the given date as YYYY-MM', () => {
            expect(currentMonthKey(new Date(2026, 6, 31))).toBe('2026-07');
        });

        it('zero-pads single-digit months', () => {
            expect(currentMonthKey(new Date(2026, 0, 5))).toBe('2026-01');
        });
    });

    describe('isValidMonthKey', () => {
        it('accepts a well-formed key', () => {
            expect(isValidMonthKey('2026-07')).toBe(true);
        });

        it('rejects month 00 and month 13', () => {
            expect(isValidMonthKey('2026-00')).toBe(false);
            expect(isValidMonthKey('2026-13')).toBe(false);
        });

        it('rejects garbage, wrong shapes, and non-strings', () => {
            expect(isValidMonthKey('garbage')).toBe(false);
            expect(isValidMonthKey('2026-7')).toBe(false);
            expect(isValidMonthKey('26-07')).toBe(false);
            expect(isValidMonthKey('2026-07-01')).toBe(false);
            expect(isValidMonthKey('')).toBe(false);
            expect(isValidMonthKey(null)).toBe(false);
            expect(isValidMonthKey(7)).toBe(false);
        });
    });

    describe('monthWindow', () => {
        it('spans the first millisecond to the last of the month', () => {
            const { start, end } = monthWindow('2026-07');
            expect(start.getTime()).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime());
            expect(end.getTime()).toBe(new Date(2026, 6, 31, 23, 59, 59, 999).getTime());
        });

        it('reports days in month, including February in a leap year', () => {
            expect(monthWindow('2026-07').daysInMonth).toBe(31);
            expect(monthWindow('2026-06').daysInMonth).toBe(30);
            expect(monthWindow('2026-02').daysInMonth).toBe(28);
            expect(monthWindow('2024-02').daysInMonth).toBe(29);
        });

        it('handles December without rolling into the wrong year', () => {
            const { start, end, daysInMonth } = monthWindow('2026-12');
            expect(start.getFullYear()).toBe(2026);
            expect(start.getMonth()).toBe(11);
            expect(end.getFullYear()).toBe(2026);
            expect(end.getMonth()).toBe(11);
            expect(end.getDate()).toBe(31);
            expect(daysInMonth).toBe(31);
        });
    });

    describe('monthLabel', () => {
        it('renders month name and year', () => {
            expect(monthLabel('2026-07')).toBe('July 2026');
            expect(monthLabel('2026-01')).toBe('January 2026');
        });
    });

    describe('listMonths', () => {
        it('spans oldest through now, ascending, with no gaps', () => {
            const months = listMonths(new Date(2026, 4, 20), new Date(2026, 6, 31));
            expect(months).toEqual(['2026-05', '2026-06', '2026-07']);
        });

        it('crosses a year boundary', () => {
            const months = listMonths(new Date(2025, 10, 2), new Date(2026, 1, 15));
            expect(months).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
        });

        it('returns just the current month when oldest is in it', () => {
            expect(listMonths(new Date(2026, 6, 1), new Date(2026, 6, 31))).toEqual(['2026-07']);
        });

        it('returns just the current month when there is no oldest ticket', () => {
            expect(listMonths(null, new Date(2026, 6, 31))).toEqual(['2026-07']);
        });
    });

    describe('resolveMonthKey', () => {
        const oldest = new Date(2026, 5, 4);
        const now = new Date(2026, 6, 31);

        it('accepts a valid in-range key', () => {
            expect(resolveMonthKey('2026-06', oldest, now)).toBe('2026-06');
        });

        it('falls back to the current month for a malformed key', () => {
            expect(resolveMonthKey('garbage', oldest, now)).toBe('2026-07');
            expect(resolveMonthKey('2026-13', oldest, now)).toBe('2026-07');
        });

        it('falls back to the current month when no key is given', () => {
            expect(resolveMonthKey(null, oldest, now)).toBe('2026-07');
        });

        it('falls back for a month before the first ticket', () => {
            expect(resolveMonthKey('2026-01', oldest, now)).toBe('2026-07');
        });

        it('falls back for a future month', () => {
            expect(resolveMonthKey('2026-09', oldest, now)).toBe('2026-07');
        });
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @copilotkit/outpost-web exec vitest run src/__tests__/month-window.test.ts`

Expected: FAIL — cannot resolve `@/lib/month-window`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/month-window.ts`:

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @copilotkit/outpost-web exec vitest run src/__tests__/month-window.test.ts`

Expected: PASS — all six describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/month-window.ts apps/web/src/__tests__/month-window.test.ts
git commit -m "feat(web): month-window helper for dashboard date filtering"
```

---

### Task 2: Stats route accepts ?month=YYYY-MM

**Files:**
- Modify: `apps/web/src/app/api/dashboard/stats/route.ts` (whole GET body)
- Modify: `apps/web/src/__tests__/dashboard-api.test.ts:5-28` (add `findFirst` mock), `:117`, `:140`, `:154`, `:176` (call sites)

**Interfaces:**
- Consumes: `resolveMonthKey`, `monthWindow`, `listMonths`, `monthLabel` from Task 1.
- Produces, relied on by Task 3 — the response shape:
  ```typescript
  {
      slaBreaches: number;        // unchanged, removed in PR 2
      avgFirstResponseMs: number;
      avgResolutionMs: number;
      totalTickets: number;       // NOW the selected month's count
      openTickets: number;
      trend: Array<{ day: number; count: number }>;
      month: string;              // label, e.g. "July 2026"
      monthKey: string;           // "2026-07"
      availableMonths: string[];  // ascending keys
      year: number;
  }
  ```

- [ ] **Step 1: Write the failing tests**

In `apps/web/src/__tests__/dashboard-api.test.ts`, add a `findFirst` mock alongside the existing ones at line 5:

```typescript
const mockTicketCount = vi.fn();
const mockTicketFindMany = vi.fn();
const mockTicketFindFirst = vi.fn();
```

and wire it into the `ticket` mock at line 10:

```typescript
        ticket: {
            count: (...args: unknown[]) => mockTicketCount(...args),
            findMany: (...args: unknown[]) => mockTicketFindMany(...args),
            findFirst: (...args: unknown[]) => mockTicketFindFirst(...args),
        },
```

Add this helper next to `userSession` (line 68) — the route now takes a `Request`:

```typescript
function statsRequest(month?: string): Request {
    const url = month
        ? `http://localhost/api/dashboard/stats?month=${month}`
        : 'http://localhost/api/dashboard/stats';
    return new Request(url);
}
```

Append these tests inside `describe('GET /api/dashboard/stats', ...)`:

```typescript
        it('returns the requested month, its label, and selectable months', async () => {
            mockTicketFindFirst.mockResolvedValue({ createdAt: new Date(2026, 4, 20) });
            mockTicketCount
                .mockResolvedValueOnce(4)   // totalTickets for the window
                .mockResolvedValueOnce(2)   // openTickets
                .mockResolvedValueOnce(0);  // slaBreaches
            mockTicketFindMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ createdAt: new Date(2026, 5, 4) }]);

            const res = await statsGet(statsRequest('2026-06'));
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.monthKey).toBe('2026-06');
            expect(body.month).toBe('June 2026');
            expect(body.trend).toHaveLength(30);
            expect(body.trend.find((d: { day: number; count: number }) => d.day === 4)?.count).toBe(1);
            expect(body.availableMonths[0]).toBe('2026-05');
            expect(body.availableMonths).toContain('2026-06');
        });

        it('scopes totalTickets to the selected month, not all time', async () => {
            mockTicketFindFirst.mockResolvedValue({ createdAt: new Date(2026, 5, 4) });
            mockTicketCount
                .mockResolvedValueOnce(4)
                .mockResolvedValueOnce(1)
                .mockResolvedValueOnce(0);
            mockTicketFindMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const res = await statsGet(statsRequest('2026-06'));
            const body = await res.json();

            expect(body.totalTickets).toBe(4);
            // The count must be constrained by a createdAt window.
            const countArgs = mockTicketCount.mock.calls[0][0] as {
                where?: { createdAt?: { gte: Date; lte: Date } };
            };
            expect(countArgs?.where?.createdAt?.gte).toEqual(new Date(2026, 5, 1, 0, 0, 0, 0));
            expect(countArgs?.where?.createdAt?.lte).toEqual(new Date(2026, 5, 30, 23, 59, 59, 999));
        });

        it('falls back to the current month for a malformed month param', async () => {
            mockTicketFindFirst.mockResolvedValue({ createdAt: new Date(2026, 0, 1) });
            mockTicketCount
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(0);
            mockTicketFindMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const res = await statsGet(statsRequest('garbage'));
            const body = await res.json();

            expect(res.status).toBe(200);
            const now = new Date();
            expect(body.monthKey).toBe(
                `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
            );
        });

        it('offers only the current month when there are no tickets', async () => {
            mockTicketFindFirst.mockResolvedValue(null);
            mockTicketCount
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(0)
                .mockResolvedValueOnce(0);
            mockTicketFindMany
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const res = await statsGet(statsRequest());
            const body = await res.json();

            expect(body.availableMonths).toHaveLength(1);
        });
```

Update the four existing `statsGet()` call sites to pass a request and to mock `findFirst`. At lines 117, 140, 154, and 176 replace `await statsGet()` with `await statsGet(statsRequest())`, and add `mockTicketFindFirst.mockResolvedValue({ createdAt: new Date() });` at the top of each of those four tests. In the test at line 161 (`computes daily trend with correct number of days`), `mockTicketFindFirst` must resolve to a date in the current month so the current month stays selectable.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @copilotkit/outpost-web exec vitest run src/__tests__/dashboard-api.test.ts`

Expected: FAIL — `body.monthKey` is `undefined` and `body.availableMonths` is `undefined`, because the route ignores the request.

- [ ] **Step 3: Write the implementation**

Replace the body of `apps/web/src/app/api/dashboard/stats/route.ts` between the imports and the `catch` with the version below. Note the two structural changes: `totalTickets` is now a windowed count, and `oldestTicket` is fetched **before** the parallel block because `resolveMonthKey` needs it to validate the param.

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@copilotkit/outpost/db';
import { TicketStatus, MessageType } from '@copilotkit/outpost/db';
import {
    resolveMonthKey,
    monthWindow,
    monthLabel,
    listMonths,
} from '@/lib/month-window';

/**
 * GET /api/dashboard/stats?month=YYYY-MM
 *
 * Returns SLA metrics, ticket counts, and daily trend data for the
 * requested month. An absent, malformed, or out-of-range month falls
 * back to the current month rather than erroring — a bad query param
 * must not blank the dashboard.
 */
export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const now = new Date();

        // Fetched first: resolveMonthKey needs the oldest ticket to know
        // which months are in range.
        const oldestTicket = await prisma.ticket.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
        });
        const oldest = oldestTicket?.createdAt ?? null;

        const url = new URL(request.url);
        const monthKey = resolveMonthKey(url.searchParams.get('month'), oldest, now);
        const { start: monthStart, end: monthEnd, daysInMonth } = monthWindow(monthKey);

        const [
            totalTickets,
            openTickets,
            slaBreaches,
            ticketsWithFirstResponse,
            resolvedTickets,
            monthlyTickets,
        ] = await Promise.all([
            // Scoped to the selected month so the figure matches the chart
            // beside it.
            prisma.ticket.count({
                where: { createdAt: { gte: monthStart, lte: monthEnd } },
            }),
            prisma.ticket.count({
                where: {
                    status: {
                        in: [
                            TicketStatus.OPEN,
                            TicketStatus.IN_PROGRESS,
                            TicketStatus.WAITING_ON_CUSTOMER,
                            TicketStatus.WAITING_ON_TEAM,
                        ],
                    },
                },
            }),
            // Left all-time and untouched: PR 2 removes this field together
            // with the SLA Breaches card that reads it.
            prisma.ticket.count({
                where: { slaBreachedAt: { not: null } },
            }),
            prisma.ticket.findMany({
                select: {
                    createdAt: true,
                    user: { select: { name: true } },
                    messages: {
                        where: {
                            type: { not: MessageType.SYSTEM },
                        },
                        orderBy: { createdAt: 'asc' },
                        take: 5,
                    },
                },
            }),
            prisma.ticket.findMany({
                where: {
                    status: { in: [TicketStatus.RESOLVED, TicketStatus.CLOSED] },
                },
                select: {
                    createdAt: true,
                    updatedAt: true,
                },
            }),
            prisma.ticket.findMany({
                where: {
                    createdAt: {
                        gte: monthStart,
                        lte: monthEnd,
                    },
                },
                select: { createdAt: true },
            }),
        ]);
```

Keep the existing first-response and resolution averaging blocks (lines 86-113) exactly as they are. Replace the trend-building block and the response with:

```typescript
        // Build daily trend for the selected month
        const dailyCounts: number[] = new Array(daysInMonth).fill(0);

        for (const ticket of monthlyTickets) {
            const day = ticket.createdAt.getDate();
            if (day >= 1 && day <= daysInMonth) {
                dailyCounts[day - 1]++;
            }
        }

        const trend = dailyCounts.map((count, i) => ({
            day: i + 1,
            count,
        }));

        return NextResponse.json({
            slaBreaches,
            avgFirstResponseMs,
            avgResolutionMs,
            totalTickets,
            openTickets,
            trend,
            month: monthLabel(monthKey),
            monthKey,
            availableMonths: listMonths(oldest, now),
            year: monthWindow(monthKey).start.getFullYear(),
        });
```

The old day-bucketing guard compared `getFullYear()`/`getMonth()` against `now`; that is dropped because the Prisma `where` already constrains the window, and re-checking against `now` would zero out every non-current month.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @copilotkit/outpost-web exec vitest run src/__tests__/dashboard-api.test.ts`

Expected: PASS, including the four pre-existing stats tests.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @copilotkit/outpost-web typecheck`

Expected: no errors. If `page.tsx` errors on the response type, leave it — Task 3 updates that file.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/dashboard/stats/route.ts apps/web/src/__tests__/dashboard-api.test.ts
git commit -m "feat(web): stats route accepts ?month=YYYY-MM

totalTickets now counts the selected month rather than all time, so the
figure and the chart beside it describe the same window. availableMonths
spans the oldest ticket through today. Malformed or out-of-range months
fall back to the current month."
```

---

### Task 3: Month dropdown in the UI

**Files:**
- Modify: `apps/web/src/components/dashboard/tickets-trend.tsx:13-42`
- Modify: `apps/web/src/app/dashboard/page.tsx:13-46`
- Test: `apps/web/src/__tests__/tickets-trend.test.tsx` (create)

**Interfaces:**
- Consumes: `monthLabel` from Task 1; the response shape from Task 2.
- Produces: `TicketsTrendProps` gains `monthKey: string`, `availableMonths: string[]`, `onMonthChange: (key: string) => void`. `month` (the label) stays for the subheading.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/tickets-trend.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TicketsTrend } from '@/components/dashboard/tickets-trend';

describe('TicketsTrend', () => {
    const data = [
        { day: 1, count: 2 },
        { day: 2, count: 0 },
    ];

    it('renders one option per available month, labelled', () => {
        render(
            <TicketsTrend
                data={data}
                month="July 2026"
                monthKey="2026-07"
                availableMonths={['2026-06', '2026-07']}
                onMonthChange={vi.fn()}
                totalTickets={47}
            />,
        );

        const select = screen.getByLabelText('Select month') as HTMLSelectElement;
        expect(select.value).toBe('2026-07');
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
            'June 2026',
            'July 2026',
        ]);
    });

    it('reports the newly selected month key', () => {
        const onMonthChange = vi.fn();
        render(
            <TicketsTrend
                data={data}
                month="July 2026"
                monthKey="2026-07"
                availableMonths={['2026-06', '2026-07']}
                onMonthChange={onMonthChange}
                totalTickets={47}
            />,
        );

        fireEvent.change(screen.getByLabelText('Select month'), {
            target: { value: '2026-06' },
        });

        expect(onMonthChange).toHaveBeenCalledWith('2026-06');
    });

    it('shows the empty state for a month with no tickets', () => {
        render(
            <TicketsTrend
                data={[{ day: 1, count: 0 }]}
                month="June 2026"
                monthKey="2026-06"
                availableMonths={['2026-06', '2026-07']}
                onMonthChange={vi.fn()}
                totalTickets={0}
            />,
        );

        expect(screen.getByTestId('trend-empty')).toBeInTheDocument();
    });

    it('renders the selected month total', () => {
        render(
            <TicketsTrend
                data={data}
                month="July 2026"
                monthKey="2026-07"
                availableMonths={['2026-07']}
                onMonthChange={vi.fn()}
                totalTickets={47}
            />,
        );

        expect(screen.getByTestId('trend-total')).toHaveTextContent('47');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @copilotkit/outpost-web exec vitest run src/__tests__/tickets-trend.test.tsx`

Expected: FAIL — no element labelled "Select month".

- [ ] **Step 3: Add the dropdown to TicketsTrend**

In `apps/web/src/components/dashboard/tickets-trend.tsx`, add `monthLabel` to the imports:

```tsx
import { monthLabel } from '@/lib/month-window';
```

Replace the props interface (lines 18-22):

```tsx
interface TicketsTrendProps {
    data: TrendDataPoint[];
    /** Human label for the selected month, e.g. "July 2026". */
    month: string;
    /** Selected month key, e.g. "2026-07". */
    monthKey: string;
    /** Selectable month keys, ascending. */
    availableMonths: string[];
    onMonthChange: (key: string) => void;
    totalTickets: number;
}

export function TicketsTrend({
    data,
    month,
    monthKey,
    availableMonths,
    onMonthChange,
    totalTickets,
}: TicketsTrendProps) {
```

Replace the header block (lines 29-42) with:

```tsx
            <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-lg font-semibold text-card-foreground">
                        Tickets Trend
                    </h3>
                    <p className="text-sm text-muted-foreground">{month}</p>
                </div>
                <div className="flex items-center gap-4">
                    <select
                        aria-label="Select month"
                        value={monthKey}
                        onChange={(e) => onMonthChange(e.target.value)}
                        className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground hover:border-input focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                        {availableMonths.map((key) => (
                            <option key={key} value={key}>
                                {monthLabel(key)}
                            </option>
                        ))}
                    </select>
                    <div className="text-right">
                        <p className="text-2xl font-bold text-card-foreground" data-testid="trend-total">
                            {totalTickets}
                        </p>
                        <p className="text-xs text-muted-foreground">total tickets</p>
                    </div>
                </div>
            </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @copilotkit/outpost-web exec vitest run src/__tests__/tickets-trend.test.tsx`

Expected: PASS.

- [ ] **Step 5: Wire the page**

In `apps/web/src/app/dashboard/page.tsx`, extend the response interface (lines 13-22) with the two new fields:

```tsx
interface StatsResponse {
    slaBreaches: number;
    avgFirstResponseMs: number;
    avgResolutionMs: number;
    totalTickets: number;
    openTickets: number;
    trend: TrendDataPoint[];
    month: string;
    monthKey: string;
    availableMonths: string[];
    year: number;
}
```

Replace the state and effect (lines 25-38):

```tsx
    const [stats, setStats] = useState<StatsResponse | null>(null);
    // null until the first response tells us which month the server picked.
    const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

    useEffect(() => {
        async function fetchStats() {
            try {
                const query = selectedMonth ? `?month=${selectedMonth}` : '';
                const res = await fetch(`/api/dashboard/stats${query}`);
                const data: StatsResponse = await res.json();
                setStats(data);
            } catch {
                // Will show loading/empty states
            }
        }
        fetchStats();
    }, [selectedMonth]);
```

Replace the `TicketsTrend` usage (lines 66-70):

```tsx
                    <TicketsTrend
                        data={stats?.trend ?? []}
                        month={stats?.month ?? ''}
                        monthKey={stats?.monthKey ?? ''}
                        availableMonths={stats?.availableMonths ?? []}
                        onMonthChange={setSelectedMonth}
                        totalTickets={stats?.totalTickets ?? 0}
                    />
```

- [ ] **Step 6: Typecheck and run the full web suite**

Run: `pnpm --filter @copilotkit/outpost-web typecheck && pnpm --filter @copilotkit/outpost-web test`

Expected: no type errors, all tests pass.

- [ ] **Step 7: Verify against the prod-data clone**

The dev server runs on port 3001 against `localhost:5433` (see the spec's Verification section). Confirm each of these:

```bash
curl -s -b /tmp/cookies.txt 'http://localhost:3001/api/dashboard/stats?month=2026-06' \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["month"], d["totalTickets"], d["availableMonths"])'
```

Expected: `June 2026 4 ['2026-06', '2026-07']`. Then `?month=2026-07` → `July 2026 47`, and `?month=garbage` → the current month. In the browser, the dropdown switches the chart between the two months and the total updates with it.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/dashboard/tickets-trend.tsx apps/web/src/app/dashboard/page.tsx apps/web/src/__tests__/tickets-trend.test.tsx
git commit -m "feat(web): month dropdown on Tickets Trend

The chart was locked to the current month with no way to look back."
```

---

## Follow-on plans

PR 2 (Needs Human Reply) and PR 3 (FAQ) get their own plans and their own branches off `main`: `feat/dashboard-needs-human-reply` and `feat/dashboard-faq`. PR 2 carries a `Message` schema migration plus a backfill; PR 3 adds the `Faq` model, the `FAQ_GENERATE` job, and the draft-review flow. Neither depends on this PR's code.
