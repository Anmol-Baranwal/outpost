/**
 * Structured JSON logging utility for production services.
 *
 * Outputs one JSON object per line with consistent fields:
 *   timestamp, level, service, message, and optional metadata.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
};

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    service: string;
    message: string;
    [key: string]: unknown;
}

export interface LoggerOptions {
    service: string;
    minLevel?: LogLevel;
    /** Override for testing — defaults to console.log / console.error */
    writer?: (entry: LogEntry) => void;
}

export class Logger {
    private service: string;
    private minLevel: number;
    private writer: (entry: LogEntry) => void;

    constructor(options: LoggerOptions) {
        this.service = options.service;
        this.minLevel = LOG_LEVEL_ORDER[options.minLevel ?? 'info'];
        this.writer = options.writer ?? defaultWriter;
    }

    debug(message: string, meta?: Record<string, unknown>): void {
        this.log('debug', message, meta);
    }

    info(message: string, meta?: Record<string, unknown>): void {
        this.log('info', message, meta);
    }

    warn(message: string, meta?: Record<string, unknown>): void {
        this.log('warn', message, meta);
    }

    error(message: string, meta?: Record<string, unknown>): void {
        this.log('error', message, meta);
    }

    fatal(message: string, meta?: Record<string, unknown>): void {
        this.log('fatal', message, meta);
    }

    log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
        if (LOG_LEVEL_ORDER[level] < this.minLevel) {
            return;
        }

        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            service: this.service,
            message,
            ...meta,
        };

        this.writer(entry);
    }
}

function defaultWriter(entry: LogEntry): void {
    const json = JSON.stringify(entry);
    if (entry.level === 'error' || entry.level === 'fatal') {
        console.error(json);
    } else {
        console.log(json);
    }
}

/**
 * Convenience factory — one logger per service.
 */
export function createLogger(service: string, minLevel?: LogLevel): Logger {
    return new Logger({ service, minLevel });
}
