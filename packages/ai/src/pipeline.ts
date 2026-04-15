import type {
    PipelineContext,
    PipelineOptions,
    PipelineResult,
    TicketClassification,
    TokenUsage,
    SearchResult,
} from './types.js';
import { ConfidenceLevel } from './types.js';
import { PathfinderClient } from './pathfinder.js';
import { ResponseGenerator } from './generator.js';
import { ConfidenceScorer } from './confidence.js';
import { TicketClassifier } from './classifier.js';
import { ResponseFormatter } from './formatter.js';

/**
 * Main entry point for the Outpost AI pipeline.
 *
 * Orchestrates: Pathfinder retrieval → Claude response generation (parallel
 * with confidence scoring) → response formatting. Every step has error
 * handling — the pipeline never crashes, always returns a graceful fallback.
 */
export class AIPipeline {
    private pathfinder: PathfinderClient;
    private generator: ResponseGenerator;
    private confidenceScorer: ConfidenceScorer;
    private classifier: TicketClassifier;
    private formatter: ResponseFormatter;

    constructor(options?: {
        pathfinder?: PathfinderClient;
        generator?: ResponseGenerator;
        confidenceScorer?: ConfidenceScorer;
        classifier?: TicketClassifier;
        formatter?: ResponseFormatter;
    }) {
        this.pathfinder = options?.pathfinder ?? new PathfinderClient();
        this.generator = options?.generator ?? new ResponseGenerator();
        this.confidenceScorer = options?.confidenceScorer ?? new ConfidenceScorer();
        this.classifier = options?.classifier ?? new TicketClassifier();
        this.formatter = options?.formatter ?? new ResponseFormatter();
    }

    /**
     * Generate a complete support response: retrieval → generation → scoring → formatting.
     *
     * Steps 2 (response generation) and 3 (confidence scoring) run in parallel.
     */
    async generateSupportResponse(
        question: string,
        options: PipelineOptions,
    ): Promise<PipelineResult> {
        const startTime = Date.now();
        const totalTokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

        // Step 1: Query Pathfinder for relevant content
        let searchResults: SearchResult[];
        try {
            searchResults = await this.pathfinder.searchDocs({
                query: question,
            });
        } catch (error) {
            console.error(`[Pipeline] Pathfinder search failed: ${error instanceof Error ? error.message : String(error)}`);
            searchResults = [];
        }

        // Steps 2 & 3: Generate response AND score confidence in parallel
        const pipelineContext: PipelineContext = {
            question,
        };

        const [generatedResponse, confidenceAssessment] = await Promise.all([
            // Step 2: Generate response
            this.generator.generate(
                pipelineContext,
                searchResults,
                options.conversationHistory,
            ),
            // Step 3: Score confidence (uses heuristic first, then Claude for refinement)
            // We pass a placeholder response text since generation hasn't completed yet.
            // The confidence scorer primarily evaluates search result quality.
            this.confidenceScorer.score(
                question,
                '', // Response not yet available — scorer focuses on search result quality
                searchResults,
            ).catch((error) => {
                console.error(`[Pipeline] Confidence scoring failed: ${error instanceof Error ? error.message : String(error)}`);
                return this.confidenceScorer.heuristicScore(searchResults);
            }),
        ]);

        // Aggregate token usage
        if (generatedResponse.tokenUsage) {
            totalTokenUsage.inputTokens += generatedResponse.tokenUsage.inputTokens;
            totalTokenUsage.outputTokens += generatedResponse.tokenUsage.outputTokens;
        }
        totalTokenUsage.inputTokens += confidenceAssessment.tokenUsage.inputTokens;
        totalTokenUsage.outputTokens += confidenceAssessment.tokenUsage.outputTokens;

        // Use the more conservative confidence (lower of generator's and scorer's)
        const finalConfidenceScore = Math.min(
            generatedResponse.confidence,
            confidenceAssessment.score,
        );
        const finalConfidence = this.classifyConfidence(finalConfidenceScore);

        // Step 4: Format for target platform
        const needsDisclaimer = finalConfidence !== ConfidenceLevel.HIGH;
        const disclaimerText = finalConfidence === ConfidenceLevel.LOW
            ? 'This is an AI-generated response with low confidence. A human agent has been notified and will follow up.'
            : 'This is an AI-generated response. A human agent will verify shortly.';

        const formatted = this.formatter.format(
            generatedResponse.text,
            options.source,
            {
                addDisclaimer: needsDisclaimer,
                disclaimerText,
            },
        );

        const latencyMs = Date.now() - startTime;

        return {
            response: generatedResponse.text,
            formatted,
            confidence: finalConfidence,
            confidenceScore: finalConfidenceScore,
            searchResults,
            tokenUsage: totalTokenUsage,
            latencyMs,
        };
    }

    /**
     * Classify a ticket based on its content.
     */
    async classifyTicket(content: string): Promise<TicketClassification & { tokenUsage: TokenUsage }> {
        try {
            return await this.classifier.classify(content);
        } catch (error) {
            console.error(`[Pipeline] Classification failed: ${error instanceof Error ? error.message : String(error)}`);
            return {
                ...this.classifier.heuristicClassify(content),
                tokenUsage: { inputTokens: 0, outputTokens: 0 },
            };
        }
    }

    /**
     * Generate a streaming response. Yields text chunks as they arrive.
     */
    async *generateStreamingResponse(
        question: string,
        options: PipelineOptions,
    ): AsyncIterable<string> {
        // Fetch search results first
        let searchResults: SearchResult[];
        try {
            searchResults = await this.pathfinder.searchDocs({
                query: question,
            });
        } catch {
            searchResults = [];
        }

        const pipelineContext: PipelineContext = {
            question,
        };

        yield* this.generator.generateStream(
            pipelineContext,
            searchResults,
            options.conversationHistory,
        );
    }

    private classifyConfidence(score: number): ConfidenceLevel {
        if (score >= 0.8) return ConfidenceLevel.HIGH;
        if (score >= 0.5) return ConfidenceLevel.MEDIUM;
        return ConfidenceLevel.LOW;
    }

    /**
     * Clean up resources (Pathfinder session, etc.)
     */
    destroy(): void {
        this.pathfinder.disconnect();
    }
}
