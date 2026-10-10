const RESUMABLE_SESSION_STATUSES = new Set(['draft', 'live', 'reconnecting', 'interrupted']);
const CLOSED_SESSION_STATUSES = new Set(['ended', 'discarded']);

function isResumableSession(status) {
    return RESUMABLE_SESSION_STATUSES.has(status);
}

function shouldClearActiveSession(status) {
    return CLOSED_SESSION_STATUSES.has(status);
}

module.exports = { isResumableSession, shouldClearActiveSession };
