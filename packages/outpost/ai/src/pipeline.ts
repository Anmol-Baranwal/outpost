import type {
    PipelineContext,
    PipelineOptions,
    PipelineResult,
    TicketClassification,
    TokenUsage,
    SearchResult,
} from './types.js';
import { ConfidenceLevel, classifyConfidence } from './types.js';
import { PathfinderClient } from './pathfinder.js';
import { ResponseGenerator } from './generator.js';
import { ConfidenceScorer } from './confidence.js';
import { TicketClassifier } from './classifier.js';
import { ResponseFormatter } from './formatter.js';
import { validateConfig } from './config.js';

/**
 * Main entry point for the Outpost AI pipeline.
 *
 * Orchestrates: Pathfinder retrieval → Claude response generation → confidence
 * scoring (against the real generated response) → response formatting. Every
 * step has error handling — the pipeline never crashes, always returns a
 * graceful fallback.
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
        validateConfig();
        this.pathfinder = options?.pathfinder ?? new PathfinderClient();
        this.generator = options?.generator ?? new ResponseGenerator();
        this.confidenceScorer = options?.confidenceScorer ?? new ConfidenceScorer();
        this.classifier = options?.classifier ?? new TicketClassifier();
        this.formatter = options?.formatter ?? new ResponseFormatter();
    }

    /**
     * Generate a complete support response: retrieval → generation → scoring → formatting.
     *
     * Steps 2 (response generation) and 3 (confidence scoring) run sequentially —
     * scoring needs the real generated text, not a placeholder.
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
            console.error(
                `[Pipeline] Pathfinder search failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            searchResults = [];
        }

        // Step 2: Generate response
        const pipelineContext: PipelineContext = {
            question,
        };

        const generatedResponse = await this.generator.generate(
            pipelineContext,
            searchResults,
            options.conversationHistory,
        );

        // Step 3: Score confidence against the ACTUAL generated response
        // (sequential, not parallel — the scorer needs the real text to
        // produce a meaningful signal, not a retrieval-quality proxy).
        const confidenceAssessment = await this.confidenceScorer
            .score(question, generatedResponse.text, searchResults)
            .catch((error) => {
                console.error(
                    `[Pipeline] Confidence scoring failed: ${error instanceof Error ? error.message : String(error)}`,
                );
                return this.confidenceScorer.heuristicScore(searchResults);
            });

        // Aggregate token usage
        if (generatedResponse.tokenUsage) {
            totalTokenUsage.inputTokens += generatedResponse.tokenUsage.inputTokens;
            totalTokenUsage.outputTokens += generatedResponse.tokenUsage.outputTokens;
        }
        totalTokenUsage.inputTokens += confidenceAssessment.tokenUsage.inputTokens;
        totalTokenUsage.outputTokens += confidenceAssessment.tokenUsage.outputTokens;

        // Use the more conservative confidence (lower of generator's and scorer's),
        // then apply the aggregate-feedback calibration (default 0 = no change).
        const combinedConfidenceScore = Math.min(
            generatedResponse.confidenceScore,
            confidenceAssessment.score,
        );
        const calibration = options.confidenceCalibration ?? 0;
        const finalConfidenceScore = Math.max(
            0,
            Math.min(1, combinedConfidenceScore + calibration),
        );
        const finalConfidence = classifyConfidence(finalConfidenceScore);

        // Step 4: Format for target platform
        const needsDisclaimer = finalConfidence !== ConfidenceLevel.HIGH;
        const disclaimerText =
            finalConfidence === ConfidenceLevel.LOW
                ? "This is an AI-generated response and may be incomplete. We've escalated this to our engineering team — someone will follow up in this thread shortly."
                : 'This is an AI-generated response. A member of our team will review and follow up if needed.';

        const formatted = this.formatter.format(generatedResponse.text, options.source, {
            addDisclaimer: needsDisclaimer,
            disclaimerText,
        });

        const latencyMs = Date.now() - startTime;

        return {
            response: generatedResponse.text,
            formatted,
            confidenceLevel: finalConfidence,
            confidenceScore: finalConfidenceScore,
            searchResults,
            tokenUsage: totalTokenUsage,
            latencyMs,
        };
    }

    /**
     * Classify a ticket based on its content.
     */
    async classifyTicket(
        content: string,
    ): Promise<TicketClassification & { tokenUsage: TokenUsage }> {
        try {
            return await this.classifier.classify(content);
        } catch (error) {
            console.error(
                `[Pipeline] Classification failed: ${error instanceof Error ? error.message : String(error)}`,
            );
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
        } catch (error) {
            console.error(
                `[Pipeline] Streaming search failed: ${error instanceof Error ? error.message : String(error)}`,
                error,
            );
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

    /**
     * Clean up resources (Pathfinder session, etc.)
     */
    destroy(): void {
        this.pathfinder.disconnect();
    }
}
