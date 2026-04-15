import { NextResponse } from 'next/server';

/**
 * GET /api/dashboard/faq
 *
 * Returns top FAQ entries. In production these come from Pathfinder knowledge-base.
 * For now returns curated mock data.
 */

interface FaqEntry {
    id: string;
    question: string;
    answer: string;
    sourceCount: number;
}

const MOCK_FAQ: FaqEntry[] = [
    {
        id: 'faq-1',
        question: 'How do I set up CopilotKit with Next.js App Router?',
        answer:
            'Wrap your root layout with CopilotKit provider, configure the runtime endpoint at /api/copilotkit, and use the useCopilotChat hook in your components. See the quickstart guide for step-by-step instructions.',
        sourceCount: 12,
    },
    {
        id: 'faq-2',
        question: 'Why are my CopilotKit actions not being called?',
        answer:
            'The most common cause is a mismatch between the action name in useCopilotAction and the tool name expected by the LLM. Ensure names are identical and that the action is registered before the chat starts.',
        sourceCount: 8,
    },
    {
        id: 'faq-3',
        question: 'How do I use CopilotKit with a custom LLM provider?',
        answer:
            'CopilotKit supports any LangChain-compatible model via the LangChain adapter. Import your model class (e.g. ChatAnthropic, ChatGoogleGenerativeAI), instantiate it, and pass to the CopilotRuntime constructor.',
        sourceCount: 15,
    },
    {
        id: 'faq-4',
        question: 'Can I use CopilotKit in a multi-tenant application?',
        answer:
            'Yes. Configure tenant isolation by passing a unique context per tenant to the runtime. Use the CopilotKit context provider with tenant-specific parameters to scope agent behavior and data access.',
        sourceCount: 5,
    },
    {
        id: 'faq-5',
        question: 'What is the difference between CoAgents and CopilotKit agents?',
        answer:
            'CoAgents are LangGraph-based collaborative agents that integrate with CopilotKit for human-in-the-loop workflows. Standard CopilotKit agents handle single-turn tool-calling interactions. CoAgents support multi-step, stateful agent graphs.',
        sourceCount: 20,
    },
];

export async function GET() {
    // In production: fetch from Pathfinder API
    // const res = await fetch(`${PATHFINDER_URL}/api/faq?limit=5`);
    return NextResponse.json({ entries: MOCK_FAQ });
}
