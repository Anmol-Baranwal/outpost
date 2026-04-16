/**
 * Types for the customer messaging system.
 * Covers Slack Connect and MS Teams channels.
 */
export var MessageSource;
(function (MessageSource) {
    MessageSource["SLACK"] = "SLACK";
    MessageSource["TEAMS"] = "TEAMS";
})(MessageSource || (MessageSource = {}));
export var UrgencyLevel;
(function (UrgencyLevel) {
    UrgencyLevel["LOW"] = "LOW";
    UrgencyLevel["MEDIUM"] = "MEDIUM";
    UrgencyLevel["HIGH"] = "HIGH";
})(UrgencyLevel || (UrgencyLevel = {}));
export var MessageStatus;
(function (MessageStatus) {
    MessageStatus["UNANSWERED"] = "UNANSWERED";
    MessageStatus["ANSWERED"] = "ANSWERED";
})(MessageStatus || (MessageStatus = {}));
