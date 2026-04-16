/**
 * Core types shared across all Outpost apps and packages.
 */
export var TicketStatus;
(function (TicketStatus) {
    TicketStatus["OPEN"] = "OPEN";
    TicketStatus["IN_PROGRESS"] = "IN_PROGRESS";
    TicketStatus["WAITING_ON_CUSTOMER"] = "WAITING_ON_CUSTOMER";
    TicketStatus["WAITING_ON_TEAM"] = "WAITING_ON_TEAM";
    TicketStatus["RESOLVED"] = "RESOLVED";
    TicketStatus["CLOSED"] = "CLOSED";
})(TicketStatus || (TicketStatus = {}));
export var TicketPriority;
(function (TicketPriority) {
    TicketPriority["CRITICAL"] = "CRITICAL";
    TicketPriority["HIGH"] = "HIGH";
    TicketPriority["MEDIUM"] = "MEDIUM";
    TicketPriority["LOW"] = "LOW";
})(TicketPriority || (TicketPriority = {}));
export var TicketType;
(function (TicketType) {
    TicketType["BUG"] = "BUG";
    TicketType["FEATURE_REQUEST"] = "FEATURE_REQUEST";
    TicketType["QUESTION"] = "QUESTION";
    TicketType["INTEGRATION_HELP"] = "INTEGRATION_HELP";
    TicketType["ACCOUNT_ISSUE"] = "ACCOUNT_ISSUE";
    TicketType["OTHER"] = "OTHER";
})(TicketType || (TicketType = {}));
export var TicketSource;
(function (TicketSource) {
    TicketSource["DISCORD"] = "DISCORD";
    TicketSource["SLACK"] = "SLACK";
    TicketSource["TEAMS"] = "TEAMS";
    TicketSource["ORCA"] = "ORCA";
    TicketSource["GITHUB_ISSUE"] = "GITHUB_ISSUE";
    TicketSource["GITHUB_DISCUSSION"] = "GITHUB_DISCUSSION";
    TicketSource["WEB"] = "WEB";
    TicketSource["EMAIL"] = "EMAIL";
    TicketSource["MANUAL"] = "MANUAL";
})(TicketSource || (TicketSource = {}));
export var MessageType;
(function (MessageType) {
    MessageType["USER"] = "USER";
    MessageType["BOT"] = "BOT";
    MessageType["SYSTEM"] = "SYSTEM";
})(MessageType || (MessageType = {}));
export var JobStatus;
(function (JobStatus) {
    JobStatus["PENDING"] = "PENDING";
    JobStatus["PROCESSING"] = "PROCESSING";
    JobStatus["COMPLETED"] = "COMPLETED";
    JobStatus["FAILED"] = "FAILED";
    JobStatus["DEAD_LETTER"] = "DEAD_LETTER";
})(JobStatus || (JobStatus = {}));
export var AgentStatus;
(function (AgentStatus) {
    AgentStatus["ACTIVE"] = "ACTIVE";
    AgentStatus["PAUSED"] = "PAUSED";
    AgentStatus["ERROR"] = "ERROR";
})(AgentStatus || (AgentStatus = {}));
export var BroadcastStatus;
(function (BroadcastStatus) {
    BroadcastStatus["DRAFT"] = "DRAFT";
    BroadcastStatus["SENT"] = "SENT";
})(BroadcastStatus || (BroadcastStatus = {}));
export var BroadcastAudience;
(function (BroadcastAudience) {
    BroadcastAudience["ALL_ACCOUNTS"] = "ALL_ACCOUNTS";
    BroadcastAudience["SELECTED_ACCOUNTS"] = "SELECTED_ACCOUNTS";
    BroadcastAudience["BY_SENTIMENT"] = "BY_SENTIMENT";
})(BroadcastAudience || (BroadcastAudience = {}));
export var DocStatus;
(function (DocStatus) {
    DocStatus["DRAFT"] = "DRAFT";
    DocStatus["PUBLISHED"] = "PUBLISHED";
})(DocStatus || (DocStatus = {}));
export var SlaMetric;
(function (SlaMetric) {
    SlaMetric["FIRST_RESPONSE"] = "FIRST_RESPONSE";
    SlaMetric["RESOLUTION"] = "RESOLUTION";
})(SlaMetric || (SlaMetric = {}));
export var AccountSentiment;
(function (AccountSentiment) {
    AccountSentiment["HAPPY"] = "HAPPY";
    AccountSentiment["NEUTRAL"] = "NEUTRAL";
    AccountSentiment["AT_RISK"] = "AT_RISK";
    AccountSentiment["CHURNING"] = "CHURNING";
})(AccountSentiment || (AccountSentiment = {}));
export var AccountEngagement;
(function (AccountEngagement) {
    AccountEngagement["HIGH"] = "HIGH";
    AccountEngagement["MEDIUM"] = "MEDIUM";
    AccountEngagement["LOW"] = "LOW";
    AccountEngagement["INACTIVE"] = "INACTIVE";
})(AccountEngagement || (AccountEngagement = {}));
export var TeamMemberRole;
(function (TeamMemberRole) {
    TeamMemberRole["ADMIN"] = "ADMIN";
    TeamMemberRole["SUPPORT"] = "SUPPORT";
    TeamMemberRole["ENGINEER"] = "ENGINEER";
    TeamMemberRole["VIEWER"] = "VIEWER";
})(TeamMemberRole || (TeamMemberRole = {}));
