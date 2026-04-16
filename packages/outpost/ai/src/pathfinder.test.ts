import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PathfinderClient } from './pathfinder.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('PathfinderClient', () => {
    let client: PathfinderClient;

    beforeEach(() => {
        client = new PathfinderClient('https://test-mcp.example.com');
        mockFetch.mockReset();
    });

    afterEach(() => {
        client.disconnect();
    });

    describe('connect', () => {
        it('should establish an MCP session via SSE', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () => 'event: endpoint\ndata: endpoint=/message/session-123\n\n',
            });

            await client.connect();
            expect(mockFetch).toHaveBeenCalledWith(
                'https://test-mcp.example.com/sse',
                expect.objectContaining({
                    method: 'GET',
                    headers: { Accept: 'text/event-stream' },
                }),
            );
        });

        it('should reuse existing session on subsequent calls', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () => 'endpoint=/message/session-123',
            });

            await client.connect();
            await client.connect();

            // Only one SSE call
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });

        it('should throw on connection failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
            });

            await expect(client.connect()).rejects.toThrow('MCP connection failed');
        });
    });

    describe('searchDocs', () => {
        it('should call search-docs tool and parse results', async () => {
            // Connect first
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () => 'endpoint=https://test-mcp.example.com/message',
            });

            // Tool call response
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    result: {
                        content: [{
                            text: JSON.stringify([
                                {
                                    title: 'CopilotKit Actions',
                                    content: 'useCopilotAction lets you define actions...',
                                    similarity: 0.92,
                                    url: 'https://docs.copilotkit.ai/actions',
                                },
                                {
                                    title: 'Getting Started',
                                    content: 'Install CopilotKit with npm install...',
                                    similarity: 0.85,
                                    url: 'https://docs.copilotkit.ai/quickstart',
                                },
                            ]),
                        }],
                    },
                }),
            });

            const results = await client.searchDocs({ query: 'how to use actions' });

            expect(results).toHaveLength(2);
            expect(results[0].title).toBe('CopilotKit Actions');
            expect(results[0].score).toBe(0.92);
            expect(results[0].sourceUrl).toBe('https://docs.copilotkit.ai/actions');
        });

        it('should fall back to text search when MCP fails', async () => {
            // Connection fails
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            });

            // Fallback docs fetch
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () => '## Getting Started\nCopilotKit is a framework for building AI copilots.\n\n## Actions\nuseCopilotAction allows defining custom actions for the copilot.',
            });

            const results = await client.searchDocs({ query: 'actions copilot' });

            expect(results.length).toBeGreaterThan(0);
            // Fallback results should have titles from headings
            expect(results.some((r) => r.title.includes('Actions'))).toBe(true);
        });

        it('should return empty array when both MCP and fallback fail', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Error',
            });

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Error',
            });

            const results = await client.searchDocs({ query: 'anything' });
            expect(results).toEqual([]);
        });
    });

    describe('exploreDocs', () => {
        it('should call explore-docs tool', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () => 'endpoint=https://test-mcp.example.com/message',
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    result: {
                        content: [{
                            text: JSON.stringify([
                                { title: '/docs', content: 'Documentation root', similarity: 1.0 },
                            ]),
                        }],
                    },
                }),
            });

            const results = await client.exploreDocs('ls /');
            expect(results).toHaveLength(1);
            expect(results[0].title).toBe('/docs');
        });

        it('should return empty array on failure', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Error',
            });

            const results = await client.exploreDocs('ls /');
            expect(results).toEqual([]);
        });
    });

    describe('queryKnowledgeBase', () => {
        it('should call knowledge-base tool', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () => 'endpoint=https://test-mcp.example.com/message',
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    result: {
                        content: [{
                            text: JSON.stringify([
                                { title: 'FAQ: Setup', content: 'How to set up CopilotKit...', score: 0.9 },
                            ]),
                        }],
                    },
                }),
            });

            const results = await client.queryKnowledgeBase('setup');
            expect(results).toHaveLength(1);
        });
    });

    describe('disconnect', () => {
        it('should clear session state', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () => 'endpoint=https://test-mcp.example.com/message',
            });

            await client.connect();
            client.disconnect();

            // Next call should reconnect
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () => 'endpoint=https://test-mcp.example.com/message',
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    result: { content: [{ text: '[]' }] },
                }),
            });

            await client.searchDocs({ query: 'test' });
            // Should have made 3 fetch calls total (connect, reconnect, search)
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });
    });
});
