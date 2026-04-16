/**
 * Core types shared across all Outpost apps and packages.
 */
export declare enum TicketStatus {
    OPEN = "OPEN",
    IN_PROGRESS = "IN_PROGRESS",
    WAITING_ON_CUSTOMER = "WAITING_ON_CUSTOMER",
    WAITING_ON_TEAM = "WAITING_ON_TEAM",
    RESOLVED = "RESOLVED",
    CLOSED = "CLOSED"
}
export declare enum TicketPriority {
    CRITICAL = "CRITICAL",
    HIGH = "HIGH",
    MEDIUM = "MEDIUM",
    LOW = "LOW"
}
export declare enum TicketType {
    BUG = "BUG",
    FEATURE_REQUEST = "FEATURE_REQUEST",
    QUESTION = "QUESTION",
    INTEGRATION_HELP = "INTEGRATION_HELP",
    ACCOUNT_ISSUE = "ACCOUNT_ISSUE",
    OTHER = "OTHER"
}
export declare enum TicketSource {
    DISCORD = "DISCORD",
    SLACK = "SLACK",
    TEAMS = "TEAMS",
    ORCA = "ORCA",
    GITHUB_ISSUE = "GITHUB_ISSUE",
    GITHUB_DISCUSSION = "GITHUB_DISCUSSION",
    WEB = "WEB",
    EMAIL = "EMAIL",
    MANUAL = "MANUAL"
}
export declare enum MessageType {
    USER = "USER",
    BOT = "BOT",
    SYSTEM = "SYSTEM"
}
export declare enum JobStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
    DEAD_LETTER = "DEAD_LETTER"
}
export declare enum AgentStatus {
    ACTIVE = "ACTIVE",
    PAUSED = "PAUSED",
    ERROR = "ERROR"
}
export declare enum BroadcastStatus {
    DRAFT = "DRAFT",
    SENT = "SENT"
}
export declare enum BroadcastAudience {
    ALL_ACCOUNTS = "ALL_ACCOUNTS",
    SELECTED_ACCOUNTS = "SELECTED_ACCOUNTS",
    BY_SENTIMENT = "BY_SENTIMENT"
}
export declare enum DocStatus {
    DRAFT = "DRAFT",
    PUBLISHED = "PUBLISHED"
}
export declare enum SlaMetric {
    FIRST_RESPONSE = "FIRST_RESPONSE",
    RESOLUTION = "RESOLUTION"
}
export declare enum AccountSentiment {
    HAPPY = "HAPPY",
    NEUTRAL = "NEUTRAL",
    AT_RISK = "AT_RISK",
    CHURNING = "CHURNING"
}
export declare enum AccountEngagement {
    HIGH = "HIGH",
    MEDIUM = "MEDIUM",
    LOW = "LOW",
    INACTIVE = "INACTIVE"
}
export declare enum TeamMemberRole {
    ADMIN = "ADMIN",
    SUPPORT = "SUPPORT",
    ENGINEER = "ENGINEER",
    VIEWER = "VIEWER"
}
/** Unified platform target for message formatting and job routing */
export type PlatformTarget = 'discord' | 'github' | 'slack' | 'teams' | 'web';
//# sourceMappingURL=types.d.ts.map