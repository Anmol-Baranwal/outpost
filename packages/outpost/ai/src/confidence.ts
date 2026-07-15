import Anthropic from '@anthropic-ai/sdk';
import type { SearchResult, TokenUsage } from './types.js';
import { ConfidenceLevel, classifyConfidence } from './types.js';
import { config } from './config.js';

export interface ConfidenceAssessment {
    level: ConfidenceLevel;
    score: number;
    reasoning: string;
    tokenUsage: TokenUsage;
    degraded: boolean;
}

const CONFIDENCE_SYSTEM_PROMPT = `You are a confidence scoring system for an AI support assistant. Your job is to assess whether a generated response adequately answers the user's question based on the provided search results.

Evaluate these factors:
1. **Relevance**: Do the search results actually cover the topic the user asked about?
2. **Coverage**: Does the response address all parts of the question?
3. **Specificity**: Is the response specific and actionable, or vague and generic?
4. **Accuracy indicators**: Does the response cite specific features, APIs, or code patterns that exist in CopilotKit?

Respond with ONLY a JSON object (no markdown, no explanation outside the JSON):
{
  "score": <number 0.0-1.0>,
  "level": "HIGH" | "MEDIUM" | "LOW",
  "reasoning": "<one sentence explaining the assessment>"
}`;

/**
 * Confidence scorer that runs after response generation completes.
 *
 * Uses Claude Haiku for cost-effective, fast confidence assessment. Scores
 * the quality of the search results against the actual generated response
 * text, sequentially after the response generator has produced it.
 */
export class ConfidenceScorer {
    private client: Anthropic;
    private model: string;

    constructor(options?: { apiKey?: string; model?: string }) {
        this.client = new Anthropic({
            apiKey: options?.apiKey ?? config.anthropicApiKey,
        });
        this.model = options?.model ?? config.confidenceModel;
    }

    /**
     * Score confidence of a generated response given the question and search results.
     */
    async score(
        question: string,
        response: string,
        searchResults: SearchResult[],
    ): Promise<ConfidenceAssessment> {
        const userMessage = this.buildAssessmentPrompt(question, response, searchResults);

        try {
            const message = await this.client.messages.create({
                model: this.model,
                max_tokens: config.maxConfidenceTokens,
                temperature: config.confidenceTemperature,
                system: CONFIDENCE_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: userMessage }],
            });

            const text = message.content[0].type === 'text' ? message.content[0].text : '';
            const tokenUsage: TokenUsage = {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
            };

            return { ...this.parseAssessment(text, tokenUsage), degraded: false };
        } catch (error) {
            console.error(`[ConfidenceScorer] Scoring failed, falling back to heuristics:`, error);
            // Fallback to heuristic scoring when Claude call fails
            return { ...this.heuristicScore(searchResults), degraded: true };
        }
    }

    /**
     * Heuristic-only scoring (no Claude call). Used as fallback and for
     * pre-filtering before making the Claude call.
     */
    heuristicScore(searchResults: SearchResult[]): ConfidenceAssessment {
        if (searchResults.length === 0) {
            return {
                level: ConfidenceLevel.LOW,
                score: 0.2,
                reasoning: 'No search results available',
                tokenUsage: { inputTokens: 0, outputTokens: 0 },
                degraded: false,
            };
        }

        const avgScore = searchResults.reduce((sum, r) => sum + r.score, 0) / searchResults.length;
        const topScore = Math.max(...searchResults.map((r) => r.score));
        const resultCount = searchResults.length;

        // Weighted formula: top result matters most, avg gives baseline, count provides coverage signal
        const score = Math.min(
            topScore * 0.4 + avgScore * 0.4 + Math.min(resultCount * 0.03, 0.2),
            1.0,
        );

        const level = classifyConfidence(score);

        return {
            level,
            score,
            reasoning: `Heuristic: top=${topScore.toFixed(2)}, avg=${avgScore.toFixed(2)}, count=${resultCount}`,
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            degraded: false,
        };
    }

    private buildAssessmentPrompt(
        question: string,
        response: string,
        searchResults: SearchResult[],
    ): string {
        const resultsText = searchResults
            .map(
                (r, i) =>
                    `[Result ${i + 1}] Score: ${r.score.toFixed(2)} | Title: ${r.title}\n${r.content.slice(0, 500)}`,
            )
            .join('\n\n');

        return [
            '**User Question:**',
            question,
            '',
            '**Search Results:**',
            resultsText || '(none)',
            '',
            '**Generated Response:**',
            response.slice(0, 2000),
        ].join('\n');
    }

    private parseAssessment(text: string, tokenUsage: TokenUsage): ConfidenceAssessment {
        try {
            // Strip any markdown code fences
            const cleaned = text
                .replace(/```json?\s*/g, '')
                .replace(/```\s*/g, '')
                .trim();
            const parsed = JSON.parse(cleaned) as {
                score?: number;
                level?: string;
                reasoning?: string;
            };

            const score = Math.max(0, Math.min(1, Number(parsed.score ?? 0.5)));
            const level = this.parseLevel(parsed.level) ?? classifyConfidence(score);

            return {
                level,
                score,
                reasoning: String(parsed.reasoning ?? 'No reasoning provided'),
                tokenUsage,
                degraded: false,
            };
        } catch (error) {
            console.warn(`[ConfidenceScorer] Failed to parse confidence assessment JSON:`, error);
            // If parsing fails, fall back to a moderate score
            return {
                level: ConfidenceLevel.MEDIUM,
                score: 0.5,
                reasoning: 'Failed to parse confidence assessment',
                tokenUsage,
                degraded: true,
            };
        }
    }

    private parseLevel(level: string | undefined): ConfidenceLevel | null {
        if (!level) return null;
        const upper = level.toUpperCase();
        if (upper === 'HIGH') return ConfidenceLevel.HIGH;
        if (upper === 'MEDIUM') return ConfidenceLevel.MEDIUM;
        if (upper === 'LOW') return ConfidenceLevel.LOW;
        return null;
    }
}
