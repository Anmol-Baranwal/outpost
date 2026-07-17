import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PathfinderClient } from './pathfinder.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BASE = 'https://test-mcp.example.com';
const MCP = `${BASE}/mcp`;

/** Build a minimal fetch Response-like object. */
function mkResp(opts: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    body?: string;
    sessionId?: string | null;
}) {
    const { ok = true, status = 200, statusText = 'OK', body = '', sessionId = null } = opts;
    return {
        ok,
        status,
        statusText,
        text: async () => body,
        headers: {
            get: (k: string) => (k.toLowerCase() === 'mcp-session-id' ? sessionId : null),
        },
    };
}

function jsonRpc(result: unknown, id = 1): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result });
}

/** initialize (with session header) + initialized notification responses. */
function mockConnect(sessionId = 'sess-123') {
    mockFetch.mockResolvedValueOnce(
        mkResp({ body: jsonRpc({ protocolVersion: '2024-11-05', capabilities: {} }), sessionId }),
    );
    mockFetch.mockResolvedValueOnce(mkResp({ body: '' })); // notifications/initialized
}

describe('PathfinderClient', () => {
    let client: PathfinderClient;

    beforeEach(() => {
        client = new PathfinderClient(BASE);
        mockFetch.mockReset();
    });

    afterEach(() => {
        client.disconnect();
    });

    describe('connect', () => {
        it('initializes an MCP session via POST /mcp and captures the session header', async () => {
            mockConnect('sess-abc');

            await client.connect();

            const [url, init] = mockFetch.mock.calls[0];
            expect(url).toBe(MCP);
            expect(init.method).toBe('POST');
            expect(String(init.body)).toContain('"method":"initialize"');
        });

        it('reuses the existing session on subsequent connect calls', async () => {
            mockConnect();

            await client.connect();
            await client.connect();

            const initCalls = mockFetch.mock.calls.filter(([, init]) =>
                String(init.body).includes('"method":"initialize"'),
            );
            expect(initCalls).toHaveLength(1);
        });

        it('throws when the initialize request is not ok', async () => {
            mockFetch.mockResolvedValueOnce(
                mkResp({ ok: false, status: 503, statusText: 'Service Unavailable' }),
            );

            await expect(client.connect()).rejects.toThrow('MCP request failed');
        });

        it('throws when the server returns no session id', async () => {
            mockFetch.mockResolvedValueOnce(mkResp({ body: jsonRpc({}), sessionId: null }));

            await expect(client.connect()).rejects.toThrow('did not return a session id');
        });

        it('surfaces a clear timeout error when the request aborts', async () => {
            mockFetch.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));

            await expect(client.connect()).rejects.toThrow('timed out');
        });
    });

    describe('searchDocs', () => {
        it('parses the SNIPPET/TITLE/SOURCE/CONTENT text format', async () => {
            mockConnect();
            mockFetch.mockResolvedValueOnce(
                mkResp({
                    body: jsonRpc(
                        {
                            content: [
                                {
                                    type: 'text',
                                    text:
                                        'SNIPPET 1\nTITLE: CopilotKit Actions\nSOURCE: https://docs.copilotkit.ai/actions\nCONTENT:\nuseCopilotAction lets you define actions.\n\n---\n\nSNIPPET 2\nTITLE: Getting Started\nSOURCE: https://docs.copilotkit.ai/quickstart\nCONTENT:\nInstall CopilotKit with npm install.',
                                },
                            ],
                        },
                        2,
                    ),
                }),
            );

            const results = await client.searchDocs({ query: 'how to use actions' });

            expect(results).toHaveLength(2);
            expect(results[0].title).toBe('CopilotKit Actions');
            expect(results[0].sourceUrl).toBe('https://docs.copilotkit.ai/actions');
            expect(results[0].content).toContain('useCopilotAction');
            // Synthetic descending rank score (no numeric score in the text format).
            expect(results[0].score).toBeGreaterThan(results[1].score);

            // tools/call POST carries the session header + correct tool name.
            const toolCall = mockFetch.mock.calls[2];
            expect(toolCall[1].headers['Mcp-Session-Id']).toBe('sess-123');
            expect(String(toolCall[1].body)).toContain('"name":"search-docs"');
        });

        it('still parses the legacy JSON-array format', async () => {
            mockConnect();
            mockFetch.mockResolvedValueOnce(
                mkResp({
                    body: jsonRpc(
                        {
                            content: [
                                {
                                    text: JSON.stringify([
                                        {
                                            title: 'Actions',
                                            content: 'useCopilotAction...',
                                            similarity: 0.92,
                                            url: 'https://docs.copilotkit.ai/actions',
                                        },
                                    ]),
                                },
                            ],
                        },
                        2,
                    ),
                }),
            );

            const results = await client.searchDocs({ query: 'actions' });
            expect(results).toHaveLength(1);
            expect(results[0].score).toBe(0.92);
            expect(results[0].sourceUrl).toBe('https://docs.copilotkit.ai/actions');
        });

        it('parses an SSE-framed JSON-RPC reply (data: ...)', async () => {
            mockConnect();
            mockFetch.mockResolvedValueOnce(
                mkResp({
                    body:
                        'event: message\n' +
                        `data: ${jsonRpc({ content: [{ type: 'text', text: 'SNIPPET 1\nTITLE: X\nSOURCE: https://x\nCONTENT:\nhello' }] }, 2)}\n\n`,
                }),
            );

            const results = await client.searchDocs({ query: 'x' });
            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('X');
        });

        it('falls back to text search when the tool call fails', async () => {
            mockConnect();
            mockFetch.mockResolvedValueOnce(
                mkResp({ ok: false, status: 500, statusText: 'Internal Server Error' }),
            );
            // fallback docs fetch
            mockFetch.mockResolvedValueOnce(
                mkResp({
                    body: '## Getting Started\nCopilotKit is a framework for building AI copilots.\n\n## Actions\nuseCopilotAction allows defining custom actions for the copilot.',
                }),
            );

            const results = await client.searchDocs({ query: 'actions copilot' });
            expect(results.length).toBeGreaterThan(0);
            expect(results.some((r) => r.title.includes('Actions'))).toBe(true);
        });

        it('returns empty when both MCP and fallback fail', async () => {
            mockConnect();
            mockFetch.mockResolvedValueOnce(mkResp({ ok: false, status: 500, statusText: 'Error' }));
            mockFetch.mockResolvedValueOnce(mkResp({ ok: false, status: 500, statusText: 'Error' }));

            const results = await client.searchDocs({ query: 'anything' });
            expect(results).toEqual([]);
        });
    });

    describe('disconnect', () => {
        it('clears session state so the next call reconnects', async () => {
            mockConnect();
            await client.connect();
            client.disconnect();

            // Next searchDocs must re-initialize.
            mockConnect();
            mockFetch.mockResolvedValueOnce(
                mkResp({ body: jsonRpc({ content: [{ text: '[]' }] }, 2) }),
            );

            await client.searchDocs({ query: 'test' });

            const initCalls = mockFetch.mock.calls.filter(([, init]) =>
                String(init.body).includes('"method":"initialize"'),
            );
            expect(initCalls).toHaveLength(2); // one per connect (before + after disconnect)
        });
    });
});
