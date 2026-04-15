import Anthropic from '@anthropic-ai/sdk';
import { AI_CONFIDENCE } from '@outpost/shared';
import type { GeneratedResponse, PipelineContext, SearchResult } from './types.js';
import { ConfidenceLevel } from './types.js';

/**
 * Claude response generator stub.
 *
 * Takes a question and relevant context (from Pathfinder search results),
 * then generates a structured response with confidence scoring.
 */
export class ResponseGenerator {
    private client: Anthropic;
    private model: string;

    constructor(options?: { apiKey?: string; model?: string }) {
        this.client = new Anthropic({
            apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY,
        });
        this.model = options?.model ?? 'claude-sonnet-4-20250514';
    }

    /**
     * Generate a response for a support question using context from Pathfinder.
     */
    async generate(
        pipelineContext: PipelineContext,
        sources: SearchResult[],
    ): Promise<GeneratedResponse> {
        const systemPrompt = this.buildSystemPrompt(sources);
        const userMessage = this.buildUserMessage(pipelineContext);

        // TODO: Replace with actual Claude API call once pipeline is wired up
        console.log(`[Generator] Generating response for: ${pipelineContext.question.slice(0, 50)}...`);
        console.log(`[Generator] Using ${sources.length} sources as context`);

        const message = await this.client.messages.create({
            model: this.model,
            max_tokens: 1024,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        });

        const responseText =
            message.content[0].type === 'text' ? message.content[0].text : '';

        const confidence = this.assessConfidence(sources, responseText);
        const confidenceLevel = this.classifyConfidence(confidence);

        return {
            text: responseText,
            confidence,
            confidenceLevel,
            sources,
            autoSend: confidence >= AI_CONFIDENCE.AUTO_RESPOND,
            reasoning: `Based on ${sources.length} source(s) with avg relevance ${this.avgScore(sources).toFixed(2)}`,
        };
    }

    private buildSystemPrompt(sources: SearchResult[]): string {
        const sourceContext = sources
            .map((s, i) => `[Source ${i + 1}: ${s.title}]\n${s.content}`)
            .join('\n\n');

        return [
            'You are an AI support assistant for CopilotKit, an open-source framework for building AI copilots.',
            'Answer the user\'s question based on the provided documentation context.',
            'If the context does not contain enough information to answer confidently, say so clearly.',
            'Be concise, helpful, and include relevant code examples when appropriate.',
            '',
            '--- Documentation Context ---',
            sourceContext || '(No relevant documentation found)',
        ].join('\n');
    }

    private buildUserMessage(ctx: PipelineContext): string {
        const parts = [ctx.question];
        if (ctx.context) {
            parts.push(`\nAdditional context: ${ctx.context}`);
        }
        return parts.join('\n');
    }

    private assessConfidence(sources: SearchResult[], _response: string): number {
        if (sources.length === 0) return 0.2;

        const avgRelevance = this.avgScore(sources);
        const sourceCountBonus = Math.min(sources.length * 0.05, 0.15);

        // Base confidence on source quality + count
        return Math.min(avgRelevance + sourceCountBonus, 1.0);
    }

    private classifyConfidence(score: number): ConfidenceLevel {
        if (score >= AI_CONFIDENCE.SUGGEST) return ConfidenceLevel.HIGH;
        if (score >= AI_CONFIDENCE.ESCALATE) return ConfidenceLevel.MEDIUM;
        return ConfidenceLevel.LOW;
    }

    private avgScore(sources: SearchResult[]): number {
        if (sources.length === 0) return 0;
        return sources.reduce((sum, s) => sum + s.score, 0) / sources.length;
    }
}
