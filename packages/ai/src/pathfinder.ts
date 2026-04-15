import type { SearchResult, PathfinderQuery } from './types.js';
import { config } from './config.js';

/**
 * Pathfinder MCP client for CopilotKit documentation retrieval.
 *
 * Connects to the Pathfinder MCP server at mcp.copilotkit.ai using SSE transport.
 * Manages sessions with 30-min TTL, reconnects on failure, and falls back to
 * plain-text docs search when MCP is unavailable.
 */
export class PathfinderClient {
    private mcpUrl: string;
    private sessionId: string | null = null;
    private sessionCreatedAt: number = 0;
    private connected: boolean = false;
    private connecting: Promise<void> | null = null;

    constructor(mcpUrl?: string) {
        this.mcpUrl = mcpUrl ?? config.pathfinderMcpUrl;
    }

    /**
     * Initialize the MCP session. Reuses existing session if still valid.
     */
    async connect(): Promise<void> {
        if (this.connected && !this.isSessionExpired()) {
            return;
        }

        // Deduplicate concurrent connect calls
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
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            config.pathfinder.requestTimeoutMs,
        );

        try {
            // Initialize MCP session via SSE endpoint
            const response = await fetch(`${this.mcpUrl}/sse`, {
                method: 'GET',
                headers: {
                    'Accept': 'text/event-stream',
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`MCP connection failed: ${response.status} ${response.statusText}`);
            }

            // Parse the session endpoint from the SSE stream
            const text = await response.text();
            const endpointMatch = text.match(/endpoint[=:]\s*([^\s\n]+)/);
            if (endpointMatch) {
                this.sessionId = endpointMatch[1];
            } else {
                // Use the base URL as message endpoint
                this.sessionId = `${this.mcpUrl}/message`;
            }

            this.sessionCreatedAt = Date.now();
            this.connected = true;
        } catch (error) {
            this.connected = false;
            this.sessionId = null;
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Check if the current session has expired or needs refresh.
     */
    private isSessionExpired(): boolean {
        if (!this.sessionId) return true;
        const elapsed = Date.now() - this.sessionCreatedAt;
        return elapsed >= (config.pathfinder.sessionTtlMs - config.pathfinder.refreshBeforeExpiryMs);
    }

    /**
     * Call an MCP tool on the Pathfinder server.
     */
    private async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
        await this.connect();

        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            config.pathfinder.requestTimeoutMs,
        );

        try {
            const endpoint = this.sessionId ?? `${this.mcpUrl}/message`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'tools/call',
                    params: {
                        name: toolName,
                        arguments: args,
                    },
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`MCP tool call failed: ${response.status} ${response.statusText}`);
            }

            const result = await response.json() as {
                result?: { content?: Array<{ text?: string }> };
                error?: { message: string };
            };

            if (result.error) {
                throw new Error(`MCP error: ${result.error.message}`);
            }

            return result.result;
        } catch (error) {
            // On connection failure, mark session as disconnected so next call reconnects
            if (error instanceof DOMException && error.name === 'AbortError') {
                this.connected = false;
                this.sessionId = null;
                throw new Error(`MCP tool call timed out after ${config.pathfinder.requestTimeoutMs}ms`);
            }
            this.connected = false;
            this.sessionId = null;
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Parse MCP tool result into SearchResult array.
     */
    private parseSearchResults(result: unknown): SearchResult[] {
        const typed = result as { content?: Array<{ text?: string }> } | undefined;
        if (!typed?.content?.length) return [];

        const text = typed.content
            .filter((c) => c.text)
            .map((c) => c.text)
            .join('\n');

        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                return parsed.map((item: Record<string, unknown>) => ({
                    title: String(item.title ?? item.name ?? 'Untitled'),
                    content: String(item.content ?? item.snippet ?? item.text ?? ''),
                    score: Number(item.similarity ?? item.score ?? item.relevance ?? 0),
                    sourceUrl: item.sourceUrl ? String(item.sourceUrl) : (item.url ? String(item.url) : undefined),
                    category: item.category ? String(item.category) : undefined,
                }));
            }
        } catch {
            // If not JSON, treat the text content as a single result
            return [{
                title: 'Pathfinder Result',
                content: text,
                score: 0.5,
            }];
        }

        return [];
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
            console.error(`[Pathfinder] searchDocs failed: ${error instanceof Error ? error.message : String(error)}`);
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
            console.error(`[Pathfinder] exploreDocs failed: ${error instanceof Error ? error.message : String(error)}`);
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
            console.error(`[Pathfinder] queryKnowledgeBase failed: ${error instanceof Error ? error.message : String(error)}`);
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
                return [];
            }

            const text = await response.text();
            return this.textSearch(text, query);
        } catch (error) {
            console.error(`[Pathfinder] Fallback search failed: ${error instanceof Error ? error.message : String(error)}`);
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

    /**
     * Disconnect and clean up the session.
     */
    disconnect(): void {
        this.connected = false;
        this.sessionId = null;
        this.sessionCreatedAt = 0;
    }
}
