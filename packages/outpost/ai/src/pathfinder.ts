import type { SearchResult, PathfinderQuery } from './types.js';
import { config } from './config.js';

/**
 * Pathfinder MCP client for CopilotKit documentation retrieval.
 *
 * Uses the MCP **Streamable HTTP** transport: a single `POST {mcpUrl}/mcp`
 * endpoint. The session id is returned in the `Mcp-Session-Id` response header
 * on `initialize` and echoed on every subsequent request.
 *
 * NOTE: the server also exposes a legacy SSE endpoint (`GET {mcpUrl}/sse`), but
 * that is a long-lived `text/event-stream` — reading it to completion blocks
 * until the request timeout aborts ("This operation was aborted"), so it is NOT
 * used. Streamable-HTTP replies are finite and close immediately, so reading the
 * body never hangs.
 *
 * Falls back to a plain-text docs search when MCP is unavailable.
 */
export class PathfinderClient {
    private readonly endpoint: string;
    private sessionId: string | null = null;
    private sessionCreatedAt = 0;
    private connecting: Promise<void> | null = null;
    private nextId = 1;

    constructor(mcpUrl?: string) {
        const base = mcpUrl ?? config.pathfinderMcpUrl;
        this.endpoint = `${base}/mcp`;
    }

    /**
     * Initialize the MCP session. Reuses an existing session while it is valid.
     */
    async connect(): Promise<void> {
        if (this.sessionId && !this.isSessionExpired()) {
            return;
        }
        // Deduplicate concurrent connect calls.
        if (this.connecting) {
            return this.connecting;
        }
        this.connecting = this.doConnect();
        try {
            await this.connecting;
        } finally {
            this.connecting = null;
        }
    }

    private async doConnect(): Promise<void> {
        // Clear any stale session before (re-)initializing: `initialize` is what
        // mints a session, so it must not carry an old `Mcp-Session-Id` (a server
        // MAY answer a terminated id with 404). Resetting up front also means a
        // throwing re-init leaves clean state instead of a dead session id that
        // would fall back forever.
        this.reset();

        const { body, sessionId } = await this.post({
            jsonrpc: '2.0',
            id: this.nextId++,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'outpost', version: '1.0.0' },
            },
        });

        const parsed = this.parseJsonRpc(body);
        if (parsed.error) {
            this.reset();
            throw new Error(`MCP connection failed: ${parsed.error.message}`);
        }
        if (!sessionId) {
            this.reset();
            throw new Error('MCP connection failed: server did not return a session id');
        }

        this.sessionId = sessionId;
        this.sessionCreatedAt = Date.now();

        // Best-effort "initialized" notification — the session is already usable,
        // so a failure here is non-fatal.
        try {
            await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        } catch {
            // ignore
        }
    }

    /**
     * Check if the current session has expired or needs refresh.
     */
    private isSessionExpired(): boolean {
        if (!this.sessionId) return true;
        const elapsed = Date.now() - this.sessionCreatedAt;
        return elapsed >= config.pathfinder.sessionTtlMs - config.pathfinder.refreshBeforeExpiryMs;
    }

    /**
     * POST a JSON-RPC message to the Streamable-HTTP endpoint with a hard
     * timeout. Returns the raw body text and the `Mcp-Session-Id` response
     * header (present on `initialize`).
     */
    private async post(
        message: Record<string, unknown>,
    ): Promise<{ body: string; sessionId: string | null }> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.pathfinder.requestTimeoutMs);

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
            };
            if (this.sessionId) {
                headers['Mcp-Session-Id'] = this.sessionId;
            }

            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(message),
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
            }

            // Safe to read to completion: Streamable-HTTP replies are finite.
            const body = await response.text();
            return { body, sessionId: response.headers.get('mcp-session-id') };
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new Error(
                    `MCP request timed out after ${config.pathfinder.requestTimeoutMs}ms`,
                );
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Parse a JSON-RPC reply body. Streamable HTTP may return either a plain
     * JSON object or an SSE-framed reply (`data: {...}`) that closes immediately;
     * handle both.
     */
    private parseJsonRpc(body: string): { result?: unknown; error?: { message: string } } {
        const trimmed = body.trim();
        if (!trimmed) return {};

        if (!trimmed.startsWith('{')) {
            const data = trimmed
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice('data:'.length).trim())
                .join('');
            if (data) {
                return JSON.parse(data) as { result?: unknown; error?: { message: string } };
            }
        }

        return JSON.parse(trimmed) as { result?: unknown; error?: { message: string } };
    }

    /**
     * Call an MCP tool on the Pathfinder server.
     */
    private async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
        await this.connect();

        let body: string;
        try {
            ({ body } = await this.post({
                jsonrpc: '2.0',
                id: this.nextId++,
                method: 'tools/call',
                params: {
                    name: toolName,
                    arguments: args,
                },
            }));
        } catch (error) {
            // Force a fresh session on the next call after any transport failure.
            this.reset();
            throw error;
        }

        const parsed = this.parseJsonRpc(body);
        if (parsed.error) {
            this.reset();
            throw new Error(`MCP error: ${parsed.error.message}`);
        }
        return parsed.result;
    }

    /**
     * Parse an MCP tool result into a SearchResult array.
     *
     * The current `copilotkit-docs-mcp` server returns content as text blocks:
     *
     *   SNIPPET 1
     *   TITLE: ...
     *   SOURCE: ...
     *   CONTENT:
     *   ...
     *   ---
     *   SNIPPET 2
     *   ...
     *
     * An older format returned a JSON array; both are supported.
     */
    private parseSearchResults(result: unknown): SearchResult[] {
        const typed = result as { content?: Array<{ text?: string }> } | undefined;
        if (!typed?.content?.length) return [];

        const text = typed.content
            .filter((c) => c.text)
            .map((c) => c.text)
            .join('\n');

        if (!text.trim()) return [];

        // Legacy JSON-array format.
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                return parsed.map((item: Record<string, unknown>) => ({
                    title: String(item.title ?? item.name ?? 'Untitled'),
                    content: String(item.content ?? item.snippet ?? item.text ?? ''),
                    score: Number(item.similarity ?? item.score ?? item.relevance ?? 0),
                    sourceUrl: item.sourceUrl
                        ? String(item.sourceUrl)
                        : item.url
                          ? String(item.url)
                          : undefined,
                    category: item.category ? String(item.category) : undefined,
                }));
            }
        } catch {
            // Not JSON — fall through to SNIPPET parsing.
        }

        return this.parseSnippets(text);
    }

    /**
     * Parse the SNIPPET/TITLE/SOURCE/CONTENT text format. The MCP text format
     * carries no numeric relevance score, so a descending rank score is
     * synthesized (results are already server-filtered by min_score) to give
     * the confidence heuristic a usable signal.
     */
    private parseSnippets(text: string): SearchResult[] {
        // Split on the structural "SNIPPET <n>" marker rather than the "---"
        // separator: doc content itself commonly contains a "---" horizontal
        // rule, and splitting on that would truncate the snippet at the rule.
        // The "SNIPPET <n>" header never appears inside content.
        const blocks = text
            .split(/^SNIPPET\s+\d+\s*$/im)
            .map((b) => b.trim())
            .filter((b) => /TITLE:/i.test(b));

        return blocks.map((block, i) => {
            const title = block.match(/TITLE:\s*(.+)/i)?.[1]?.trim() ?? 'Documentation';
            const source = block.match(/SOURCE:\s*(.+)/i)?.[1]?.trim();
            const contentMatch = block.match(/CONTENT:\s*([\s\S]*)$/i);
            const content = (contentMatch ? contentMatch[1] : block)
                // Strip the trailing "---" separator that precedes the next snippet.
                .replace(/\n\s*-{3,}\s*$/, '')
                .trim();

            return {
                title,
                content,
                score: Math.max(0.5, 1 - i * 0.05),
                sourceUrl: source || undefined,
                category: undefined,
            };
        });
    }

    /**
     * Search documentation using Pathfinder's semantic search.
     */
    async searchDocs(query: PathfinderQuery): Promise<SearchResult[]> {
        try {
            const result = await this.callTool('search-docs', {
                query: query.query,
                limit: query.limit ?? config.pathfinder.defaultLimit,
                min_score: query.minScore ?? config.pathfinder.defaultMinScore,
            });
            return this.parseSearchResults(result);
        } catch (error) {
            console.error(
                `[Pathfinder] searchDocs failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return this.fallbackSearch(query.query);
        }
    }

    /**
     * Explore documentation tree structure.
     */
    async exploreDocs(command: string): Promise<SearchResult[]> {
        try {
            const result = await this.callTool('explore-docs', { command });
            return this.parseSearchResults(result);
        } catch (error) {
            console.error(
                `[Pathfinder] exploreDocs failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return [];
        }
    }

    /**
     * Query the knowledge base for FAQ retrieval.
     */
    async queryKnowledgeBase(query?: string): Promise<SearchResult[]> {
        try {
            const result = await this.callTool('knowledge-base', {
                query: query ?? '',
            });
            return this.parseSearchResults(result);
        } catch (error) {
            console.error(
                `[Pathfinder] queryKnowledgeBase failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return [];
        }
    }

    /**
     * Fallback: fetch /llms-full.txt and do basic text search when MCP is unavailable.
     */
    async fallbackSearch(query: string): Promise<SearchResult[]> {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(
                () => controller.abort(),
                config.pathfinder.requestTimeoutMs,
            );

            const response = await fetch(config.fallbackDocsUrl, {
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!response.ok) {
                console.error(
                    `[Pathfinder] Fallback docs fetch returned HTTP ${response.status} ${response.statusText}`,
                );
                return [];
            }

            const text = await response.text();
            return this.textSearch(text, query);
        } catch (error) {
            console.error(
                `[Pathfinder] Fallback search failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return [];
        }
    }

    /**
     * Simple text search over a large document. Splits by sections and scores
     * by keyword overlap.
     */
    private textSearch(document: string, query: string): SearchResult[] {
        const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (queryTerms.length === 0) return [];

        // Split document by headings (markdown ## or #)
        const sections = document.split(/(?=^#{1,3}\s)/m).filter((s) => s.trim().length > 50);

        const scored = sections.map((section) => {
            const lower = section.toLowerCase();
            const matchCount = queryTerms.filter((term) => lower.includes(term)).length;
            const score = matchCount / queryTerms.length;

            // Extract title from first line
            const firstLine = section.split('\n')[0].replace(/^#+\s*/, '').trim();

            return {
                title: firstLine || 'Documentation',
                content: section.slice(0, 1500),
                score,
                sourceUrl: undefined,
                category: undefined,
            };
        });

        return scored
            .filter((s) => s.score > 0.2)
            .sort((a, b) => b.score - a.score)
            .slice(0, config.pathfinder.defaultLimit);
    }

    private reset(): void {
        this.sessionId = null;
        this.sessionCreatedAt = 0;
    }

    /**
     * Disconnect and clean up the session.
     */
    disconnect(): void {
        this.reset();
    }
}
