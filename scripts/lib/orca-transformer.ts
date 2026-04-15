// ─── Orca → Outpost Data Transformer ────────────────────────────────────────
// Maps Orca export entities to Outpost Prisma model shapes.

import type { OrcaAccount, OrcaMessage, OrcaTicket, OrcaUser } from './orca-types.js';

// ─── Status Mapping ─────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, string> = {
    'open': 'OPEN',
    'new': 'OPEN',
    'in_progress': 'IN_PROGRESS',
    'in progress': 'IN_PROGRESS',
    'pending': 'IN_PROGRESS',
    'waiting': 'WAITING_ON_CUSTOMER',
    'waiting_on_customer': 'WAITING_ON_CUSTOMER',
    'waiting_on_team': 'WAITING_ON_TEAM',
    'resolved': 'RESOLVED',
    'closed': 'CLOSED',
};

const PRIORITY_MAP: Record<string, string> = {
    'critical': 'CRITICAL',
    'urgent': 'CRITICAL',
    'high': 'HIGH',
    'medium': 'MEDIUM',
    'normal': 'MEDIUM',
    'low': 'LOW',
};

const TYPE_MAP: Record<string, string> = {
    'bug': 'BUG',
    'feature_request': 'FEATURE_REQUEST',
    'feature': 'FEATURE_REQUEST',
    'question': 'QUESTION',
    'integration_help': 'INTEGRATION_HELP',
    'integration': 'INTEGRATION_HELP',
    'account_issue': 'ACCOUNT_ISSUE',
    'account': 'ACCOUNT_ISSUE',
    'other': 'OTHER',
};

const MESSAGE_TYPE_MAP: Record<string, string> = {
    'user': 'USER',
    'customer': 'USER',
    'bot': 'BOT',
    'ai': 'BOT',
    'system': 'SYSTEM',
    'auto': 'SYSTEM',
};

// ─── Transformed Types ──────────────────────────────────────────────────────
// These match the shape Prisma expects for create operations.

export interface TransformedAccount {
    name: string;
    domain: string | null;
    owner: string | null;
}

export interface TransformedUser {
    name: string;
    email: string;
    domain: string | null;
    externalId: string | null;
    source: 'ORCA';
}

export interface TransformedTicket {
    displayId: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    type: string;
    source: 'ORCA';
    sourceId: string;
    sourceUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface TransformedMessage {
    author: string;
    content: string;
    type: string;
    isAiGenerated: boolean;
    attachments: unknown[] | null;
    createdAt: Date;
}

// ─── Transformers ───────────────────────────────────────────────────────────

export function transformAccount(orca: OrcaAccount): TransformedAccount {
    return {
        name: orca.name,
        domain: orca.domain ?? null,
        owner: orca.owner ?? null,
    };
}

export function transformUser(orca: OrcaUser): TransformedUser {
    return {
        name: orca.name,
        email: orca.email,
        domain: orca.domain ?? null,
        externalId: orca.external_id ?? null,
        source: 'ORCA',
    };
}

export function transformTicket(orca: OrcaTicket, displayId: string): TransformedTicket {
    const statusKey = (orca.status ?? 'open').toLowerCase();
    const priorityKey = (orca.priority ?? 'medium').toLowerCase();
    const typeKey = (orca.type ?? 'question').toLowerCase();

    return {
        displayId,
        title: orca.title,
        description: orca.description ?? '',
        status: STATUS_MAP[statusKey] ?? 'OPEN',
        priority: PRIORITY_MAP[priorityKey] ?? 'MEDIUM',
        type: TYPE_MAP[typeKey] ?? 'OTHER',
        source: 'ORCA',
        sourceId: orca.id,
        sourceUrl: orca.source_url ?? null,
        createdAt: orca.created_at ? new Date(orca.created_at) : new Date(),
        updatedAt: orca.updated_at ? new Date(orca.updated_at) : new Date(),
    };
}

export function transformMessage(orca: OrcaMessage): TransformedMessage {
    const typeKey = (orca.type ?? 'user').toLowerCase();

    return {
        author: orca.author,
        content: orca.content,
        type: MESSAGE_TYPE_MAP[typeKey] ?? 'USER',
        isAiGenerated: orca.is_ai_generated ?? false,
        attachments: orca.attachments ?? null,
        createdAt: orca.created_at ? new Date(orca.created_at) : new Date(),
    };
}
