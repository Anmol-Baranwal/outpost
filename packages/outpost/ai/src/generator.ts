import Anthropic from '@anthropic-ai/sdk';
import type { PlatformTarget } from '@copilotkit/outpost/shared';
import type { GeneratedResponse, PipelineContext, SearchResult, TokenUsage } from './types.js';
import { ConfidenceLevel, SUPPRESSED_CONFIDENCE_CAP, classifyConfidence } from './types.js';
import type { GroundednessAssessment } from './groundedness.js';
import { assessGroundedness } from './groundedness.js';
import { config } from './config.js';
import { samplingParams } from './model-capabilities.js';

/**
 * Epistemic guardrails. The generator is a SINGLE stateless model call over
 * documentation search results — it cannot read CopilotKit's source, cannot run
 * a repro, and cannot execute tests. Without these rules it will happily assert
 * a confirmed root cause built from generic framework priors (see
 * CopilotKit/CopilotKit#6167, where the bot posted "Bug Confirmed" plus invented
 * CSS class names for a cursor-jump report it never reproduced).
 *
 * Every rule here exists to keep the response's claims inside what the provided
 * Documentation Context actually supports.
 */
export const GROUNDING_RULES = `Grounding rules (these override the personality and formatting rules above when they conflict):
- You have NOT read CopilotKit's source code, reproduced the user's problem, or run any test. Never write or imply otherwise.
- Never confirm a bug. Do not write "bug confirmed", "this is a real bug", "known issue", "root cause is", or "the fix is" about behavior you cannot see. Acknowledge the report and say engineering will verify.
- Only name identifiers — file paths, CSS class names, component names, props, hooks, config keys, version numbers — that appear verbatim in the Documentation Context. If it is not there, describe the concept in prose instead of guessing a name.
- Mark any causal explanation as a hypothesis exactly once ("one possibility is…"), and never restate it as established fact later in the same response. If you hedge a claim, do not close by asserting it.
- Do not prescribe fixes to CopilotKit's internals or tell maintainers what to change; that call is theirs. Workarounds the user can apply in their own code are fine.
- Prefer "I don't have enough to answer this — escalating to the team" over a plausible-sounding answer assembled from general framework knowledge.`;

export const SYSTEM_PROMPT_PREFIX = `You are an AI support assistant for CopilotKit, an open-source framework for building AI copilots, chatbots, and AI-powered UIs.

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
- Keep paragraphs concise — prefer bullets over walls of text

${GROUNDING_RULES}`;

/**
 * Per-channel guidance so the response never redirects the user to the channel
 * they're already using. Someone asking IN Discord must never be told to "join
 * the Discord"; someone asking IN a GitHub issue must never be told to "open an
 * issue" — they already have. Pointing to a *different* channel is still fine.
 */
const CHANNEL_GUIDANCE: Record<PlatformTarget, string> = {
    discord:
        'This question was asked in the CopilotKit Discord. The user is ALREADY in Discord — never suggest they "join the Discord", never share a Discord invite link, and never tell them to ask in Discord. You may point them to the docs or GitHub if genuinely useful.',
    github: 'This question was asked in a GitHub issue or discussion. The user is ALREADY on GitHub — never suggest they "open an issue", "file a bug report", or "open a GitHub discussion"; they already have. You may point them to the docs or Discord if genuinely useful.',
    slack: 'This question was asked in Slack. The user is ALREADY in Slack — never suggest they reach out or ask again in Slack. You may point them to the docs, Discord, or GitHub if genuinely useful.',
    teams: 'This question was asked in Microsoft Teams. The user is ALREADY in Teams — never suggest they reach out or ask again in Teams. You may point them to the docs, Discord, or GitHub if genuinely useful.',
    web: 'This question was asked through the web support widget. Point the user to the docs, Discord, or GitHub if genuinely useful.',
};

/**
 * Build the channel-awareness block for the system prompt. Returns an empty
 * string when the source is unknown so the prompt is unchanged.
 *
 * Exported for unit testing — aimock strips `system` from captured requests,
 * so this pure function is verified directly.
 */
export function buildChannelGuidance(source?: PlatformTarget): string {
    if (!source) return '';
    const guidance = CHANNEL_GUIDANCE[source];
    if (!guidance) return '';
    return [
        '',
        '--- Channel Awareness ---',
        guidance,
        'General rule: never redirect the user to the same channel they are already using to ask this question.',
    ].join('\n');
}

/**
 * Extract all text blocks from an Anthropic response, in response order.
 *
 * Joined with a blank line rather than concatenated. Two text blocks are only
 * ever adjacent because something non-text sat between them (a `tool_use`, a
 * `thinking` block), which means they were separate emissions and not two halves
 * of one sentence — concatenating them produces `...first step.Next you...`.
 * Filtering explicitly rather than mapping non-text blocks to `''` is what makes
 * the separator apply where it should and nowhere else.
 */
export function extractResponseText(content: Anthropic.ContentBlock[]): string {
    return content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n\n');
}

/**
 * Claude response generator for the AI support pipeline.
 *
 * Takes a question and relevant context (from Pathfinder search results),
 * then generates a structured response using the configured model (default: claude-sonnet-4-6).
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
        const systemPrompt = this.buildSystemPrompt(sources, pipelineContext.source);
        const messages = this.buildMessages(pipelineContext, conversationHistory);

        try {
            const message = await this.client.messages.create({
                model: this.model,
                max_tokens: config.maxResponseTokens,
                ...samplingParams(this.model, config.responseTemperature),
                system: systemPrompt,
                messages,
            });

            const responseText = extractResponseText(message.content);
            if (!responseText.trim()) {
                throw new Error('Model response contained no usable text');
            }

            const tokenUsage: TokenUsage = {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
            };

            const confidenceScore = this.assessConfidence(sources);
            const latencyMs = Date.now() - startTime;
            // Assessed here (the response and its sources are both in hand) and
            // applied by the pipeline — exactly once.
            const groundedness = assessGroundedness(responseText, sources);
            const confidenceLevel = this.classifyGroundedConfidence(confidenceScore, groundedness);

            return {
                text: responseText,
                confidenceScore,
                confidenceLevel,
                sources,
                reasoning: `Based on ${sources.length} source(s) with avg relevance ${this.avgScore(sources).toFixed(2)}`,
                tokenUsage,
                latencyMs,
                groundedness,
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
                reasoning: `Generation failed: ${error instanceof Error ? error.message : String(error)}`,
                tokenUsage: { inputTokens: 0, outputTokens: 0 },
                latencyMs,
                // The fallback copy is ours, not the model's — nothing to assess.
                groundedness: assessGroundedness('', sources),
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
        const systemPrompt = this.buildSystemPrompt(sources, pipelineContext.source);
        const messages = this.buildMessages(pipelineContext, conversationHistory);

        try {
            const stream = this.client.messages.stream({
                model: this.model,
                max_tokens: config.maxResponseTokens,
                ...samplingParams(this.model, config.responseTemperature),
                system: systemPrompt,
                messages,
            });

            for await (const event of stream) {
                if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                    yield event.delta.text;
                }
            }
        } catch (error) {
            yield `\n\n_Error generating response: ${error instanceof Error ? error.message : String(error)}_`;
        }
    }

    private buildSystemPrompt(sources: SearchResult[], source?: PlatformTarget): string {
        const sourceContext = sources
            .map((s, i) => {
                const urlLine = s.sourceUrl ? `\nURL: ${s.sourceUrl}` : '';
                return `[Source ${i + 1}: ${s.title} (relevance: ${s.score.toFixed(2)})]${urlLine}\n${s.content}`;
            })
            .join('\n\n');

        return [
            SYSTEM_PROMPT_PREFIX,
            buildChannelGuidance(source),
            '',
            '--- Documentation Context ---',
            sourceContext ||
                '(No relevant documentation found — answer from general CopilotKit knowledge if possible, otherwise say you need to escalate)',
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

    /**
     * Score retrieval quality: how good the sources are, not what the response did
     * with them.
     *
     * Deliberately does NOT deduct the groundedness penalty. This score feeds the
     * pipeline's `min(generator, scorer)`, and the pipeline deducts afterwards — so
     * subtracting here too charged the same penalty twice whenever this score was
     * the lower of the two. The groundedness assessment travels alongside on
     * `GeneratedResponse.groundedness` for the pipeline to apply once.
     */
    private assessConfidence(sources: SearchResult[]): number {
        if (sources.length === 0) return 0.2;

        const avgRelevance = this.avgScore(sources);
        const sourceCountBonus = Math.min(sources.length * 0.05, 0.15);

        return Math.min(avgRelevance + sourceCountBonus, 1.0);
    }

    /**
     * Classify the confidence LEVEL we publish for this response.
     *
     * `retrievalScore` is retrieval-only by design, so classifying it directly
     * announced HIGH for any answer built on good sources — including one the
     * groundedness gate would withhold entirely (two sources at 0.9/0.85 score
     * 0.975 no matter how fabricated the text is). The level is a claim about the
     * *response*, so it is classified from the penalised value, and clamped for a
     * suppressed response the same way the pipeline clamps its own score.
     *
     * The penalised value is LOCAL. It is never written back to `confidenceScore`,
     * which must stay penalty-free because it feeds the pipeline's `min()` before
     * the pipeline performs the one and only deduction. Deducting into the score
     * here is the double-counting bug this module just fixed.
     */
    private classifyGroundedConfidence(
        retrievalScore: number,
        groundedness: GroundednessAssessment,
    ): ConfidenceLevel {
        let score = Math.max(0, retrievalScore - groundedness.penalty);
        if (groundedness.suppress) {
            score = Math.min(score, SUPPRESSED_CONFIDENCE_CAP);
        }
        return classifyConfidence(score);
    }

    private avgScore(sources: SearchResult[]): number {
        if (sources.length === 0) return 0;
        return sources.reduce((sum, s) => sum + s.score, 0) / sources.length;
    }
}
