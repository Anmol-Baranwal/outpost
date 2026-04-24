import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FaqSection } from '@/components/dashboard/faq-section';

const MOCK_ENTRIES = [
    {
        id: 'faq-1',
        question: 'How do I set up CopilotKit?',
        answer: 'Follow the quickstart guide for setup instructions.',
        sourceCount: 12,
    },
    {
        id: 'faq-2',
        question: 'Why are my actions not called?',
        answer: 'Check the action name matches the tool name.',
        sourceCount: 3,
    },
];

describe('FaqSection', () => {
    it('renders all FAQ entries', () => {
        render(<FaqSection entries={MOCK_ENTRIES} />);
        expect(screen.getByText('How do I set up CopilotKit?')).toBeInTheDocument();
        expect(screen.getByText('Why are my actions not called?')).toBeInTheDocument();
    });

    it('renders answers', () => {
        render(<FaqSection entries={MOCK_ENTRIES} />);
        expect(
            screen.getByText('Follow the quickstart guide for setup instructions.'),
        ).toBeInTheDocument();
    });

    it('shows source count buttons', () => {
        render(<FaqSection entries={MOCK_ENTRIES} />);
        expect(screen.getByText('12 sources')).toBeInTheDocument();
        expect(screen.getByText('3 sources')).toBeInTheDocument();
    });

    it('expands sources on click', () => {
        render(<FaqSection entries={MOCK_ENTRIES} />);
        const sourceButton = screen.getByText('12 sources');
        fireEvent.click(sourceButton);
        expect(
            screen.getByText('12 knowledge base articles matched this question.'),
        ).toBeInTheDocument();
    });

    it('collapses sources on second click', () => {
        render(<FaqSection entries={MOCK_ENTRIES} />);
        const sourceButton = screen.getByText('12 sources');

        fireEvent.click(sourceButton);
        expect(
            screen.getByText('12 knowledge base articles matched this question.'),
        ).toBeInTheDocument();

        fireEvent.click(sourceButton);
        expect(
            screen.queryByText('12 knowledge base articles matched this question.'),
        ).not.toBeInTheDocument();
    });

    it('shows empty state when no entries', () => {
        render(<FaqSection entries={[]} />);
        expect(screen.getByText(/No FAQs available yet/)).toBeInTheDocument();
    });

    it('renders singular "source" for count of 1', () => {
        render(
            <FaqSection
                entries={[
                    {
                        id: 'faq-single',
                        question: 'Single source question?',
                        answer: 'Answer.',
                        sourceCount: 1,
                    },
                ]}
            />,
        );
        expect(screen.getByText('1 source')).toBeInTheDocument();
    });

    it('shows heading', () => {
        render(<FaqSection entries={MOCK_ENTRIES} />);
        expect(screen.getByText('Frequently Asked')).toBeInTheDocument();
    });
});
