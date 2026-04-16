import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIPipeline } from './pipeline.js';
import { ConfidenceLevel, TicketPriority, TicketType } from './types.js';
import type { SearchResult, GeneratedResponse } from './types.js';
import type { ConfidenceAssessment } from './confidence.js';

// Create mock instances
const mockSearchDocs = vi.fn();
const mockDisconnect = vi.fn();
const mockGenerate = vi.fn();
const mockGenerateStream = vi.fn();
const mockScore = vi.fn();
const mockHeuristicScore = vi.fn();
const mockClassify = vi.fn();
const mockHeuristicClassify = vi.fn();
const mockFormat = vi.fn();

function createPipeline() {
    return new AIPipeline({
        pathfinder: {
            searchDocs: mockSearchDocs,
            exploreDocs: vi.fn(),
            queryKnowledgeBase: vi.fn(),
            disconnect: mockDisconnect,
        } as never,
        generator: {
            generate: mockGenerate,
            generateStream: mockGenerateStream,
        } as never,
        confidenceScorer: {
            score: mockScore,
            heuristicScore: mockHeuristicScore,
        } as never,
        classifier: {
            classify: mockClassify,
            heuristicClassify: mockHeuristicClassify,
        } as never,
        formatter: {
            format: mockFormat,
        } as never,
    });
}

const sampleSearchResults: SearchResult[] = [
    { title: 'Actions', content: 'Guide to actions...', score: 0.9, sourceUrl: 'https://docs.copilotkit.ai/actions' },
    { title: 'Hooks', content: 'Guide to hooks...', score: 0.85 },
];

const sampleGeneratedResponse: GeneratedResponse = {
    text: 'Here is how to use CopilotKit actions...',
    confidence: 0.85,
    confidenceLevel: ConfidenceLevel.HIGH,
    sources: sampleSearchResults,
    autoSend: false,
    reasoning: 'Based on 2 sources',
    tokenUsage: { inputTokens: 500, outputTokens: 100 },
    latencyMs: 2000,
};

const sampleConfidence: ConfidenceAssessment = {
    level: ConfidenceLevel.HIGH,
    score: 0.88,
    reasoning: 'Good match',
    tokenUsage: { inputTokens: 200, outputTokens: 30 },
    degraded: false,
};

describe('AIPipeline', () => {
    let pipeline: AIPipeline;

    beforeEach(() => {
        vi.resetAllMocks();
        pipeline = createPipeline();

        // Set up defaults
        mockSearchDocs.mockResolvedValue(sampleSearchResults);
        mockGenerate.mockResolvedValue(sampleGeneratedResponse);
        mockScore.mockResolvedValue(sampleConfidence);
        mockFormat.mockReturnValue({
            text: 'Formatted response',
            truncated: false,
        });
    });

    describe('generateSupportResponse', () => {
        it('should run the full pipeline end-to-end', async () => {
            const result = await pipeline.generateSupportResponse(
                'How do I use CopilotKit actions?',
                { source: 'discord' },
            );

            expect(result.response).toBe('Here is how to use CopilotKit actions...');
            expect(result.formatted.text).toBe('Formatted response');
            expect(result.searchResults).toEqual(sampleSearchResults);
            expect(result.tokenUsage.inputTokens).toBe(700); // 500 + 200
            expect(result.tokenUsage.outputTokens).toBe(130); // 100 + 30
            expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        });

        it('should use the more conservative confidence score', async () => {
            // Generator says 0.85, scorer says 0.6 — should use 0.6
            mockScore.mockResolvedValue({
                ...sampleConfidence,
                score: 0.6,
                level: ConfidenceLevel.MEDIUM,
            });

            const result = await pipeline.generateSupportResponse(
                'test question',
                { source: 'discord' },
            );

            expect(result.confidenceScore).toBe(0.6);
            expect(result.confidence).toBe(ConfidenceLevel.MEDIUM);
        });

        it('should add disclaimer for non-HIGH confidence', async () => {
            mockScore.mockResolvedValue({
                ...sampleConfidence,
                score: 0.6,
                level: ConfidenceLevel.MEDIUM,
            });

            await pipeline.generateSupportResponse(
                'test question',
                { source: 'github' },
            );

            expect(mockFormat).toHaveBeenCalledWith(
                expect.any(String),
                'github',
                expect.objectContaining({
                    addDisclaimer: true,
                }),
            );
        });

        it('should not add disclaimer for HIGH confidence', async () => {
            await pipeline.generateSupportResponse(
                'test question',
                { source: 'discord' },
            );

            expect(mockFormat).toHaveBeenCalledWith(
                expect.any(String),
                'discord',
                expect.objectContaining({
                    addDisclaimer: false,
                }),
            );
        });

        it('should handle Pathfinder failure gracefully', async () => {
            mockSearchDocs.mockRejectedValueOnce(new Error('MCP down'));

            const result = await pipeline.generateSupportResponse(
                'test question',
                { source: 'web' },
            );

            // Should still return a result, just with empty search results
            expect(result.response).toBeDefined();
            expect(mockGenerate).toHaveBeenCalledWith(
                expect.any(Object),
                [], // Empty results after failure
                undefined,
            );
        });

        it('should handle confidence scoring failure gracefully', async () => {
            mockScore.mockRejectedValueOnce(new Error('Scorer error'));
            mockHeuristicScore.mockReturnValue({
                level: ConfidenceLevel.MEDIUM,
                score: 0.6,
                reasoning: 'Heuristic fallback',
                tokenUsage: { inputTokens: 0, outputTokens: 0 },
            });

            const result = await pipeline.generateSupportResponse(
                'test question',
                { source: 'discord' },
            );

            // Should use heuristic fallback
            expect(result.response).toBeDefined();
        });

        it('should pass conversation history to generator', async () => {
            const history = [
                { role: 'user' as const, content: 'What is CopilotKit?' },
                { role: 'assistant' as const, content: 'CopilotKit is...' },
            ];

            await pipeline.generateSupportResponse(
                'How about streaming?',
                { source: 'discord', conversationHistory: history },
            );

            expect(mockGenerate).toHaveBeenCalledWith(
                expect.any(Object),
                expect.any(Array),
                history,
            );
        });
    });

    describe('classifyTicket', () => {
        it('should classify a ticket', async () => {
            mockClassify.mockResolvedValue({
                priority: TicketPriority.HIGH,
                type: TicketType.BUG,
                tags: ['copilotkit-runtime'],
                reasoning: 'Error report',
                tokenUsage: { inputTokens: 80, outputTokens: 30 },
            });

            const result = await pipeline.classifyTicket(
                'Error: CopilotRuntime crashes on startup',
            );

            expect(result.priority).toBe(TicketPriority.HIGH);
            expect(result.type).toBe(TicketType.BUG);
        });

        it('should fall back to heuristic on failure', async () => {
            mockClassify.mockRejectedValueOnce(new Error('API error'));
            mockHeuristicClassify.mockReturnValue({
                priority: TicketPriority.HIGH,
                type: TicketType.BUG,
                tags: [],
                reasoning: 'Heuristic',
            });

            const result = await pipeline.classifyTicket(
                'Error: something broke',
            );

            expect(result.priority).toBe(TicketPriority.HIGH);
            expect(result.tokenUsage.inputTokens).toBe(0);
        });
    });

    describe('destroy', () => {
        it('should disconnect Pathfinder', () => {
            pipeline.destroy();
            expect(mockDisconnect).toHaveBeenCalled();
        });
    });
});
