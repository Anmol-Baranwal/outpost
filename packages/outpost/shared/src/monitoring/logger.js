/**
 * Structured JSON logging utility for production services.
 *
 * Outputs one JSON object per line with consistent fields:
 *   timestamp, level, service, message, and optional metadata.
 */
const LOG_LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
};
export class Logger {
    service;
    minLevel;
    writer;
    constructor(options) {
        this.service = options.service;
        this.minLevel = LOG_LEVEL_ORDER[options.minLevel ?? 'info'];
        this.writer = options.writer ?? defaultWriter;
    }
    debug(message, meta) {
        this.log('debug', message, meta);
    }
    info(message, meta) {
        this.log('info', message, meta);
    }
    warn(message, meta) {
        this.log('warn', message, meta);
    }
    error(message, meta) {
        this.log('error', message, meta);
    }
    fatal(message, meta) {
        this.log('fatal', message, meta);
    }
    log(level, message, meta) {
        if (LOG_LEVEL_ORDER[level] < this.minLevel) {
            return;
        }
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            service: this.service,
            message,
            ...meta,
        };
        this.writer(entry);
    }
}
function defaultWriter(entry) {
    const json = JSON.stringify(entry);
    if (entry.level === 'error' || entry.level === 'fatal') {
        console.error(json);
    }
    else {
        console.log(json);
    }
}
/**
 * Convenience factory — one logger per service.
 */
export function createLogger(service, minLevel) {
    return new Logger({ service, minLevel });
}
