'use client';

import { useState, useCallback } from 'react';
import type { Agent } from './agent-table';

export type AgentTriggerType = 'interval' | 'cron' | 'manual';
export type AgentActionType =
    | 'classify_tickets'
    | 'check_sla'
    | 'generate_faq'
    | 'custom_webhook';

export interface AgentConfig {
    triggerType: AgentTriggerType;
    intervalMinutes?: number;
    cronExpression?: string;
    actionType: AgentActionType;
    webhookUrl?: string;
}

const ACTION_TYPE_LABELS: Record<AgentActionType, string> = {
    classify_tickets: 'Run AI classification on unclassified tickets',
    check_sla: 'Check SLA compliance',
    generate_faq: 'Generate FAQ from recent tickets',
    custom_webhook: 'Custom webhook',
};

const TRIGGER_TYPE_LABELS: Record<AgentTriggerType, string> = {
    interval: 'Interval',
    cron: 'Cron',
    manual: 'Manual',
};

export interface AgentFormData {
    name: string;
    description: string;
    config: AgentConfig;
}

interface AgentFormProps {
    agent?: Agent;
    onSubmit: (data: AgentFormData) => void;
    onCancel: () => void;
}

interface FormErrors {
    name?: string;
    intervalMinutes?: string;
    cronExpression?: string;
    webhookUrl?: string;
}

export function validateAgentForm(data: AgentFormData): FormErrors {
    const errors: FormErrors = {};

    if (!data.name.trim()) {
        errors.name = 'Name is required';
    }

    if (data.config.triggerType === 'interval') {
        if (!data.config.intervalMinutes || data.config.intervalMinutes < 1) {
            errors.intervalMinutes = 'Interval must be at least 1 minute';
        }
    }

    if (data.config.triggerType === 'cron') {
        if (!data.config.cronExpression?.trim()) {
            errors.cronExpression = 'Cron expression is required';
        }
    }

    if (data.config.actionType === 'custom_webhook') {
        if (!data.config.webhookUrl?.trim()) {
            errors.webhookUrl = 'Webhook URL is required';
        } else {
            try {
                new URL(data.config.webhookUrl);
            } catch {
                errors.webhookUrl = 'Must be a valid URL';
            }
        }
    }

    return errors;
}

export function AgentForm({ agent, onSubmit, onCancel }: AgentFormProps) {
    const agentConfig = agent?.config as AgentConfig | undefined;
    const [name, setName] = useState(agent?.name ?? '');
    const [description, setDescription] = useState(agent?.description ?? '');
    const [triggerType, setTriggerType] = useState<AgentTriggerType>(
        agentConfig?.triggerType ?? 'manual',
    );
    const [intervalMinutes, setIntervalMinutes] = useState<number>(
        agentConfig?.intervalMinutes ?? 15,
    );
    const [cronExpression, setCronExpression] = useState(
        agentConfig?.cronExpression ?? '',
    );
    const [actionType, setActionType] = useState<AgentActionType>(
        agentConfig?.actionType ?? 'classify_tickets',
    );
    const [webhookUrl, setWebhookUrl] = useState(
        agentConfig?.webhookUrl ?? '',
    );
    const [errors, setErrors] = useState<FormErrors>({});

    const handleSubmit = useCallback(
        (e: React.FormEvent) => {
            e.preventDefault();

            const formData: AgentFormData = {
                name,
                description,
                config: {
                    triggerType,
                    actionType,
                    ...(triggerType === 'interval' ? { intervalMinutes } : {}),
                    ...(triggerType === 'cron' ? { cronExpression } : {}),
                    ...(actionType === 'custom_webhook' ? { webhookUrl } : {}),
                },
            };

            const validationErrors = validateAgentForm(formData);
            if (Object.keys(validationErrors).length > 0) {
                setErrors(validationErrors);
                return;
            }

            setErrors({});
            onSubmit(formData);
        },
        [name, description, triggerType, intervalMinutes, cronExpression, actionType, webhookUrl, onSubmit],
    );

    const inputClass =
        'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
    const labelClass = 'block text-sm font-medium text-foreground mb-1';
    const errorClass = 'text-xs text-red-400 mt-1';

    return (
        <form onSubmit={handleSubmit} data-testid="agent-form" className="space-y-5">
            {/* Name */}
            <div>
                <label htmlFor="agent-name" className={labelClass}>
                    Name
                </label>
                <input
                    id="agent-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Auto-Classifier"
                    className={inputClass}
                    data-testid="agent-name-input"
                />
                {errors.name && (
                    <p className={errorClass} data-testid="agent-name-error">{errors.name}</p>
                )}
            </div>

            {/* Description */}
            <div>
                <label htmlFor="agent-description" className={labelClass}>
                    Description
                </label>
                <textarea
                    id="agent-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does this agent do?"
                    rows={3}
                    className={inputClass}
                    data-testid="agent-description-input"
                />
            </div>

            {/* Trigger Type */}
            <div>
                <label htmlFor="agent-trigger" className={labelClass}>
                    Trigger Type
                </label>
                <select
                    id="agent-trigger"
                    value={triggerType}
                    onChange={(e) => setTriggerType(e.target.value as AgentTriggerType)}
                    className={inputClass}
                    data-testid="agent-trigger-select"
                >
                    {(Object.entries(TRIGGER_TYPE_LABELS) as [AgentTriggerType, string][]).map(
                        ([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ),
                    )}
                </select>
            </div>

            {/* Interval config */}
            {triggerType === 'interval' && (
                <div>
                    <label htmlFor="agent-interval" className={labelClass}>
                        Interval (minutes)
                    </label>
                    <input
                        id="agent-interval"
                        type="number"
                        min={1}
                        value={intervalMinutes}
                        onChange={(e) => setIntervalMinutes(parseInt(e.target.value, 10) || 0)}
                        className={inputClass}
                        data-testid="agent-interval-input"
                    />
                    {errors.intervalMinutes && (
                        <p className={errorClass} data-testid="agent-interval-error">
                            {errors.intervalMinutes}
                        </p>
                    )}
                </div>
            )}

            {/* Cron config */}
            {triggerType === 'cron' && (
                <div>
                    <label htmlFor="agent-cron" className={labelClass}>
                        Cron Expression
                    </label>
                    <input
                        id="agent-cron"
                        type="text"
                        value={cronExpression}
                        onChange={(e) => setCronExpression(e.target.value)}
                        placeholder="0 */6 * * *"
                        className={inputClass}
                        data-testid="agent-cron-input"
                    />
                    {errors.cronExpression && (
                        <p className={errorClass} data-testid="agent-cron-error">
                            {errors.cronExpression}
                        </p>
                    )}
                </div>
            )}

            {/* Action Type */}
            <div>
                <label htmlFor="agent-action" className={labelClass}>
                    Action Type
                </label>
                <select
                    id="agent-action"
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value as AgentActionType)}
                    className={inputClass}
                    data-testid="agent-action-select"
                >
                    {(Object.entries(ACTION_TYPE_LABELS) as [AgentActionType, string][]).map(
                        ([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ),
                    )}
                </select>
            </div>

            {/* Webhook URL */}
            {actionType === 'custom_webhook' && (
                <div>
                    <label htmlFor="agent-webhook" className={labelClass}>
                        Webhook URL
                    </label>
                    <input
                        id="agent-webhook"
                        type="url"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        placeholder="https://hooks.example.com/..."
                        className={inputClass}
                        data-testid="agent-webhook-input"
                    />
                    {errors.webhookUrl && (
                        <p className={errorClass} data-testid="agent-webhook-error">
                            {errors.webhookUrl}
                        </p>
                    )}
                </div>
            )}

            {/* Buttons */}
            <div className="flex items-center gap-3 pt-2">
                <button
                    type="submit"
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                    data-testid="agent-submit-btn"
                >
                    {agent ? 'Update Agent' : 'Create Agent'}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                    data-testid="agent-cancel-btn"
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}
