import { describe, it, expect } from 'vitest';
import { AlertManager, createAlertManager, type Alert } from '../alerts.js';

describe('AlertManager', () => {
    function collectingAlertManager(service: string) {
        const fired: Alert[] = [];
        const manager = new AlertManager({
            service,
            handler: (alert) => {
                fired.push(alert);
            },
        });
        return { manager, fired };
    }

    describe('slaBreached', () => {
        it('fires a warning when elapsed is under 2x the target', () => {
            const { manager, fired } = collectingAlertManager('sla-test');

            manager.slaBreached({
                ticketId: 'T-100',
                priority: 'high',
                breachType: 'first_response',
                elapsedMinutes: 45,
                targetMinutes: 30,
            });

            expect(fired).toHaveLength(1);
            expect(fired[0].severity).toBe('warning');
            expect(fired[0].title).toContain('SLA breach');
            expect(fired[0].title).toContain('first_response');
            expect(fired[0].details).toContain('T-100');
            expect(fired[0].timestamp).toBeDefined();
        });

        it('fires a critical alert when elapsed exceeds 2x target', () => {
            const { manager, fired } = collectingAlertManager('sla-test');

            manager.slaBreached({
                ticketId: 'T-200',
                priority: 'urgent',
                breachType: 'resolution',
                elapsedMinutes: 121,
                targetMinutes: 60,
            });

            expect(fired).toHaveLength(1);
            expect(fired[0].severity).toBe('critical');
        });
    });

    describe('botFailure', () => {
        it('always fires critical severity', () => {
            const { manager, fired } = collectingAlertManager('bot-test');

            manager.botFailure({
                bot: 'discord',
                error: 'WebSocket closed unexpectedly',
            });

            expect(fired).toHaveLength(1);
            expect(fired[0].severity).toBe('critical');
            expect(fired[0].title).toContain('discord');
            expect(fired[0].details).toContain('WebSocket closed unexpectedly');
        });

        it('includes optional context in details', () => {
            const { manager, fired } = collectingAlertManager('bot-test');

            manager.botFailure({
                bot: 'github',
                error: 'Rate limited',
                context: 'during webhook processing',
            });

            expect(fired[0].details).toContain('Rate limited');
            expect(fired[0].details).toContain('during webhook processing');
        });
    });

    describe('fire', () => {
        it('adds a timestamp automatically', () => {
            const { manager, fired } = collectingAlertManager('generic');

            manager.fire({
                severity: 'warning',
                title: 'custom alert',
                service: 'custom-svc',
                details: 'details here',
            });

            expect(fired).toHaveLength(1);
            const ts = new Date(fired[0].timestamp);
            expect(ts.getTime()).not.toBeNaN();
        });
    });

    it('createAlertManager convenience factory works', () => {
        const manager = createAlertManager('my-service');
        expect(manager).toBeInstanceOf(AlertManager);
    });
});
