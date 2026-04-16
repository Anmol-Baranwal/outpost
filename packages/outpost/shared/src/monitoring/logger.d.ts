/**
 * Structured JSON logging utility for production services.
 *
 * Outputs one JSON object per line with consistent fields:
 *   timestamp, level, service, message, and optional metadata.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
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
export declare class Logger {
    private service;
    private minLevel;
    private writer;
    constructor(options: LoggerOptions);
    debug(message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
    fatal(message: string, meta?: Record<string, unknown>): void;
    log(level: LogLevel, message: string, meta?: Record<string, unknown>): void;
}
/**
 * Convenience factory — one logger per service.
 */
export declare function createLogger(service: string, minLevel?: LogLevel): Logger;
//# sourceMappingURL=logger.d.ts.map