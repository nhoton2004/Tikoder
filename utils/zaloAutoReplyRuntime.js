'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PHASES = new Set(['connecting', 'waiting_zalo', 'monitoring', 'paused', 'disconnected', 'dispatching', 'needs_check']);
const ADAPTER_STATES = new Set(['unknown', 'connecting', 'monitoring', 'paused', 'disconnected', 'unsupported', 'capacity', 'error', 'closed', 'waiting_zalo', 'login_required']);
const REASONS = new Set(['none', 'connecting', 'waiting_zalo', 'watcher_stopped', 'start_failed', 'browser_closed', 'paused', 'stopped', 'ingest_rejected', 'ingest_failed', 'dispatching', 'dispatch_failed', 'dispatch_config', 'dispatch_accepted', 'send_uncertain', 'send_failed', 'send_confirmed', 'runtime_write_failed']);
const RESET_KEYS = ['initial-baseline', 'structure-or-identity-change', 'candidate-proof-change', 'root-detached', 'return-to-bottom', 'tail-follow-timeout', 'viewport-change', 'scroll-away', 'unrecognized-layout-change', 'local-day-change', 'user-scroll', 'history-reorder', 'baseline-mutation', 'message-replacement', 'message-identity-change', 'outside-history-mutation', 'unrecognized-history-mutation', 'candidate-capacity', 'not-at-bottom'];
const count = value => typeof value === 'number' && Number.isFinite(value) ? Math.min(1000000000, Math.max(0, Math.floor(value))) : 0;
function timestamp(value) {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))) return null;
    const time = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(time) && time >= 0 && time <= 253402300799999 ? new Date(time).toISOString() : null;
}
function numericFields(input, keys) {
    const output = {};
    for (const key of keys) if (input && Object.hasOwn(input, key)) output[key] = count(input[key]);
    return output;
}
function sanitizeTrace(input) {
    const regions = ['detached', 'editor', 'timestamp', 'payload', 'reaction', 'menu', 'frame', 'message', 'row', 'history', 'root', 'outside-history', 'outside-root'];
    const attributes = ['none', 'id', 'data-qid', 'class', 'style', 'contenteditable', 'data-trailer', 'aria', 'other'];
    return input.slice(-24).filter(event => event && typeof event === 'object' &&
        timestamp(event.at) && ((event.event === 'append' && event.reason === 'none') ||
            (event.event === 'reset' && RESET_KEYS.includes(event.reason)))).map(event => ({
        at: timestamp(event.at), event: event.event, reason: event.reason,
        epoch: count(event.epoch), candidatesBefore: count(event.candidatesBefore),
        rowsBefore: count(event.rowsBefore), rowsAfter: count(event.rowsAfter),
        atBottom: event.atBottom === true, mutationCount: count(event.mutationCount),
        mutations: (Array.isArray(event.mutations) ? event.mutations : []).slice(0, 8)
            .filter(item => item && typeof item === 'object').map(item => ({
                kind: ['attributes', 'childList', 'characterData'].includes(item.kind) ? item.kind : 'other',
                region: regions.includes(item.region) ? item.region : 'outside-root',
                attribute: attributes.includes(item.attribute) ? item.attribute : 'other',
                added: count(item.added), removed: count(item.removed),
            })),
    }));
}
// Reconstruct every level, including nested reader data. Never spread adapter data to disk.
function sanitize(input = {}) {
    const reader = input.reader && typeof input.reader === 'object' ? input.reader : {};
    const safeReader = numericFields(reader, ['readableMessages', 'inboundMessages', 'eligibleMessages', 'pollCount', 'deliveredCount', 'acceptedCount', 'rejectedCount', 'trackerEpoch', 'candidateCount']);
    if (Object.hasOwn(reader, 'lastPollAt')) safeReader.lastPollAt = timestamp(reader.lastPollAt);
    if (Object.hasOwn(reader, 'observationStartedAt')) safeReader.observationStartedAt = timestamp(reader.observationStartedAt);
        if (typeof reader.atBottom === 'boolean') safeReader.atBottom = reader.atBottom;
        if (RESET_KEYS.includes(reader.resetReason)) safeReader.resetReason = reader.resetReason;
        if (reader.skipped) safeReader.skipped = numericFields(reader.skipped, ['structure', 'identity', 'direction', 'plaintext', 'time', 'baseline', 'untracked', 'duplicate', 'future']);
    if (reader.resetCounts) safeReader.resetCounts = numericFields(reader.resetCounts, RESET_KEYS);
    if (Array.isArray(reader.trace)) safeReader.trace = sanitizeTrace(reader.trace);
    if (reader.implementation === 'observed-dom-mutation-trace-1') safeReader.implementation = reader.implementation;
    return {
        updatedAt: timestamp(input.updatedAt),
        phase: PHASES.has(input.phase) ? input.phase : 'disconnected',
        attempts: count(input.attempts), lastAttemptAt: timestamp(input.lastAttemptAt), nextRetryAt: timestamp(input.nextRetryAt),
        adapterState: ADAPTER_STATES.has(input.adapterState) ? input.adapterState : 'unknown',
        reader: safeReader, lastPollAt: timestamp(input.lastPollAt), lastIncomingAt: timestamp(input.lastIncomingAt),
        ingested: count(input.ingested), dispatchAttempt: count(input.dispatchAttempt),
        lastDispatchStatus: Number.isInteger(input.lastDispatchStatus) && input.lastDispatchStatus >= 100 && input.lastDispatchStatus <= 599 ? input.lastDispatchStatus : 0,
        reasonCode: REASONS.has(input.reasonCode) ? input.reasonCode : 'none',
    };
}
function createRuntime({ root, now = Date.now }) {
    const filename = uid => path.join(root, crypto.createHash('sha256').update(uid).digest('hex') + '.json');
    function read(uid) {
        try { return sanitize(JSON.parse(fs.readFileSync(filename(uid), 'utf8'))); }
        catch (_) { return sanitize(); }
    }
    function write(uid, snapshot) {
        const safe = sanitize({ ...snapshot, updatedAt: now() });
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        const target = filename(uid), temporary = target + '.' + crypto.randomUUID() + '.tmp';
        try {
            fs.writeFileSync(temporary, JSON.stringify(safe), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            fs.renameSync(temporary, target);
        } finally {
            if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        }
        return safe;
    }
    return { read, write };
}
module.exports = { createRuntime, sanitize };
