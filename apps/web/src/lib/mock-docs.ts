export type ArticleStatus = 'draft' | 'published';

export interface DocArticle {
    id: string;
    categorySlug: string;
    title: string;
    status: ArticleStatus;
    content: string;
    updatedAt: string;
    createdAt: string;
    source?: 'manual' | 'ai' | 'loom';
}

export interface DocCategory {
    slug: string;
    name: string;
    description: string;
    articleCount: number;
}

const now = new Date();
function daysAgo(n: number): string {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString();
}

export const MOCK_ARTICLES: DocArticle[] = [
    // Getting Started
    {
        id: 'art-001',
        categorySlug: 'getting-started',
        title: 'Quick Start Guide',
        status: 'published',
        content: `# Quick Start Guide

Welcome to Outpost! This guide will help you get up and running in under 5 minutes.

## Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- An active Outpost account with admin or agent permissions

## Step 1: Connect Your Channels

Navigate to **Settings > Integrations** and connect at least one support channel:

- **Discord**: Add the Outpost bot to your server
- **GitHub**: Install the Outpost GitHub App
- **Email**: Configure your support email forwarding

## Step 2: Configure Your Team

Go to **Accounts > Team** and invite your team members. Assign roles:

| Role | Permissions |
|------|------------|
| Admin | Full access |
| Agent | Ticket management |
| Viewer | Read-only |

## Step 3: Set Up SLA Rules

Define your response and resolution time targets under **Settings > SLA**.

> **Tip**: Start with generous SLA targets and tighten them as your team finds its rhythm.

That's it! You're ready to start handling support tickets.`,
        updatedAt: daysAgo(1),
        createdAt: daysAgo(30),
        source: 'manual',
    },
    {
        id: 'art-002',
        categorySlug: 'getting-started',
        title: 'Understanding the Dashboard',
        status: 'published',
        content: `# Understanding the Dashboard

The dashboard provides a real-time overview of your support operations.

## Key Metrics

- **Open Tickets**: Total unresolved tickets
- **Avg Response Time**: Mean first-response time over the last 7 days
- **SLA Compliance**: Percentage of tickets meeting SLA targets
- **CSAT Score**: Customer satisfaction rating

## Widgets

Each widget on the dashboard is interactive. Click any metric to drill down into the underlying data.

## Customization

Drag and drop widgets to rearrange your dashboard layout. Your preferences are saved automatically.`,
        updatedAt: daysAgo(3),
        createdAt: daysAgo(28),
        source: 'manual',
    },
    {
        id: 'art-003',
        categorySlug: 'getting-started',
        title: 'Configuring Notifications',
        status: 'draft',
        content: `# Configuring Notifications

Stay on top of critical events with Outpost's notification system.

## Notification Channels

- **In-app**: Bell icon in the top-right corner
- **Email**: Digests sent to your registered email
- **Slack**: Real-time alerts via webhook

## Notification Rules

Create rules to control which events trigger notifications:

1. Go to **Settings > Notifications**
2. Click **Add Rule**
3. Select the event type and delivery channel
4. Set any conditions (e.g., only for high-priority tickets)`,
        updatedAt: daysAgo(2),
        createdAt: daysAgo(10),
        source: 'ai',
    },
    {
        id: 'art-004',
        categorySlug: 'getting-started',
        title: 'Inviting Team Members',
        status: 'published',
        content: `# Inviting Team Members

Grow your support team by inviting colleagues to Outpost.

## How to Invite

1. Navigate to **Settings > Team**
2. Click **Invite Member**
3. Enter their email address and select a role
4. They'll receive an invitation email with setup instructions

## Role Permissions

- **Admin**: Full configuration access, billing, team management
- **Agent**: Create/manage tickets, respond to customers, view reports
- **Viewer**: Read-only access to tickets and reports`,
        updatedAt: daysAgo(5),
        createdAt: daysAgo(25),
        source: 'manual',
    },
    {
        id: 'art-005',
        categorySlug: 'getting-started',
        title: 'Keyboard Shortcuts Reference',
        status: 'draft',
        content: `# Keyboard Shortcuts Reference

Speed up your workflow with these keyboard shortcuts.

## Global Shortcuts

| Shortcut | Action |
|----------|--------|
| \`Ctrl+K\` | Open command palette |
| \`Ctrl+/\` | Toggle sidebar |
| \`Ctrl+N\` | New ticket |

## Ticket View

| Shortcut | Action |
|----------|--------|
| \`J/K\` | Navigate between tickets |
| \`R\` | Reply |
| \`E\` | Edit |
| \`Ctrl+Enter\` | Submit reply |`,
        updatedAt: daysAgo(1),
        createdAt: daysAgo(7),
        source: 'ai',
    },

    // API Reference
    {
        id: 'art-006',
        categorySlug: 'api-reference',
        title: 'Authentication & API Keys',
        status: 'published',
        content: `# Authentication & API Keys

All API requests require authentication via Bearer token.

## Getting Your API Key

1. Go to **Settings > API**
2. Click **Generate New Key**
3. Copy and store the key securely (it won't be shown again)

## Using the Key

\`\`\`bash
curl -H "Authorization: Bearer YOUR_API_KEY" \\
     https://api.outpost.dev/v1/tickets
\`\`\`

## Rate Limits

- **Standard plan**: 100 requests/minute
- **Pro plan**: 1,000 requests/minute
- **Enterprise**: Custom limits`,
        updatedAt: daysAgo(4),
        createdAt: daysAgo(20),
        source: 'manual',
    },
    {
        id: 'art-007',
        categorySlug: 'api-reference',
        title: 'Tickets API Endpoints',
        status: 'published',
        content: `# Tickets API Endpoints

## List Tickets

\`\`\`
GET /api/v1/tickets
\`\`\`

### Parameters

| Param | Type | Description |
|-------|------|-------------|
| status | string | Filter by status |
| priority | string | Filter by priority |
| page | number | Page number (default: 1) |
| pageSize | number | Items per page (default: 20) |

## Create Ticket

\`\`\`
POST /api/v1/tickets
\`\`\`

### Body

\`\`\`json
{
  "title": "string (required)",
  "description": "string (required)",
  "priority": "low | medium | high | critical"
}
\`\`\``,
        updatedAt: daysAgo(2),
        createdAt: daysAgo(18),
        source: 'manual',
    },
    {
        id: 'art-008',
        categorySlug: 'api-reference',
        title: 'Webhooks Configuration',
        status: 'draft',
        content: `# Webhooks Configuration

Receive real-time notifications when events occur in Outpost.

## Setting Up Webhooks

1. Go to **Settings > Webhooks**
2. Click **Add Endpoint**
3. Enter your URL and select events to subscribe to

## Event Types

- \`ticket.created\`
- \`ticket.updated\`
- \`ticket.resolved\`
- \`message.received\`
- \`sla.breached\`

## Payload Format

All webhook payloads follow this structure:

\`\`\`json
{
  "event": "ticket.created",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": { ... }
}
\`\`\``,
        updatedAt: daysAgo(6),
        createdAt: daysAgo(15),
        source: 'ai',
    },
    {
        id: 'art-009',
        categorySlug: 'api-reference',
        title: 'Error Codes Reference',
        status: 'published',
        content: `# Error Codes Reference

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Missing or invalid API key |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 429 | Rate Limited - Too many requests |
| 500 | Internal Error - Contact support |

## Error Response Format

\`\`\`json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "The 'status' field must be one of: open, in_progress, resolved, closed",
    "details": { "field": "status" }
  }
}
\`\`\``,
        updatedAt: daysAgo(8),
        createdAt: daysAgo(20),
        source: 'manual',
    },
    {
        id: 'art-010',
        categorySlug: 'api-reference',
        title: 'Bulk Operations API',
        status: 'draft',
        content: `# Bulk Operations API

Perform operations on multiple resources in a single request.

## Bulk Update Tickets

\`\`\`
POST /api/v1/tickets/bulk
\`\`\`

### Body

\`\`\`json
{
  "ids": ["tkt-001", "tkt-002", "tkt-003"],
  "action": "update",
  "fields": {
    "status": "resolved",
    "assigneeId": "user-123"
  }
}
\`\`\`

## Limits

- Maximum 100 items per bulk request
- Bulk operations are processed asynchronously for large batches`,
        updatedAt: daysAgo(3),
        createdAt: daysAgo(12),
        source: 'ai',
    },

    // Guides
    {
        id: 'art-011',
        categorySlug: 'guides',
        title: 'Setting Up Discord Integration',
        status: 'published',
        content: `# Setting Up Discord Integration

Connect your Discord server to automatically create tickets from support channels.

## Prerequisites

- Discord server with admin permissions
- Outpost admin account

## Installation Steps

1. Go to **Settings > Integrations > Discord**
2. Click **Connect Discord**
3. Authorize the Outpost bot in your server
4. Select which channels to monitor

## Channel Mapping

Map Discord channels to ticket categories:

- \`#general-support\` -> General tickets
- \`#bug-reports\` -> Bug tickets
- \`#feature-requests\` -> Feature request tickets

## Message Threading

When a ticket is created from Discord, all replies in the thread are synced back to the ticket automatically.`,
        updatedAt: daysAgo(2),
        createdAt: daysAgo(22),
        source: 'manual',
    },
    {
        id: 'art-012',
        categorySlug: 'guides',
        title: 'Creating Effective SLA Policies',
        status: 'published',
        content: `# Creating Effective SLA Policies

Service Level Agreements keep your team accountable and your customers happy.

## Planning Your SLAs

Consider these factors:
- Team size and availability
- Customer tier (enterprise vs free)
- Ticket priority levels

## Recommended Starting Points

| Priority | First Response | Resolution |
|----------|---------------|------------|
| Critical | 15 minutes | 4 hours |
| High | 1 hour | 8 hours |
| Medium | 4 hours | 24 hours |
| Low | 8 hours | 72 hours |

## Escalation Rules

Configure automatic escalation when SLAs are about to breach:

1. **Warning** at 75% of time elapsed
2. **Escalate** at 90% of time elapsed
3. **Breach notification** when SLA is violated`,
        updatedAt: daysAgo(5),
        createdAt: daysAgo(19),
        source: 'manual',
    },
    {
        id: 'art-013',
        categorySlug: 'guides',
        title: 'Using AI-Powered Ticket Triage',
        status: 'draft',
        content: `# Using AI-Powered Ticket Triage

Outpost's AI engine automatically categorizes and prioritizes incoming tickets.

## How It Works

1. A new ticket arrives from any channel
2. The AI analyzes the content, tone, and context
3. It assigns a priority, category, and suggested assignee
4. The ticket appears in the queue with AI recommendations

## Accuracy & Confidence

The AI provides a confidence score with each classification:

- **High (>90%)**: Auto-applied without review
- **Medium (70-90%)**: Applied but flagged for review
- **Low (<70%)**: Queued for manual triage

## Training the Model

The AI improves over time as agents confirm or correct its suggestions. No manual training is required.`,
        updatedAt: daysAgo(1),
        createdAt: daysAgo(8),
        source: 'ai',
    },
    {
        id: 'art-014',
        categorySlug: 'guides',
        title: 'Reporting and Analytics Guide',
        status: 'published',
        content: `# Reporting and Analytics Guide

Gain insights into your support operations with built-in analytics.

## Available Reports

- **Ticket Volume**: Track ticket creation trends over time
- **Resolution Time**: Measure how quickly tickets are resolved
- **Agent Performance**: Compare workload and response times
- **Customer Satisfaction**: Monitor CSAT scores and trends

## Exporting Data

All reports can be exported as CSV or PDF:

1. Navigate to the report you want
2. Click the **Export** button in the top-right
3. Select your format and date range

## Scheduled Reports

Set up automatic report delivery:

1. Go to **Settings > Scheduled Reports**
2. Configure recipients, frequency, and report type`,
        updatedAt: daysAgo(4),
        createdAt: daysAgo(16),
        source: 'manual',
    },
    {
        id: 'art-015',
        categorySlug: 'guides',
        title: 'Migrating from Zendesk',
        status: 'draft',
        content: `# Migrating from Zendesk

Move your existing support data from Zendesk to Outpost with minimal downtime.

## What Gets Migrated

- Tickets (including full message history)
- Customer profiles
- Tags and categories
- Attachments

## Migration Steps

1. Export your Zendesk data via their API or CSV export
2. Go to **Settings > Import > Zendesk**
3. Upload your export file or provide API credentials
4. Map fields between Zendesk and Outpost
5. Start the migration

## Timeline

| Data Volume | Estimated Time |
|-------------|---------------|
| < 10,000 tickets | ~30 minutes |
| 10,000 - 100,000 | ~2 hours |
| > 100,000 | ~6 hours |

## Post-Migration Checklist

- [ ] Verify ticket counts match
- [ ] Spot-check message threads
- [ ] Test automation rules
- [ ] Update webhook URLs`,
        updatedAt: daysAgo(3),
        createdAt: daysAgo(5),
        source: 'loom',
    },
];

export const MOCK_CATEGORIES: DocCategory[] = [
    {
        slug: 'getting-started',
        name: 'Getting Started',
        description: 'Quick start guides and tutorials for new users',
        articleCount: MOCK_ARTICLES.filter(a => a.categorySlug === 'getting-started').length,
    },
    {
        slug: 'api-reference',
        name: 'API Reference',
        description: 'Complete API documentation and endpoint reference',
        articleCount: MOCK_ARTICLES.filter(a => a.categorySlug === 'api-reference').length,
    },
    {
        slug: 'guides',
        name: 'Guides',
        description: 'In-depth guides for common use cases and workflows',
        articleCount: MOCK_ARTICLES.filter(a => a.categorySlug === 'guides').length,
    },
];

export function getArticlesByCategory(slug: string): DocArticle[] {
    return MOCK_ARTICLES.filter(a => a.categorySlug === slug);
}

export function getArticleById(id: string): DocArticle | undefined {
    return MOCK_ARTICLES.find(a => a.id === id);
}

export function getCategoryBySlug(slug: string): DocCategory | undefined {
    return MOCK_CATEGORIES.find(c => c.slug === slug);
}

export function isValidLoomUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'www.loom.com' || parsed.hostname === 'loom.com';
    } catch {
        return false;
    }
}
