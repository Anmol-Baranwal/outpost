import Anthropic from '@anthropic-ai/sdk';
import type { TicketClassification, TokenUsage } from './types.js';
import { TicketPriority, TicketType } from './types.js';
import { config } from './config.js';

const CLASSIFIER_SYSTEM_PROMPT = `You are a support ticket classifier for CopilotKit, an open-source AI framework. Classify the ticket and respond with ONLY a JSON object (no markdown, no explanation):

{
  "priority": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "type": "BUG" | "FEATURE_REQUEST" | "QUESTION" | "INTEGRATION_HELP" | "ACCOUNT_ISSUE" | "OTHER",
  "tags": ["tag1", "tag2"],
  "reasoning": "<one sentence>"
}

Classification guidelines:
- **CRITICAL priority**: Security vulnerabilities, data loss, production outages
- **HIGH priority**: Error messages, crashes, production issues, security concerns
- **MEDIUM priority**: Bugs in non-critical flows, integration problems, performance issues
- **LOW priority**: Feature requests, how-to questions, general inquiries, documentation questions

- **BUG type**: Bug reports, error reports, things that are broken or not working as expected
- **FEATURE_REQUEST type**: Feature requests, how-to questions, setup help, configuration questions
- **QUESTION type**: General questions, conceptual inquiries, documentation questions
- **INTEGRATION_HELP type**: Integration problems, setup help with third-party tools
- **ACCOUNT_ISSUE type**: Account/billing problems, access issues
- **OTHER type**: Anything that doesn't fit the above categories

Tags should be specific CopilitKit concepts when relevant: "copilotkit-runtime", "coagent", "copilot-textarea", "react-ui", "cloud", "self-hosted", "actions", "hooks", "integration", "authentication", "deployment", "performance", "typescript", "next.js", "langchain", "langgraph", "crewai", "ag2"`;

/**
 * Ticket classifier that combines fast heuristics with Claude-powered
 * classification for nuanced categorization.
 *
 * Uses heuristics first for quick wins (error messages, obvious patterns),
 * then refines with Claude Haiku when heuristics are insufficient.
 */
export class TicketClassifier {
    private client: Anthropic;
    private model: string;

    constructor(options?: { apiKey?: string; model?: string }) {
        this.client = new Anthropic({
            apiKey: options?.apiKey ?? config.anthropicApiKey,
        });
        this.model = options?.model ?? config.classifierModel;
    }

    /**
     * Classify a ticket based on its content.
     * Applies heuristics first, then refines with Claude.
     */
    async classify(content: string): Promise<TicketClassification & { tokenUsage: TokenUsage; degraded: boolean }> {
        // Apply heuristics for fast pre-classification
        const heuristic = this.heuristicClassify(content);

        try {
            const message = await this.client.messages.create({
                model: this.model,
                max_tokens: config.maxClassifierTokens,
                temperature: config.classifierTemperature,
                system: CLASSIFIER_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: content.slice(0, 3000) }],
            });

            const text = message.content[0].type === 'text' ? message.content[0].text : '';
            const tokenUsage: TokenUsage = {
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
            };

            const parsed = this.parseClassification(text);

            // Merge: heuristic HIGH priority overrides Claude's assessment (errors are always urgent)
            const finalPriority = heuristic.priority === TicketPriority.HIGH
                ? TicketPriority.HIGH
                : parsed.priority;

            // Merge tags from both sources, deduplicate
            const allTags = [...new Set([...heuristic.tags, ...parsed.tags])];

            return {
                priority: finalPriority,
                type: parsed.type,
                tags: allTags,
                reasoning: parsed.reasoning,
                tokenUsage,
                degraded: false,
            };
        } catch (error) {
            console.error(`[Classifier] Claude classification failed, falling back to heuristics:`, error);
            return {
                ...heuristic,
                tokenUsage: { inputTokens: 0, outputTokens: 0 },
                degraded: true,
            };
        }
    }

    /**
     * Fast heuristic classification based on keyword patterns.
     */
    heuristicClassify(content: string): TicketClassification {
        const lower = content.toLowerCase();
        const tags: string[] = [];

        // Priority detection
        let priority = TicketPriority.MEDIUM;

        const highPriorityPatterns = [
            /error:/i, /exception/i, /crash/i, /fatal/i, /broken/i,
            /not working/i, /fails?/i, /bug/i, /production/i,
            /urgent/i, /critical/i, /security/i, /data loss/i,
            /typeerror/i, /referenceerror/i, /syntaxerror/i,
            /cannot read prop/i, /undefined is not/i,
            /500\s*(error|internal)/i, /502|503|504/i,
        ];

        const lowPriorityPatterns = [
            /how (do|can|to)/i, /is (it|there) (a way|possible)/i,
            /feature request/i, /would be nice/i, /suggestion/i,
            /documentation/i, /example/i, /tutorial/i,
            /what is/i, /explain/i, /difference between/i,
        ];

        if (highPriorityPatterns.some((p) => p.test(content))) {
            priority = TicketPriority.HIGH;
        } else if (lowPriorityPatterns.some((p) => p.test(content))) {
            priority = TicketPriority.LOW;
        }

        // Type detection
        let type = TicketType.OTHER;
        const issuePatterns = [
            /error/i, /bug/i, /crash/i, /broken/i, /not working/i,
            /fail/i, /issue/i, /problem/i, /wrong/i,
        ];
        if (issuePatterns.some((p) => p.test(content))) {
            type = TicketType.BUG;
        }

        // Tag detection for CopilotKit concepts
        const tagPatterns: Array<[RegExp, string]> = [
            [/copilotkit[-\s]?runtime/i, 'copilotkit-runtime'],
            [/coagent/i, 'coagent'],
            [/copilot[-\s]?textarea/i, 'copilot-textarea'],
            [/react[-\s]?ui|CopilotChat|CopilotPopup|CopilotSidebar/i, 'react-ui'],
            [/cloud/i, 'cloud'],
            [/self[-\s]?host/i, 'self-hosted'],
            [/action|useCopilotAction/i, 'actions'],
            [/hook|useCopilot/i, 'hooks'],
            [/integrat/i, 'integration'],
            [/auth/i, 'authentication'],
            [/deploy/i, 'deployment'],
            [/performa|slow|latency/i, 'performance'],
            [/typescript|tsx?/i, 'typescript'],
            [/next\.?js|nextjs/i, 'next.js'],
            [/langchain/i, 'langchain'],
            [/langgraph/i, 'langgraph'],
            [/crewai/i, 'crewai'],
            [/ag-?ui/i, 'ag-ui'],
        ];

        for (const [pattern, tag] of tagPatterns) {
            if (pattern.test(lower)) {
                tags.push(tag);
            }
        }

        return {
            priority,
            type,
            tags,
            reasoning: `Heuristic classification: ${priority} priority ${type.toLowerCase().replace('_', ' ')}`,
        };
    }

    private parseClassification(text: string): TicketClassification {
        try {
            const cleaned = text.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
            const parsed = JSON.parse(cleaned) as {
                priority?: string;
                type?: string;
                tags?: string[];
                reasoning?: string;
            };

            return {
                priority: this.parsePriority(parsed.priority),
                type: this.parseType(parsed.type),
                tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
                reasoning: String(parsed.reasoning ?? 'Classified by AI'),
            };
        } catch (error) {
            console.warn(`[Classifier] Failed to parse classification JSON:`, error);
            return {
                priority: TicketPriority.MEDIUM,
                type: TicketType.OTHER,
                tags: [],
                reasoning: 'Failed to parse classification',
            };
        }
    }

    private parsePriority(value: string | undefined): TicketPriority {
        if (!value) return TicketPriority.MEDIUM;
        const upper = value.toUpperCase();
        if (upper === 'CRITICAL') return TicketPriority.CRITICAL;
        if (upper === 'HIGH') return TicketPriority.HIGH;
        if (upper === 'LOW') return TicketPriority.LOW;
        return TicketPriority.MEDIUM;
    }

    private parseType(value: string | undefined): TicketType {
        if (!value) return TicketType.OTHER;
        const upper = value.toUpperCase();
        if (upper === 'BUG') return TicketType.BUG;
        if (upper === 'FEATURE_REQUEST') return TicketType.FEATURE_REQUEST;
        if (upper === 'QUESTION') return TicketType.QUESTION;
        if (upper === 'INTEGRATION_HELP') return TicketType.INTEGRATION_HELP;
        if (upper === 'ACCOUNT_ISSUE') return TicketType.ACCOUNT_ISSUE;
        return TicketType.OTHER;
    }
}
