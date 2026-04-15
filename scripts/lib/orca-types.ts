// ─── Orca Export Data Types ─────────────────────────────────────────────────
// Types representing the shape of data exported from Orca (app.getorca.ai).
// Used by the migration script to validate and transform incoming data.

export interface OrcaUser {
    id: string;
    name: string;
    email: string;
    domain?: string | null;
    external_id?: string | null;
    created_at?: string | null;
}

export interface OrcaAccount {
    id: string;
    name: string;
    domain?: string | null;
    owner?: string | null;
    created_at?: string | null;
}

export interface OrcaMessage {
    id: string;
    ticket_id: string;
    author: string;
    content: string;
    type?: string | null; // "user" | "bot" | "system"
    is_ai_generated?: boolean | null;
    attachments?: unknown[] | null;
    created_at?: string | null;
}

export interface OrcaTicket {
    id: string;
    title: string;
    description: string;
    status?: string | null; // "open" | "in_progress" | "waiting" | "resolved" | "closed"
    priority?: string | null; // "critical" | "high" | "medium" | "low"
    type?: string | null; // "bug" | "feature_request" | "question" | etc.
    assignee_email?: string | null;
    account_id?: string | null;
    user_id?: string | null;
    messages?: OrcaMessage[];
    source_url?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
}

export interface OrcaExport {
    accounts: OrcaAccount[];
    users: OrcaUser[];
    tickets: OrcaTicket[];
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface ValidationError {
    entity: string;
    id: string;
    field: string;
    message: string;
}

export function validateOrcaExport(data: unknown): { valid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    if (typeof data !== 'object' || data === null) {
        errors.push({ entity: 'export', id: '', field: 'root', message: 'Export data must be an object' });
        return { valid: false, errors };
    }

    const obj = data as Record<string, unknown>;

    if (!Array.isArray(obj.accounts)) {
        errors.push({ entity: 'export', id: '', field: 'accounts', message: 'Missing or invalid accounts array' });
    } else {
        for (const account of obj.accounts) {
            errors.push(...validateOrcaAccount(account));
        }
    }

    if (!Array.isArray(obj.users)) {
        errors.push({ entity: 'export', id: '', field: 'users', message: 'Missing or invalid users array' });
    } else {
        for (const user of obj.users) {
            errors.push(...validateOrcaUser(user));
        }
    }

    if (!Array.isArray(obj.tickets)) {
        errors.push({ entity: 'export', id: '', field: 'tickets', message: 'Missing or invalid tickets array' });
    } else {
        for (const ticket of obj.tickets) {
            errors.push(...validateOrcaTicket(ticket));
        }
    }

    return { valid: errors.length === 0, errors };
}

function validateOrcaAccount(data: unknown): ValidationError[] {
    const errors: ValidationError[] = [];
    if (typeof data !== 'object' || data === null) {
        errors.push({ entity: 'account', id: '?', field: 'root', message: 'Account must be an object' });
        return errors;
    }
    const obj = data as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : '?';
    if (typeof obj.id !== 'string' || obj.id.length === 0) {
        errors.push({ entity: 'account', id, field: 'id', message: 'Missing or invalid id' });
    }
    if (typeof obj.name !== 'string' || obj.name.length === 0) {
        errors.push({ entity: 'account', id, field: 'name', message: 'Missing or invalid name' });
    }
    return errors;
}

function validateOrcaUser(data: unknown): ValidationError[] {
    const errors: ValidationError[] = [];
    if (typeof data !== 'object' || data === null) {
        errors.push({ entity: 'user', id: '?', field: 'root', message: 'User must be an object' });
        return errors;
    }
    const obj = data as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : '?';
    if (typeof obj.id !== 'string' || obj.id.length === 0) {
        errors.push({ entity: 'user', id, field: 'id', message: 'Missing or invalid id' });
    }
    if (typeof obj.name !== 'string' || obj.name.length === 0) {
        errors.push({ entity: 'user', id, field: 'name', message: 'Missing or invalid name' });
    }
    if (typeof obj.email !== 'string' || obj.email.length === 0) {
        errors.push({ entity: 'user', id, field: 'email', message: 'Missing or invalid email' });
    }
    return errors;
}

function validateOrcaTicket(data: unknown): ValidationError[] {
    const errors: ValidationError[] = [];
    if (typeof data !== 'object' || data === null) {
        errors.push({ entity: 'ticket', id: '?', field: 'root', message: 'Ticket must be an object' });
        return errors;
    }
    const obj = data as Record<string, unknown>;
    const id = typeof obj.id === 'string' ? obj.id : '?';
    if (typeof obj.id !== 'string' || obj.id.length === 0) {
        errors.push({ entity: 'ticket', id, field: 'id', message: 'Missing or invalid id' });
    }
    if (typeof obj.title !== 'string' || obj.title.length === 0) {
        errors.push({ entity: 'ticket', id, field: 'title', message: 'Missing or invalid title' });
    }
    if (typeof obj.description !== 'string') {
        errors.push({ entity: 'ticket', id, field: 'description', message: 'Missing or invalid description' });
    }
    return errors;
}
