import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { LLMock } from '@copilotkit/aimock';
import { TicketClassifier } from './classifier.js';
import { TicketPriority, TicketType } from './types.js';

// ─── aimock setup ───────────────────────────────────────────────────────────

let mock: LLMock;
let originalBaseUrl: string | undefined;

beforeAll(async () => {
    mock = new LLMock({ port: 0 });
    await mock.start();
    originalBaseUrl = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = mock.url;
});

afterAll(async () => {
    if (originalBaseUrl === undefined) {
        delete process.env.ANTHROPIC_BASE_URL;
    } else {
        process.env.ANTHROPIC_BASE_URL = originalBaseUrl;
    }
    await mock.stop();
});

beforeEach(() => {
    mock.reset();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TicketClassifier', () => {
    let classifier: TicketClassifier;

    beforeEach(() => {
        classifier = new TicketClassifier({ apiKey: 'test-key' });
    });

    describe('classify', () => {
        it('should classify an error report as HIGH priority ISSUE', async () => {
            mock.onMessage(/./, {
                content: JSON.stringify({
                    priority: 'HIGH',
                    type: 'BUG',
                    tags: ['copilotkit-runtime', 'typescript'],
                    reasoning: 'Error report with stack trace',
                }),
                usage: { input_tokens: 100, output_tokens: 40 },
            });

            const result = await classifier.classify(
                'TypeError: Cannot read properties of undefined. Getting this error when using CopilotRuntime with TypeScript.',
            );

            expect(result.priority).toBe(TicketPriority.HIGH);
            expect(result.type).toBe(TicketType.BUG);
            expect(result.tags).toContain('copilotkit-runtime');
            expect(result.tokenUsage.inputTokens).toBe(100);
        });

        it('should classify a how-to question as FEATURE_REQUEST type', async () => {
            mock.onMessage(/./, {
                content: JSON.stringify({
                    priority: 'LOW',
                    type: 'FEATURE_REQUEST',
                    tags: ['actions', 'next.js'],
                    reasoning: 'How-to question about setup',
                }),
                usage: { input_tokens: 80, output_tokens: 30 },
            });

            const result = await classifier.classify(
                'How do I set up useCopilotAction in my Next.js app?',
            );

            expect(result.type).toBe(TicketType.FEATURE_REQUEST);
        });

        it('should override to HIGH priority when heuristic detects errors', async () => {
            // Claude says MEDIUM, but heuristic should override to HIGH because of error keywords
            mock.onMessage(/./, {
                content: JSON.stringify({
                    priority: 'MEDIUM',
                    type: 'BUG',
                    tags: ['react-ui'],
                    reasoning: 'Minor rendering issue',
                }),
                usage: { input_tokens: 80, output_tokens: 30 },
            });

            const result = await classifier.classify(
                'Error: CopilotChat component crashes on render with TypeError',
            );

            // Heuristic HIGH should override Claude's MEDIUM
            expect(result.priority).toBe(TicketPriority.HIGH);
        });

        it('should merge tags from heuristic and Claude', async () => {
            mock.onMessage(/./, {
                content: JSON.stringify({
                    priority: 'MEDIUM',
                    type: 'BUG',
                    tags: ['performance', 'cloud'],
                    reasoning: 'Performance concern',
                }),
                usage: { input_tokens: 80, output_tokens: 30 },
            });

            const result = await classifier.classify(
                'The CopilotKit runtime is slow when deployed to cloud. Performance is terrible with LangChain integration.',
            );

            // Should have tags from both sources, deduplicated
            expect(result.tags).toContain('performance');
            expect(result.tags).toContain('cloud');
            // Heuristic should detect langchain
            expect(result.tags).toContain('langchain');
        });

        it('should fall back to heuristic on API failure', async () => {
            mock.nextRequestError(500, { message: 'API error' });

            const result = await classifier.classify(
                'Error: Cannot connect to CopilotKit runtime',
            );

            expect(result.priority).toBe(TicketPriority.HIGH); // Error keyword triggers HIGH
            expect(result.type).toBe(TicketType.BUG);
            expect(result.tokenUsage.inputTokens).toBe(0);
        });
    });

    describe('heuristicClassify', () => {
        it('should detect error messages as HIGH priority', () => {
            const result = classifier.heuristicClassify(
                'TypeError: Cannot read property of undefined',
            );
            expect(result.priority).toBe(TicketPriority.HIGH);
            expect(result.type).toBe(TicketType.BUG);
        });

        it('should detect feature requests as LOW priority', () => {
            const result = classifier.heuristicClassify(
                'Feature request: It would be nice to have dark mode in the chat widget',
            );
            expect(result.priority).toBe(TicketPriority.LOW);
            expect(result.type).toBe(TicketType.FEATURE_REQUEST);
        });

        it('should detect how-to questions as LOW priority FEATURE_REQUEST', () => {
            const result = classifier.heuristicClassify(
                'How do I configure authentication for my copilot?',
            );
            expect(result.priority).toBe(TicketPriority.LOW);
            expect(result.type).toBe(TicketType.FEATURE_REQUEST);
        });

        it('should detect CopilotKit-specific tags', () => {
            const result = classifier.heuristicClassify(
                'Issue with useCopilotAction hook in my Next.js app using LangGraph',
            );
            expect(result.tags).toContain('actions');
            expect(result.tags).toContain('hooks');
            expect(result.tags).toContain('next.js');
            expect(result.tags).toContain('langgraph');
        });

        it('should default to MEDIUM priority for ambiguous tickets', () => {
            const result = classifier.heuristicClassify(
                'I need help with my copilot configuration',
            );
            expect(result.priority).toBe(TicketPriority.MEDIUM);
        });
    });
});
