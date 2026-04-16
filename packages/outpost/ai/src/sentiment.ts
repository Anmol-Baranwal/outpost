/**
 * Sentiment analyzer for account health scoring.
 *
 * Analyzes message content using Claude Haiku to determine the percentage
 * of negative sentiment, frustration level, and satisfaction signals.
 * Designed for batch analysis of all messages from an account in a single call.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SentimentResult, TokenUsage } from './types.js';
import { SentimentLabel } from './types.js';
import { config } from './config.js';

const SENTIMENT_SYSTEM_PROMPT = `You are a sentiment analyzer for a developer support platform. Analyze the provided messages and respond with ONLY a JSON object (no markdown, no explanation):

{
  "score": <number 0-100>,
  "label": "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "CRITICAL"
}

Scoring guidelines:
- **score** is the percentage of negative sentiment across all messages (0 = entirely positive, 100 = entirely negative/hostile)
- Look for: frustration, anger, confusion, satisfaction, gratitude, urgency, threats to leave
- Consider: tone, word choice, exclamation marks, caps, profanity, passive-aggression
- A mix of positive and negative messages should reflect the overall balance

Label thresholds:
- POSITIVE: score 0-20 (mostly happy, grateful, satisfied)
- NEUTRAL: score 21-45 (matter-of-fact, no strong sentiment either way)
- NEGATIVE: score 46-70 (frustrated, unhappy, complaining)
- CRITICAL: score 71-100 (angry, threatening to churn, hostile, escalation-worthy)`;

/**
 * Analyze sentiment across a batch of messages.
 *
 * Sends all messages to Claude Haiku in a single call for cost-effective
 * batch analysis. Returns a score (0-100, % negative) and a label.
 */
export async function analyzeSentiment(
    messages: string[],
    options?: { apiKey?: string; model?: string },
): Promise<SentimentResult & { degraded: boolean }> {
    if (messages.length === 0) {
        return {
            score: 25,
            label: SentimentLabel.NEUTRAL,
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            degraded: false,
        };
    }

    const client = new Anthropic({
        apiKey: options?.apiKey ?? config.anthropicApiKey,
    });
    const model = options?.model ?? config.sentimentModel;

    // Format messages as a numbered list for the prompt
    const formatted = messages
        .map((msg, i) => `[Message ${i + 1}]: ${msg}`)
        .join('\n\n');

    // Truncate to ~8000 chars to stay within reasonable token limits
    const truncated = formatted.slice(0, 8000);

    try {
        const response = await client.messages.create({
            model,
            max_tokens: config.maxSentimentTokens,
            temperature: config.sentimentTemperature,
            system: SENTIMENT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: truncated }],
        });

        const text = response.content[0].type === 'text' ? response.content[0].text : '';
        const tokenUsage: TokenUsage = {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
        };

        const parsed = parseSentimentResponse(text);

        return {
            ...parsed,
            tokenUsage,
            degraded: false,
        };
    } catch (error) {
        console.error(`[Sentiment] Analysis failed, returning neutral fallback:`, error);
        // Fallback: return neutral on failure
        return {
            score: 50,
            label: SentimentLabel.NEUTRAL,
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            degraded: true,
        };
    }
}

/**
 * Parse the JSON response from Claude into a SentimentResult.
 */
function parseSentimentResponse(text: string): Omit<SentimentResult, 'tokenUsage'> {
    try {
        const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned) as { score?: number; label?: string };

        const score = clampScore(parsed.score);
        const label = parseLabel(parsed.label) ?? labelFromScore(score);

        return { score, label };
    } catch (error) {
        console.warn(`[Sentiment] Failed to parse sentiment response JSON:`, error);
        return { score: 50, label: SentimentLabel.NEUTRAL };
    }
}

function clampScore(value: unknown): number {
    if (typeof value !== 'number' || isNaN(value)) return 50;
    return Math.max(0, Math.min(100, Math.round(value)));
}

function parseLabel(value: unknown): SentimentLabel | null {
    if (typeof value !== 'string') return null;
    const upper = value.toUpperCase();
    if (upper === 'POSITIVE') return SentimentLabel.POSITIVE;
    if (upper === 'NEUTRAL') return SentimentLabel.NEUTRAL;
    if (upper === 'NEGATIVE') return SentimentLabel.NEGATIVE;
    if (upper === 'CRITICAL') return SentimentLabel.CRITICAL;
    return null;
}

function labelFromScore(score: number): SentimentLabel {
    if (score <= 20) return SentimentLabel.POSITIVE;
    if (score <= 45) return SentimentLabel.NEUTRAL;
    if (score <= 70) return SentimentLabel.NEGATIVE;
    return SentimentLabel.CRITICAL;
}
