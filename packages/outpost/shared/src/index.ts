export * from './types.js';
export * from './constants.js';
export * from './utils.js';
export * from './text.js';
export * from './dispatch/index.js';
export * from './sla/index.js';
export * from './onboarding/index.js';
export * from './messaging/index.js';
export * from './integrations/index.js';
export * from './monitoring/index.js';
export * from './sync/index.js';
export * from './auth/index.js';
// Platform types only — safe for browser bundling (no runtime adapter code).
// Bot apps that need the actual adapter classes should import from
// '@copilotkit/outpost/shared/platforms' instead.
export type {
    PlatformAdapter,
    InboundMessage,
    PlatformUser,
    Attachment,
    FormattedResponse,
    TicketRef,
    InboundResult,
} from './platforms/index.js';
// PlatformTarget is already exported from ./types.js above.
export type {
    InboundHandlerConfig,
    CreateJobFn,
    InboundPrismaLike,
} from './platforms/index.js';
export type {
    PlatformDiscordAdapterConfig,
} from './platforms/index.js';
export type {
    PlatformGitHubAdapterConfig,
    GitHubOctokitLike,
} from './platforms/index.js';
export type {
    PlatformSlackAdapterConfig,
    SlackAdapterConfig,
    SlackMessageEvent,
} from './platforms/index.js';
export type {
    PlatformTeamsAdapterConfig,
    TeamsAdapterConfig,
    TeamsActivity,
    TeamsConversationReference,
} from './platforms/index.js';
export type {
    PlatformEmailPostmarkAdapterConfig,
} from './platforms/index.js';
