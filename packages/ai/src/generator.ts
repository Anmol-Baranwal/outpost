import Anthropic from '@anthropic-ai/sdk';
import { AI_CONFIDENCE } from '@outpost/shared';
import type { GeneratedResponse, PipelineContext, SearchResult, TokenUsage } from './types.js';
import { ConfidenceLevel, classifyConfidence } from './types.js';
import { config } from './config.js';

const SYSTEM_PROMPT_PREFIX = `You are an AI support assistant for CopilotKit, an open-source framework for building AI copilots, chatbots, and AI-powered UIs.

Your personality:
- Conversational and helpful, not robotic
- Always include code examples when relevant (TypeScript/React preferred)
- Reference specific docs pages with full URLs when available
- Structure responses with **bold headers**, bullet points, and code blocks
- End with a relevant follow-up suggestion or "Was this helpful?"

Formatting rules:
- Use markdown formatting throughout
- Wrap code in fenced code blocks with language tags
- Use bold for emphasis on key concepts
- Keep paragraphs concise — prefer bullets over walls of text`;

/**
 * Claude response generator for the AI support pipeline.
 *
 * Takes a question and relevant context (from Pathfinder search results),
 * then generates a structured response using Claude claude-sonnet-4-20250514.
 * Supports both streaming and non-streaming modes.
 */
export class ResponseGenerator {
    private client: Anthropic;
    private model: string;

    constructor(options?: { apiKey?: string; model?: string }) {
        this.client = new Anthropic({
            apiKey: options?.apiKey ?? config.anthropicApiKey,
        });
        this.model = options?.model ?? config.responseModel;
    }

    /**
     * Generate a response for a support question using context from Pathfinder.
     */
    async generate(
        pipelineContext: PipelineContext,
        sources: SearchResult[],
        conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
    ): Promise<GeneratedResponse & { degraded: boolean }> {
        const startTime = Date.now();
        const systemPrompt = this.buildSystemPrompt(sources);
        const messages = this.buildMessages(pipelineContext, conversationHistory);

        try {
            const message = await this.client.messages.create({
                model: this.model,
                max_tokens: config.maxResponseTokens,
                temperature: config.responseTemperature,
                system: systemPrompt,
                messages,
            });

            const responseText =
                message.content[0].type === 'text' ? message.content[0].text : '';

            const tokenUsage: TokenUsage = {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
            };

            const confidenceScore = this.assessConfidence(sources, responseText);
            const confidenceLevel = classifyConfidence(confidenceScore);
            const latencyMs = Date.now() - startTime;

            return {
                text: responseText,
                confidenceScore,
                confidenceLevel,
                sources,
                autoSend: confidenceScore >= AI_CONFIDENCE.AUTO_RESPOND,
                reasoning: `Based on ${sources.length} source(s) with avg relevance ${this.avgScore(sources).toFixed(2)}`,
                tokenUsage,
                latencyMs,
                degraded: false,
            };
        } catch (error) {
            console.error(`[Generator] Response generation failed, returning fallback:`, error);
            const latencyMs = Date.now() - startTime;
            // Never crash — return a graceful fallback
            return {
                text: 'I apologize, but I was unable to generate a response at this time. A human support agent will follow up shortly.',
                confidenceScore: 0,
                confidenceLevel: ConfidenceLevel.LOW,
                sources,
                autoSend: false,
                reasoning: `Generation failed: ${error instanceof Error ? error.message : String(error)}`,
                tokenUsage: { inputTokens: 0, outputTokens: 0 },
                latencyMs,
                degraded: true,
            };
        }
    }

    /**
     * Generate a response in streaming mode, yielding text chunks as they arrive.
     */
    async *generateStream(
        pipelineContext: PipelineContext,
        sources: SearchResult[],
        conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
    ): AsyncIterable<string> {
        const systemPrompt = this.buildSystemPrompt(sources);
        const messages = this.buildMessages(pipelineContext, conversationHistory);

        try {
            const stream = this.client.messages.stream({
                model: this.model,
                max_tokens: config.maxResponseTokens,
                temperature: config.responseTemperature,
                system: systemPrompt,
                messages,
            });

            for await (const event of stream) {
                if (
                    event.type === 'content_block_delta' &&
                    event.delta.type === 'text_delta'
                ) {
                    yield event.delta.text;
                }
            }
        } catch (error) {
            yield `\n\n_Error generating response: ${error instanceof Error ? error.message : String(error)}_`;
        }
    }

    private buildSystemPrompt(sources: SearchResult[]): string {
        const sourceContext = sources
            .map((s, i) => {
                const urlLine = s.sourceUrl ? `\nURL: ${s.sourceUrl}` : '';
                return `[Source ${i + 1}: ${s.title} (relevance: ${s.score.toFixed(2)})]${urlLine}\n${s.content}`;
            })
            .join('\n\n');

        return [
            SYSTEM_PROMPT_PREFIX,
            '',
            '--- Documentation Context ---',
            sourceContext || '(No relevant documentation found — answer from general CopilotKit knowledge if possible, otherwise say you need to escalate)',
        ].join('\n');
    }

    private buildMessages(
        ctx: PipelineContext,
        conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>,
    ): Array<{ role: 'user' | 'assistant'; content: string }> {
        const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

        // Include conversation history for follow-up questions
        if (conversationHistory?.length) {
            messages.push(...conversationHistory);
        }

        const parts = [ctx.question];
        if (ctx.context) {
            parts.push(`\nAdditional context: ${ctx.context}`);
        }

        messages.push({ role: 'user', content: parts.join('\n') });
        return messages;
    }

    private assessConfidence(sources: SearchResult[], _response: string): number {
        if (sources.length === 0) return 0.2;

        const avgRelevance = this.avgScore(sources);
        const sourceCountBonus = Math.min(sources.length * 0.05, 0.15);

        // Base confidence on source quality + count
        return Math.min(avgRelevance + sourceCountBonus, 1.0);
    }

    private avgScore(sources: SearchResult[]): number {
        if (sources.length === 0) return 0;
        return sources.reduce((sum, s) => sum + s.score, 0) / sources.length;
    }
}
