import { describe, it, expect, vi } from 'vitest';
import { Logger, createLogger, type LogEntry } from '../logger.js';

describe('Logger', () => {
    function collectingLogger(service: string, minLevel?: 'debug' | 'info' | 'warn' | 'error' | 'fatal') {
        const entries: LogEntry[] = [];
        const logger = new Logger({
            service,
            minLevel,
            writer: (entry) => entries.push(entry),
        });
        return { logger, entries };
    }

    it('outputs JSON with required fields', () => {
        const { logger, entries } = collectingLogger('test-svc');
        logger.info('hello world');

        expect(entries).toHaveLength(1);
        const entry = entries[0];
        expect(entry.timestamp).toBeDefined();
        expect(entry.level).toBe('info');
        expect(entry.service).toBe('test-svc');
        expect(entry.message).toBe('hello world');
    });

    it('includes arbitrary metadata in the log entry', () => {
        const { logger, entries } = collectingLogger('test-svc');
        logger.warn('disk full', { disk: '/dev/sda1', usagePercent: 99 });

        expect(entries[0].disk).toBe('/dev/sda1');
        expect(entries[0].usagePercent).toBe(99);
    });

    it('respects minimum log level', () => {
        const { logger, entries } = collectingLogger('test-svc', 'warn');
        logger.debug('nope');
        logger.info('nope');
        logger.warn('yes');
        logger.error('also yes');

        expect(entries).toHaveLength(2);
        expect(entries[0].level).toBe('warn');
        expect(entries[1].level).toBe('error');
    });

    it('emits all levels when minLevel is debug', () => {
        const { logger, entries } = collectingLogger('test-svc', 'debug');
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
        logger.fatal('f');

        expect(entries).toHaveLength(5);
    });

    it('produces a valid ISO timestamp', () => {
        const { logger, entries } = collectingLogger('test-svc');
        logger.info('ts test');

        const parsed = new Date(entries[0].timestamp);
        expect(parsed.getTime()).not.toBeNaN();
    });

    it('createLogger convenience factory works', () => {
        const logger = createLogger('my-service', 'error');
        // Just confirm it does not throw
        expect(logger).toBeInstanceOf(Logger);
    });

    it('default writer uses console.log for info and console.error for errors', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const logger = createLogger('svc');
        logger.info('an info message');
        logger.error('an error message');

        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(errSpy).toHaveBeenCalledTimes(1);

        const infoJson = JSON.parse(logSpy.mock.calls[0][0] as string);
        expect(infoJson.level).toBe('info');

        const errJson = JSON.parse(errSpy.mock.calls[0][0] as string);
        expect(errJson.level).toBe('error');

        logSpy.mockRestore();
        errSpy.mockRestore();
    });
});
