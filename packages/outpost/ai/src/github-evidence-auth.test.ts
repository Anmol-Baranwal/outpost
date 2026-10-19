import { describe, expect, it, vi } from 'vitest';
import {
    GitHubEvidenceAuthError,
    anonymousGitHubEvidenceAuth,
    githubEvidenceAuthDiagnostic,
    githubEvidenceAuthFromEnv,
    githubEvidenceHeaders,
    type InstallationTokenFactory,
    type InstallationTokenSource,
} from './github-evidence-auth.js';

/** Synthetic throughout: no test here may carry a credential that works anywhere. */
const CREDENTIALS = {
    GITHUB_APP_ID: '123456',
    GITHUB_PRIVATE_KEY:
        '-----BEGIN RSA PRIVATE KEY-----\nplaceholder\n-----END RSA PRIVATE KEY-----',
    GITHUB_INSTALLATION_ID: '7890',
};
const TOKEN = 'ghs_syntheticplaceholdertoken';

/** Stands in for `createAppAuth`, recording how the strategy is built and invoked. */
function fakeAppAuth(
    onAuth: InstallationTokenSource = async () => ({ token: TOKEN }),
    onCreate: () => void = () => {},
) {
    const auth = vi.fn<InstallationTokenSource>(onAuth);
    const create = vi.fn<InstallationTokenFactory>(() => {
        onCreate();
        return auth;
    });
    return { create, auth };
}

describe('GitHub evidence authentication', () => {
    it('reads no credential source beyond the three App environment variables', async () => {
        const { create } = fakeAppAuth();
        const auth = githubEvidenceAuthFromEnv(
            {
                ...CREDENTIALS,
                GITHUB_TOKEN: 'ghp_shouldbeignored',
                GH_TOKEN: 'ghp_shouldbeignored',
            },
            create,
        );
        await auth.authorization();
        expect(create).toHaveBeenCalledWith({
            appId: CREDENTIALS.GITHUB_APP_ID,
            privateKey: CREDENTIALS.GITHUB_PRIVATE_KEY,
            installationId: 7890,
        });
    });

    it('authorizes evidence requests with an installation token narrowed to contents:read', async () => {
        const { create, auth } = fakeAppAuth();
        const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        expect(await resolver.authorization()).toBe(`Bearer ${TOKEN}`);
        expect(auth).toHaveBeenCalledWith({
            type: 'installation',
            installationId: 7890,
            permissions: { contents: 'read' },
        });
    });

    it('creates the App strategy lazily, so a run that reads no source mints no JWT', async () => {
        const { create } = fakeAppAuth();
        const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        expect(create).not.toHaveBeenCalled();
        await resolver.authorization();
        await resolver.authorization();
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('re-invokes the strategy per request so the SDK owns token caching and refresh', async () => {
        const { create, auth } = fakeAppAuth();
        const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        await resolver.authorization();
        await resolver.authorization();
        await resolver.authorization();
        expect(auth).toHaveBeenCalledTimes(3);
    });

    // A SupportAgent is built per job and per web QA request, and each one asks for its
    // own resolver. The SDK's token cache lives in the strategy, so a resolver per agent
    // would mean a token exchange per ticket instead of one shared token.
    it('hands every agent the same resolver, so one strategy serves many investigations', async () => {
        const { create, auth } = fakeAppAuth();
        const first = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        const second = githubEvidenceAuthFromEnv({ ...CREDENTIALS }, create);
        expect(second).toBe(first);
        await first.authorization();
        await second.authorization();
        expect(create).toHaveBeenCalledTimes(1);
        expect(auth).toHaveBeenCalledTimes(2);
    });

    it('shares the resolver on the production path, where the factory is defaulted', () => {
        // No authorization is requested, so the real `createAppAuth` is never built.
        expect(githubEvidenceAuthFromEnv(CREDENTIALS)).toBe(githubEvidenceAuthFromEnv(CREDENTIALS));
    });

    it('builds a fresh resolver when the credentials change', async () => {
        const { create } = fakeAppAuth();
        const first = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        const moved = githubEvidenceAuthFromEnv(
            { ...CREDENTIALS, GITHUB_INSTALLATION_ID: '7891' },
            create,
        );
        expect(moved).not.toBe(first);
        await moved.authorization();
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ installationId: 7891 }));
    });

    it('does not pin a failed exchange on the shared resolver', async () => {
        const { create, auth } = fakeAppAuth();
        auth.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));
        await expect(
            githubEvidenceAuthFromEnv(CREDENTIALS, create).authorization(),
        ).rejects.toBeInstanceOf(GitHubEvidenceAuthError);
        // The next ticket gets the same resolver, and it exchanges again.
        expect(await githubEvidenceAuthFromEnv(CREDENTIALS, create).authorization()).toBe(
            `Bearer ${TOKEN}`,
        );
    });

    /** A second synthetic key, standing in for a rotation of the configured one. */
    const ROTATED_PRIVATE_KEY =
        '-----BEGIN RSA PRIVATE KEY-----\nrotatedplaceholder\n-----END RSA PRIVATE KEY-----';

    // The slot is reused only when everything its strategy was built from matches, and each
    // part has to count on its own. A comparison that skipped the private key, say, would
    // leave a rotated key's investigations on a strategy still signing with the old one.
    it.each([
        {
            part: 'GITHUB_APP_ID',
            env: { GITHUB_APP_ID: '654321' },
            built: { appId: '654321' },
        },
        {
            part: 'GITHUB_PRIVATE_KEY',
            env: { GITHUB_PRIVATE_KEY: ROTATED_PRIVATE_KEY },
            built: { privateKey: ROTATED_PRIVATE_KEY },
        },
        {
            part: 'GITHUB_INSTALLATION_ID',
            env: { GITHUB_INSTALLATION_ID: '7891' },
            built: { installationId: 7891 },
        },
        { part: 'the token factory', env: {}, built: {}, newFactory: true },
    ])(
        'builds a fresh resolver when any part of its key changes: $part',
        async ({ env, built, newFactory }) => {
            const original = fakeAppAuth();
            const first = githubEvidenceAuthFromEnv(CREDENTIALS, original.create);
            // Built and serving, as the old strategy would be when the change lands.
            await first.authorization();
            const { create } = newFactory ? fakeAppAuth() : original;
            const changed = githubEvidenceAuthFromEnv({ ...CREDENTIALS, ...env }, create);
            expect(changed).not.toBe(first);
            await changed.authorization();
            expect(create).toHaveBeenLastCalledWith({
                appId: CREDENTIALS.GITHUB_APP_ID,
                privateKey: CREDENTIALS.GITHUB_PRIVATE_KEY,
                installationId: 7890,
                ...built,
            });
        },
    );

    // Construction is deferred to first use, so a strategy that failed to build must leave
    // the shared resolver unbuilt. Remembering the failure would fail every investigation
    // that followed, for as long as the worker stayed up.
    it('does not pin a failed strategy construction on the shared resolver', async () => {
        const { create, auth } = fakeAppAuth();
        create.mockImplementationOnce(() => {
            throw new TypeError('[@octokit/auth-app] strategy could not be built');
        });
        const first = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        await expect(first.authorization()).rejects.toBeInstanceOf(GitHubEvidenceAuthError);
        // The next ticket gets the same resolver, and it builds the strategy again.
        const next = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        expect(next).toBe(first);
        expect(await next.authorization()).toBe(`Bearer ${TOKEN}`);
        expect(create).toHaveBeenCalledTimes(2);
        expect(auth).toHaveBeenCalledTimes(1);
    });

    it('serves anonymous public reads only when no App credential is configured', async () => {
        const { create } = fakeAppAuth();
        const resolver = githubEvidenceAuthFromEnv({}, create);
        expect(await resolver.authorization()).toBeUndefined();
        expect(create).not.toHaveBeenCalled();
    });

    it('treats blank-but-present credentials as unconfigured rather than partial', async () => {
        const resolver = githubEvidenceAuthFromEnv(
            { GITHUB_APP_ID: '  ', GITHUB_PRIVATE_KEY: '', GITHUB_INSTALLATION_ID: '\n' },
            fakeAppAuth().create,
        );
        expect(await resolver.authorization()).toBeUndefined();
    });

    it.each([
        {
            name: 'private key and installation id missing',
            env: { GITHUB_APP_ID: CREDENTIALS.GITHUB_APP_ID },
            missing: ['GITHUB_PRIVATE_KEY', 'GITHUB_INSTALLATION_ID'],
        },
        {
            name: 'installation id missing',
            env: {
                GITHUB_APP_ID: CREDENTIALS.GITHUB_APP_ID,
                GITHUB_PRIVATE_KEY: CREDENTIALS.GITHUB_PRIVATE_KEY,
            },
            missing: ['GITHUB_INSTALLATION_ID'],
        },
        {
            name: 'app id missing',
            env: {
                GITHUB_PRIVATE_KEY: CREDENTIALS.GITHUB_PRIVATE_KEY,
                GITHUB_INSTALLATION_ID: CREDENTIALS.GITHUB_INSTALLATION_ID,
            },
            missing: ['GITHUB_APP_ID'],
        },
    ])('fails partial App configuration instead of falling back anonymously: $name', async (c) => {
        const { create } = fakeAppAuth();
        const resolver = githubEvidenceAuthFromEnv(c.env, create);
        const error = await resolver.authorization().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(GitHubEvidenceAuthError);
        for (const name of c.missing) expect((error as Error).message).toContain(name);
        expect(create).not.toHaveBeenCalled();
    });

    it.each(['abc', '0', '-7', '1.5', '7890abc', '1e3'])(
        'fails a malformed GITHUB_INSTALLATION_ID instead of falling back anonymously: %s',
        async (installationId) => {
            const { create } = fakeAppAuth();
            const resolver = githubEvidenceAuthFromEnv(
                { ...CREDENTIALS, GITHUB_INSTALLATION_ID: installationId },
                create,
            );
            await expect(resolver.authorization()).rejects.toBeInstanceOf(GitHubEvidenceAuthError);
            expect(create).not.toHaveBeenCalled();
        },
    );

    it('surfaces a strategy failure without echoing the private key or the minted token', async () => {
        const leaky = new RangeError(
            `secretOrPrivateKey ${CREDENTIALS.GITHUB_PRIVATE_KEY} rejected while minting ${TOKEN}`,
        );
        const { create } = fakeAppAuth(() => Promise.reject(leaky));
        const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        const error = await resolver.authorization().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(GitHubEvidenceAuthError);
        const rendered = `${(error as Error).message} ${(error as Error).stack ?? ''} ${JSON.stringify(error)}`;
        expect(rendered).not.toContain(TOKEN);
        expect(rendered).not.toContain('placeholder');
        expect(rendered).not.toContain(leaky.message);
        expect((error as Error).message).toContain('RangeError');
    });

    it('builds evidence headers that carry the token only when one was resolved', async () => {
        expect(await githubEvidenceHeaders(anonymousGitHubEvidenceAuth)).toEqual({
            Accept: 'application/vnd.github+json',
        });
        expect(
            await githubEvidenceHeaders(
                githubEvidenceAuthFromEnv(CREDENTIALS, fakeAppAuth().create),
            ),
        ).toEqual({
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${TOKEN}`,
        });
    });

    it('propagates an authorization failure rather than sending an unauthenticated request', async () => {
        const resolver = githubEvidenceAuthFromEnv(
            { GITHUB_APP_ID: CREDENTIALS.GITHUB_APP_ID },
            fakeAppAuth().create,
        );
        await expect(githubEvidenceHeaders(resolver)).rejects.toBeInstanceOf(
            GitHubEvidenceAuthError,
        );
    });

    it('surfaces a synchronous strategy construction failure without echoing the private key', async () => {
        const leaky = new TypeError(
            `[@octokit/auth-app] privateKey ${CREDENTIALS.GITHUB_PRIVATE_KEY} is malformed`,
        );
        const { create, auth } = fakeAppAuth(undefined, () => {
            throw leaky;
        });
        const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        const error = await resolver.authorization().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(GitHubEvidenceAuthError);
        const rendered = `${(error as Error).message} ${(error as Error).stack ?? ''} ${JSON.stringify(error)}`;
        expect(rendered).not.toContain('placeholder');
        expect(rendered).not.toContain(leaky.message);
        expect((error as Error).message).toContain('TypeError');
        expect(auth).not.toHaveBeenCalled();
    });

    describe('operator diagnostic', () => {
        /** The whole closed set a log line may say; anything else is a value that escaped. */
        const OPERATOR_VOCABULARY = [
            'partial_configuration',
            'invalid_installation_id',
            'token_exchange_failed',
            'auth_unavailable',
        ];

        it('names which App variables a partial configuration is missing', async () => {
            const resolver = githubEvidenceAuthFromEnv(
                { GITHUB_APP_ID: CREDENTIALS.GITHUB_APP_ID },
                fakeAppAuth().create,
            );
            const error = await resolver.authorization().catch((caught: unknown) => caught);
            expect(githubEvidenceAuthDiagnostic(error)).toEqual({
                code: 'partial_configuration',
                missing: ['GITHUB_PRIVATE_KEY', 'GITHUB_INSTALLATION_ID'],
            });
        });

        it('separates a malformed installation id from a missing one', async () => {
            const resolver = githubEvidenceAuthFromEnv(
                { ...CREDENTIALS, GITHUB_INSTALLATION_ID: '1e3' },
                fakeAppAuth().create,
            );
            const error = await resolver.authorization().catch((caught: unknown) => caught);
            expect(githubEvidenceAuthDiagnostic(error)).toEqual({
                code: 'invalid_installation_id',
            });
        });

        it('reports a failed token exchange without the key or token that failed it', async () => {
            const leaky = new RangeError(
                `secretOrPrivateKey ${CREDENTIALS.GITHUB_PRIVATE_KEY} rejected while minting ${TOKEN}`,
            );
            const { create } = fakeAppAuth(() => Promise.reject(leaky));
            const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
            const error = await resolver.authorization().catch((caught: unknown) => caught);
            const diagnostic = githubEvidenceAuthDiagnostic(error);
            expect(diagnostic).toEqual({ code: 'token_exchange_failed' });
            // The underlying class name reached the error message; it must not reach the log,
            // because nothing constrains what a third-party strategy names its errors.
            expect(JSON.stringify(diagnostic)).not.toContain('RangeError');
        });

        // `githubAuth` is an injectable seam, so a `GitHubEvidenceAuthError` can arrive carrying
        // anything at all. The log line is built from the allowlist, never from what it was handed.
        it('discards a forged code and forged variable names', () => {
            const forged = new GitHubEvidenceAuthError(
                `-----BEGIN RSA PRIVATE KEY-----\nplaceholder\n-----END RSA PRIVATE KEY-----`,
                {
                    code: 'partial_configuration',
                    missing: [
                        'GITHUB_PRIVATE_KEY',
                        'ghs_syntheticplaceholdertoken',
                        '10.1.2.3',
                    ] as never,
                },
            );
            expect(githubEvidenceAuthDiagnostic(forged)).toEqual({
                code: 'partial_configuration',
                missing: ['GITHUB_PRIVATE_KEY'],
            });
            const unknownCode = new GitHubEvidenceAuthError('boom', {
                code: 'sudo_make_me_a_sandwich' as never,
            });
            expect(githubEvidenceAuthDiagnostic(unknownCode)).toEqual({ code: 'auth_unavailable' });
            // Nothing recognizable survives the filter, so the claim itself is not repeated.
            const noneRecognized = new GitHubEvidenceAuthError('boom', {
                code: 'partial_configuration',
                missing: '10.1.2.3' as never,
            });
            expect(githubEvidenceAuthDiagnostic(noneRecognized)).toEqual({
                code: 'auth_unavailable',
            });
        });

        // A `diagnostic` arriving through the `githubAuth` seam is an object its author owns
        // outright, so its properties can be getters. Validating one read and returning another
        // would let a value that never passed the allowlist reach the operator log.
        it('discards a code that changes between the allowlist check and the return', () => {
            const synthetic = 'ghs_syntheticplaceholdertoken';
            const shifting = (first: string) => {
                let reads = 0;
                return new GitHubEvidenceAuthError('boom', {
                    get code() {
                        reads += 1;
                        return (reads === 1 ? first : synthetic) as never;
                    },
                    missing: ['GITHUB_APP_ID'],
                });
            };

            // The code is read again to pick the return branch, and again to build the result.
            const viaDirectReturn = githubEvidenceAuthDiagnostic(shifting('token_exchange_failed'));
            expect(OPERATOR_VOCABULARY).toContain(viaDirectReturn.code);
            expect(JSON.stringify(viaDirectReturn)).not.toContain(synthetic);

            // The partial-configuration branch reads it once more, after the name filter.
            const viaMissingBranch = githubEvidenceAuthDiagnostic(
                shifting('partial_configuration'),
            );
            expect(OPERATOR_VOCABULARY).toContain(viaMissingBranch.code);
            expect(JSON.stringify(viaMissingBranch)).not.toContain(synthetic);
        });

        // Classifying is a recoverable path: the evidence read degrades to `auth_unavailable`.
        // A malformed claim must not raise out of the classifier and make the failure fatal.
        it('survives a missing list that is an array only when it is checked', () => {
            let reads = 0;
            const arrayThenNull = new GitHubEvidenceAuthError('boom', {
                code: 'partial_configuration',
                get missing() {
                    reads += 1;
                    return (reads === 1 ? ['GITHUB_APP_ID'] : null) as never;
                },
            });

            expect(githubEvidenceAuthDiagnostic(arrayThenNull)).toEqual({
                code: 'partial_configuration',
                missing: ['GITHUB_APP_ID'],
            });

            // The inverse: what the type guard rejected is what the filter must see.
            let inverseReads = 0;
            const stringThenArray = new GitHubEvidenceAuthError('boom', {
                code: 'partial_configuration',
                get missing() {
                    inverseReads += 1;
                    return (inverseReads === 1 ? '10.1.2.3' : ['GITHUB_APP_ID']) as never;
                },
            });

            expect(githubEvidenceAuthDiagnostic(stringThenArray)).toEqual({
                code: 'auth_unavailable',
            });
        });

        it('falls back to the generic category for an error carrying no diagnostic', () => {
            expect(githubEvidenceAuthDiagnostic(new GitHubEvidenceAuthError('boom'))).toEqual({
                code: 'auth_unavailable',
            });
            expect(githubEvidenceAuthDiagnostic(new TypeError('not a credential failure'))).toEqual(
                { code: 'auth_unavailable' },
            );
            expect(githubEvidenceAuthDiagnostic('ghs_syntheticplaceholdertoken')).toEqual({
                code: 'auth_unavailable',
            });
        });
    });

    describe('investigation cancellation', () => {
        /** A token source that never settles, standing in for a stalled exchange. */
        function stalled() {
            const { create, auth } = fakeAppAuth(() => new Promise<{ token: string }>(() => {}));
            return { create, auth, resolver: githubEvidenceAuthFromEnv(CREDENTIALS, create) };
        }

        it('rejects an unresolved authorization once the investigation signal aborts', async () => {
            const { resolver } = stalled();
            const controller = new AbortController();
            const reason = new DOMException('Investigation deadline', 'TimeoutError');
            const headers = githubEvidenceHeaders(resolver, controller.signal);
            controller.abort(reason);
            await expect(headers).rejects.toBe(reason);
        });

        it('makes cancellation terminal rather than a recoverable auth failure', async () => {
            const { resolver } = stalled();
            const controller = new AbortController();
            const reason = new DOMException('Investigation deadline', 'TimeoutError');
            const headers = githubEvidenceHeaders(resolver, controller.signal);
            controller.abort(reason);
            const error = await headers.catch((caught: unknown) => caught);
            expect(error).not.toBeInstanceOf(GitHubEvidenceAuthError);
            expect((error as Error).name).toBe('TimeoutError');
        });

        it('never reaches the resolver at all when the signal is already aborted', async () => {
            const authorization = vi.fn(async () => `Bearer ${TOKEN}`);
            const controller = new AbortController();
            controller.abort(new DOMException('Already over', 'TimeoutError'));
            await expect(
                githubEvidenceHeaders({ authorization }, controller.signal),
            ).rejects.toHaveProperty('name', 'TimeoutError');
            expect(authorization).not.toHaveBeenCalled();
        });

        it('rejects when the deadline lands while the exchange is being opened', async () => {
            const controller = new AbortController();
            const reason = new DOMException('Investigation deadline', 'TimeoutError');
            // Aborts synchronously, before the race can subscribe. No abort event follows,
            // so only reading the signal's settled state can end this wait.
            const authorization = vi.fn(() => {
                controller.abort(reason);
                return new Promise<string>(() => {});
            });
            await expect(githubEvidenceHeaders({ authorization }, controller.signal)).rejects.toBe(
                reason,
            );
        });

        it('does no credential work when the signal is already aborted', async () => {
            const { create, auth, resolver } = stalled();
            const controller = new AbortController();
            controller.abort(new DOMException('Already over', 'TimeoutError'));
            await expect(githubEvidenceHeaders(resolver, controller.signal)).rejects.toThrow();
            await expect(resolver.authorization(controller.signal)).rejects.toThrow();
            expect(create).not.toHaveBeenCalled();
            expect(auth).not.toHaveBeenCalled();
        });

        it.each([
            { name: 'success', onAuth: async () => ({ token: TOKEN }) },
            { name: 'failure', onAuth: () => Promise.reject(new Error('exchange refused')) },
        ])('drops its abort listener when authorization settles: $name', async ({ onAuth }) => {
            const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, fakeAppAuth(onAuth).create);
            const controller = new AbortController();
            const added = vi.spyOn(controller.signal, 'addEventListener');
            const removed = vi.spyOn(controller.signal, 'removeEventListener');
            await githubEvidenceHeaders(resolver, controller.signal).catch(() => undefined);
            expect(added).toHaveBeenCalledTimes(1);
            expect(removed).toHaveBeenCalledTimes(1);
            expect(removed.mock.calls[0]?.[1]).toBe(added.mock.calls[0]?.[1]);
        });

        it('leaves the shared exchange running so a concurrent investigation still gets its token', async () => {
            let settle: (value: { token: string }) => void = () => {};
            const { create, auth } = fakeAppAuth(
                () => new Promise<{ token: string }>((resolve) => (settle = resolve)),
            );
            const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
            const abandoned = new AbortController();
            const patient = new AbortController();

            const first = githubEvidenceHeaders(resolver, abandoned.signal);
            const second = githubEvidenceHeaders(resolver, patient.signal);
            abandoned.abort(new DOMException('Investigation deadline', 'TimeoutError'));

            await expect(first).rejects.toHaveProperty('name', 'TimeoutError');
            settle({ token: TOKEN });
            // One investigation giving up must not cancel the credential the other needs.
            await expect(second).resolves.toEqual({
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${TOKEN}`,
            });
            expect(create).toHaveBeenCalledTimes(1);
            expect(auth).toHaveBeenCalledTimes(2);
        });

        it('does not leave a late exchange rejection unhandled after the caller gave up', async () => {
            let fail: (error: Error) => void = () => {};
            const resolver = githubEvidenceAuthFromEnv(
                CREDENTIALS,
                fakeAppAuth(() => new Promise<{ token: string }>((_, reject) => (fail = reject)))
                    .create,
            );
            const controller = new AbortController();
            const unhandled: unknown[] = [];
            const record = (reason: unknown) => unhandled.push(reason);
            process.on('unhandledRejection', record);
            try {
                const headers = githubEvidenceHeaders(resolver, controller.signal);
                controller.abort(new DOMException('Investigation deadline', 'TimeoutError'));
                await expect(headers).rejects.toThrow();
                fail(new Error('exchange refused after the caller left'));
                await new Promise((resolve) => setTimeout(resolve, 10));
            } finally {
                process.off('unhandledRejection', record);
            }
            expect(unhandled).toEqual([]);
        });
    });
});

describe('GitHub evidence authentication: tokens GitHub will not accept', () => {
    /** A planned exchange result, or one the test settles later to hold the exchange in flight. */
    type PlannedExchange = { token: unknown } | Promise<{ token: unknown }>;

    /**
     * Stands in for `createAppAuth` as it actually behaves: each strategy exchanges once and then
     * serves that same result from its own cache, malformed or not. Every exchange mints a
     * distinct token, so a resolver that kept a strategy past a bad result, or past an
     * invalidation, hands back the earlier bearer instead of a fresh one.
     */
    function cachingAppAuth(planned: PlannedExchange[] = []) {
        let exchanges = 0;
        const exchange = vi.fn(async (): Promise<{ token: unknown }> => {
            exchanges += 1;
            return (await planned.shift()) ?? { token: `ghs_syntheticexchange${exchanges}` };
        });
        const create = vi.fn<InstallationTokenFactory>(() => {
            let cached: Promise<{ token: string }> | undefined;
            return () => (cached ??= exchange() as Promise<{ token: string }>);
        });
        return { create, exchange };
    }
    const bearer = (exchange: number) => `Bearer ghs_syntheticexchange${exchange}`;

    // `@octokit/request` hands back `""` as the data of a 2xx whose body it could not read, and
    // `@octokit/auth-app` destructures that into `token: undefined`, returns it as a success and
    // caches it — after which every cache hit reads back `""`.
    const MALFORMED = [
        { name: 'no token at all', token: undefined },
        { name: 'an empty token', token: '' },
        { name: 'a token no header can carry', token: 'ghs_syntheticexchange1\r\nX-Injected: 1' },
    ];

    it.each(MALFORMED)('rejects a 2xx exchange that yielded $name', async ({ token }) => {
        const { create } = cachingAppAuth([{ token }]);
        const error = await githubEvidenceAuthFromEnv(CREDENTIALS, create)
            .authorization()
            .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(GitHubEvidenceAuthError);
        expect((error as GitHubEvidenceAuthError).diagnostic).toEqual({
            code: 'token_exchange_failed',
        });
        expect(githubEvidenceAuthDiagnostic(error)).toEqual({ code: 'token_exchange_failed' });
        const rendered = `${(error as Error).message} ${(error as Error).stack ?? ''} ${JSON.stringify(error)}`;
        expect(rendered).not.toContain('ghs_synthetic');
        expect(rendered).not.toContain('placeholder');
    });

    it.each(MALFORMED)(
        'rebuilds the strategy after an exchange that yielded $name and serves the next healthy token',
        async ({ token }) => {
            const { create, exchange } = cachingAppAuth([{ token }]);
            const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
            await expect(resolver.authorization()).rejects.toBeInstanceOf(GitHubEvidenceAuthError);
            // The next investigation is handed this same resolver, and it must exchange again
            // rather than read the bad result back out of the strategy's cache.
            expect(await githubEvidenceAuthFromEnv(CREDENTIALS, create).authorization()).toBe(
                bearer(2),
            );
            expect(create).toHaveBeenCalledTimes(2);
            expect(exchange).toHaveBeenCalledTimes(2);
            // A usable token is kept: recovering must not cost an exchange per request.
            expect(await resolver.authorization()).toBe(bearer(2));
            expect(create).toHaveBeenCalledTimes(2);
            expect(exchange).toHaveBeenCalledTimes(2);
        },
    );

    it('drops the strategy on invalidate, so the next call exchanges for a fresh token', async () => {
        const { create, exchange } = cachingAppAuth();
        const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        expect(await resolver.authorization()).toBe(bearer(1));
        expect(await resolver.authorization()).toBe(bearer(1));
        expect(resolver.invalidate).toBeTypeOf('function');
        resolver.invalidate?.();
        expect(await resolver.authorization()).toBe(bearer(2));
        expect(create).toHaveBeenCalledTimes(2);
        expect(exchange).toHaveBeenCalledTimes(2);
    });

    it('still settles a caller that was awaiting its token when another investigation invalidated', async () => {
        let settle: (value: { token: unknown }) => void = () => {};
        const { create, exchange } = cachingAppAuth([
            new Promise<{ token: unknown }>((resolve) => (settle = resolve)),
        ]);
        const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        const waiting = resolver.authorization();
        resolver.invalidate?.();
        const replacement = resolver.authorization();
        settle({ token: 'ghs_syntheticexchange1' });
        expect(await waiting).toBe(bearer(1));
        expect(await replacement).toBe(bearer(2));
        // The strategy built after the invalidation is the one every later caller shares.
        expect(await resolver.authorization()).toBe(bearer(2));
        expect(create).toHaveBeenCalledTimes(2);
        expect(exchange).toHaveBeenCalledTimes(2);
    });

    it('does not let a bad exchange that was already in flight discard the strategy that replaced it', async () => {
        let settle: (value: { token: unknown }) => void = () => {};
        const { create } = cachingAppAuth([
            new Promise<{ token: unknown }>((resolve) => (settle = resolve)),
        ]);
        const resolver = githubEvidenceAuthFromEnv(CREDENTIALS, create);
        const stale = resolver.authorization();
        resolver.invalidate?.();
        const replacement = resolver.authorization();
        settle({ token: undefined });
        await expect(stale).rejects.toBeInstanceOf(GitHubEvidenceAuthError);
        expect(await replacement).toBe(bearer(2));
        expect(await resolver.authorization()).toBe(bearer(2));
        expect(create).toHaveBeenCalledTimes(2);
    });

    // `undefined` is the only value that means "read anonymously". Anything else a resolver hands
    // back is a credential it failed to produce, and must not quietly become an anonymous read.
    it.each([
        { name: 'an empty string', value: '' },
        { name: 'null', value: null },
    ])(
        'refuses a resolver that resolves to $name instead of reading anonymously',
        async ({ value }) => {
            await expect(
                githubEvidenceHeaders({ authorization: async () => value as never }),
            ).rejects.toBeInstanceOf(GitHubEvidenceAuthError);
        },
    );
});
