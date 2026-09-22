/**
 * GitHub source: new releases, plus the context needed to write about them.
 *
 * Release notes alone are not enough. CopilotKit's are often one sentence, and
 * AG-UI's are thousands of characters of package tables. So for every release we
 * also pull the commits since the previous release, which gives us the real PR
 * list and, more importantly, who wrote them.
 */

import { TIMEOUT_MS, parseJson } from './http.js';

const API = 'https://api.github.com';

/** Org listings this bot treats as "the team". */
const ORGS = ['CopilotKit', 'ag-ui-protocol'];

/** Pages of 100 members to read before giving up. */
const MEMBER_PAGES = 20;

/** Pages of 100 releases to walk back through while still inside the lookback window. */
const RELEASE_PAGES = 5;

/** Pages of 100 commits to read from a compare range. */
const COMPARE_PAGES = 10;

export type Release = {
    repo: string;
    tag: string;
    name: string;
    url: string;
    body: string;
    publishedAt: string;
};

export type Contributor = {
    login: string;
    external: boolean;
};

export type ReleaseContext = Release & {
    commits: string[];
    contributors: Contributor[];
};

/** Only the fields this app reads, not the full GitHub payloads. */
type GhRelease = {
    draft: boolean;
    prerelease: boolean;
    published_at: string | null;
    tag_name: string;
    name: string | null;
    html_url: string;
    body: string | null;
};

type GhCommit = {
    commit: { message: string };
    author: { login: string } | null;
};

type GhCompare = { commits?: GhCommit[]; total_commits?: number };

type GhMember = { login: string };

function headers() {
    const token = process.env.GITHUB_TOKEN;
    // Unauthenticated, GitHub allows 60 requests an hour and hides org members,
    // so the run would die partway through with an opaque 403 and credit nobody.
    // Failing here names the actual problem instead.
    if (!token) {
        throw new Error(
            'GITHUB_TOKEN is not set. It needs read:org to tell the team from contributors.',
        );
    }
    return {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'copilotkit-release-bot',
        Authorization: `Bearer ${token}`,
    };
}

const MAX_RETRIES = 3;

/**
 * A GitHub read, with bounded retries.
 *
 * Reads are retried for the same reason Discord's are: a secondary rate limit
 * or a 502 on one of several calls per run would otherwise fail a whole source.
 * `tolerate` returns null instead of throwing, for the caller that needs to
 * degrade rather than abort.
 */
async function gh<T>(path: string, options: { tolerate?: boolean } = {}): Promise<T> {
    // Outside the loop, so a missing token throws rather than being tolerated
    // as though it were an HTTP failure. A config error is not a bad network.
    const requestHeaders = headers();

    for (let attempt = 1; ; attempt++) {
        const last = attempt >= MAX_RETRIES;

        let res: Response;
        try {
            res = await fetch(`${API}${path}`, {
                headers: requestHeaders,
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (error) {
            if (last) {
                if (options.tolerate) return null as T;
                throw error;
            }
            await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
            continue;
        }

        if (res.ok) return parseJson<T>(res, 'GitHub');

        const retryable = res.status === 429 || res.status === 403 || res.status >= 500;
        if (retryable && !last) {
            const after = Number(res.headers.get('retry-after'));
            const wait =
                Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** (attempt - 1);
            await new Promise((r) => setTimeout(r, Math.min(wait, 60_000)));
            continue;
        }

        if (options.tolerate) return null as T;
        throw new Error(`GitHub ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    }
}

/**
 * Releases published since `since`, oldest first.
 *
 * Paginates rather than reading one page: the API orders by creation, not
 * publication, and a busy week of per-package releases pushed main-line releases
 * out of a single 30-item page while they were still inside the lookback window.
 * A release that falls out of the window is not deferred, it is lost, because the
 * watermark has already moved past it.
 */
export async function listReleases(repo: string, since: string): Promise<Release[]> {
    const collected: Release[] = [];
    const cutoff = Date.parse(since);
    let exhausted = true;

    for (let page = 1; page <= RELEASE_PAGES; page++) {
        const batch = await gh<GhRelease[]>(`/repos/${repo}/releases?per_page=100&page=${page}`);
        if (!batch.length) break;

        for (const r of batch) {
            if (r.draft || r.prerelease || !r.published_at) continue;
            // By instant, not by string: `since` carries milliseconds and
            // GitHub's timestamps do not, so a lexicographic compare disagrees
            // inside the boundary second.
            if (Date.parse(r.published_at) <= cutoff) continue;
            collected.push({
                repo,
                tag: r.tag_name,
                name: r.name || r.tag_name,
                url: r.html_url,
                body: r.body || '',
                publishedAt: r.published_at,
            });
        }

        // Ordering is by creation, so only stop once a whole page is older than
        // the window rather than on the first old entry.
        const allOlder = batch.every(
            (r) => !r.published_at || Date.parse(r.published_at) <= cutoff,
        );
        if (allOlder || batch.length < 100) {
            exhausted = false;
            break;
        }
    }

    // Anything still inside the window but past this many pages is invisible,
    // and invisible means lost rather than deferred once the watermark moves.
    if (exhausted) {
        console.warn(`${repo}: more than ${RELEASE_PAGES} pages of releases inside the window`);
    }

    return collected.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
}

/**
 * Logins that belong to automation.
 *
 * Anchored, because unanchored substrings dropped real people: a contributor
 * called `renovate-fan` is not Renovate.
 */
const BOT_LOGINS = [
    /\[bot\]$/i,
    /^renovate(-bot)?$/i,
    /^dependabot$/i,
    /^claude$/i,
    /^copilot$/i,
    /^cursoragent$/i,
    /^coderabbitai$/i,
    /^sweep-ai$/i,
    /^[\w-]*devops-bot$/i,
];

const isBot = (login: string) => BOT_LOGINS.some((pattern) => pattern.test(login));

/**
 * Who counts as the team.
 *
 * Read from the orgs rather than kept in a list here, because most of the team's
 * membership is private and the public endpoint reports colleagues as outsiders.
 *
 * A token without org visibility does not fail, it returns 200 and an empty
 * list, and a failure mid-pagination used to pass silently with a partial list.
 * Either outcome credits colleagues publicly as outside contributors, which is
 * worse than crediting nobody, so `resolved` is false unless at least one org
 * was read completely and returned members.
 *
 * It is not all-or-nothing across every org, because that made credit
 * impossible in practice: `ag-ui-protocol` returns an empty list for a token
 * scoped to `CopilotKit`, and the maintainers of both repos are in the
 * CopilotKit org anyway. An org that cannot be read is warned about loudly, and
 * `CORE_LOGINS` covers anyone it would otherwise have missed.
 */
export type Team = { members: Set<string>; resolved: boolean };

let teamPromise: Promise<Team> | undefined;

export function team(): Promise<Team> {
    teamPromise ??= readTeam().catch((error) => {
        // Do not cache the rejection: one transient network error would
        // otherwise poison every later call in the run.
        teamPromise = undefined;
        throw error;
    });
    return teamPromise;
}

async function readTeam(): Promise<Team> {
    const members = new Set(
        (process.env.CORE_LOGINS?.split(',') ?? [])
            .map((l) => l.trim().toLowerCase())
            .filter(Boolean),
    );

    const unreadable: string[] = [];

    for (const org of ORGS) {
        let complete = false;
        let seen = 0;

        for (let page = 1; page <= MEMBER_PAGES && !complete; page++) {
            const res = await gh<GhMember[] | null>(
                `/orgs/${org}/members?per_page=100&page=${page}`,
                { tolerate: true },
            );

            if (!res) {
                console.warn(
                    `Could not read ${org} members (page ${page}). Anyone only in that org ` +
                        'may be credited as an outside contributor; add them to CORE_LOGINS. ' +
                        'GITHUB_TOKEN needs read:org.',
                );
                unreadable.push(org);
                break;
            }

            for (const m of res) members.add(m.login.toLowerCase());
            seen += res.length;
            // `break` here, not `return`: returning meant the second org was
            // never read at all, and its members were then thanked publicly as
            // outside contributors.
            if (res.length < 100) complete = true;
        }

        if (unreadable.includes(org)) continue;

        if (!complete) {
            console.warn(`${org} has more members than ${MEMBER_PAGES} pages; not crediting.`);
            return { members, resolved: false };
        }

        // 200 with an empty list is what a token lacking visibility returns.
        // Treating it as "this org has nobody" is what credits a whole team as
        // outsiders, so it counts as unreadable rather than as an answer.
        if (!seen) {
            console.warn(
                `${org} returned no members; GITHUB_TOKEN cannot see it. Anyone only in that ` +
                    'org may be credited as an outside contributor; add them to CORE_LOGINS.',
            );
            unreadable.push(org);
        }
    }

    // Credit needs at least one org actually read. With none, every contributor
    // would look external and the whole team would be thanked publicly.
    const resolved = unreadable.length < ORGS.length;
    if (!resolved) console.warn('No org membership visible; contributors will not be credited.');

    return { members, resolved };
}

/** Commit subjects that are noise in an announcement and in the credit line. */
const NOISE =
    /^((chore|build|fix|ci|test|docs)\((deps|deps-dev|release)\)|chore\(release\)|chore: bump|release:|(ci|test|docs)[(:]|Merge )/i;

/**
 * Commits between the previous release and this one, and who authored them.
 *
 * `previous` comes from the caller's release list rather than from `GET /tags`.
 * Tag adjacency looked right and was not: the tag list is ordered by refname,
 * carries junk tags (`vundefined` sorts above `v1.73.0`), and mixes per-package
 * tags in, so `tags[index + 1]` could pick a baseline from an unrelated line and
 * credit people for commits they had nothing to do with.
 */
export async function contextFor(release: Release, previous?: Release): Promise<ReleaseContext> {
    if (!previous) {
        console.warn(
            `${release.tag}: no previous release in the window, announcing without commit context`,
        );
        return { ...release, commits: [], contributors: [] };
    }

    const range = `${encodeURIComponent(previous.tag)}...${encodeURIComponent(release.tag)}`;
    const first = await gh<GhCompare>(`/repos/${release.repo}/compare/${range}?per_page=100`);

    const all = [...(first.commits ?? [])];
    const total = first.total_commits ?? all.length;

    // The compare endpoint caps a page at 250 and returns oldest first, so
    // without paging the newest work in a large release is simply absent, and
    // any contributor who only appears there goes unthanked.
    for (let page = 2; all.length < total && page <= COMPARE_PAGES; page++) {
        const next = await gh<GhCompare>(
            `/repos/${release.repo}/compare/${range}?per_page=100&page=${page}`,
        );
        const batch = next.commits ?? [];
        if (!batch.length) break;
        all.push(...batch);
    }

    if (all.length < total) {
        console.warn(
            `${release.tag}: read ${all.length} of ${total} commits; ` +
                'the summary and credit line may be incomplete.',
        );
    }

    const substantive = all.filter((c) => !NOISE.test(c.commit.message.split('\n')[0]));
    const commits = substantive.map((c) => c.commit.message.split('\n')[0]);

    // Authors come from the filtered commits: someone whose only commits in the
    // range were dependency bumps should not be thanked for the release.
    const logins = new Set<string>();
    for (const c of substantive) {
        const login = c.author?.login;
        if (login && !isBot(login)) logins.add(login);
    }

    const { members, resolved } = await team();

    const contributors = [...logins].map((login) => ({
        login,
        // Unknown team means unknown provenance, so nobody is marked external
        // and the announcement carries no credit line at all.
        external: resolved && !members.has(login.toLowerCase()),
    }));

    return { ...release, commits, contributors };
}
