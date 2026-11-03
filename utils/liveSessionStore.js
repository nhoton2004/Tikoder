'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const gzip = promisify(require('node:zlib').gzip);
const persistence = require('./livePersistence');
const projection = require('./liveSessionProjection');
const { rawRow, calculateSessionSummary, flattenConfirmedOrders, rebuildSessionOrders, generateSessionId } = projection;
const DATA_DIR = path.join(__dirname, '..', 'data', 'live-sessions');
const HISTORY_DIR = path.join(__dirname, '..', 'data', 'live-history');
const ARCHIVE_DIR = path.join(__dirname, '..', 'archive', 'live-history');
const indexJobs = new Map();
const indexBuilds = new Map();
let disposed = false;
const clone = value => JSON.parse(JSON.stringify(value));
function safeId(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('User ID không hợp lệ');
    return value;
}
function filePath(userId) { return path.join(DATA_DIR, `${safeId(userId)}.json`); }
function validateRecord(parsed) {
    if (!parsed || !Array.isArray(parsed.sessions) || (parsed.revision !== undefined && (!Number.isSafeInteger(parsed.revision) || parsed.revision < 0))) throw new Error('Dữ liệu phiên live không hợp lệ');
    if (parsed.receipts !== undefined && (!parsed.receipts || Array.isArray(parsed.receipts) || typeof parsed.receipts !== 'object')) throw new Error('Dữ liệu request receipts không hợp lệ');
    if (parsed.sessions.some(s => !s || typeof s.id !== 'string' || (s.orders !== undefined && !Array.isArray(s.orders)) || (s.segments !== undefined && !Array.isArray(s.segments)))) throw new Error('Schema phiên live không hợp lệ');
    return { schemaVersion: 2, revision: 0, receipts: {}, ...parsed };
}
function readError(error, target) {
    if (error.code === 'ENOENT') return { schemaVersion: 2, revision: 0, sessions: [], receipts: {} };
    error.message = `Không thể đọc nguồn ${target}: ${error.message}. Kiểm tra backup .bak; không ghi đè nguồn lỗi.`;
    throw error;
}
function readRecord(userId) {
    const target = filePath(userId);
    try { return validateRecord(JSON.parse(fs.readFileSync(target, 'utf8'))); }
    catch (error) { return readError(error, target); }
}
async function readRecordAsync(userId) {
    const target = filePath(userId);
    try { return validateRecord(JSON.parse(await fs.promises.readFile(target, 'utf8'))); }
    catch (error) { return readError(error, target); }
}
function readUserSessions(userId) { return readRecord(userId).sessions; }
function serialize(userId, operation) { return persistence.serialize(DATA_DIR, safeId(userId), operation); }
function checkReceipt(record, meta) {
    const found = meta?.requestId && Object.hasOwn(record.receipts || {}, meta.requestId) && record.receipts[meta.requestId];
    if (!found) return false;
    if (found.fingerprint !== meta.fingerprint) throw Object.assign(new Error('requestId đã được dùng cho thao tác khác'), { status: 409 });
    return true;
}
function operationMeta(event, payload, sessionId) {
    if (payload?.requestId && (typeof payload.requestId !== 'string' || payload.requestId.length > 128)) throw new Error('requestId không hợp lệ');
    return { requestId: payload?.requestId || '', sessionId, fingerprint: crypto.createHash('sha256').update(JSON.stringify({ event, sessionId, payload })).digest('hex') };
}
async function isDuplicate(userId, meta) { return checkReceipt(await readRecordAsync(userId), meta); }
function recordReceipt(userId, meta) { return mutate(userId, () => ({ duplicate: true }), meta); }
async function commitRecord(userId, previous, next, meta) {
    const target = filePath(userId);
    next.revision = previous.revision + 1;
    next.schemaVersion = 2;
    next.commitId = crypto.randomUUID();
    next.receipts ||= {};
    if (meta?.requestId) Object.defineProperty(next.receipts, meta.requestId, { enumerable: true, configurable: true, writable: true, value: { fingerprint: meta.fingerprint, sessionId: meta.sessionId, revision: next.revision } });
    // Backup failure occurs BEFORE source commit. Source rename is the commit point.
    if (previous.revision || previous.sessions.length) await persistence.atomicWrite(target + '.bak', previous);
    await persistence.atomicWrite(target, next);
    requestIndexUpdate(userId);
}
function writeUserSessions(userId, sessions, options = {}) {
    if (!persistence.isSerialized(DATA_DIR, userId) && options.expectedRevision === undefined) return Promise.reject(new Error('Snapshot write yêu cầu expectedRevision hoặc hàng đợi đọc–sửa–ghi'));
    return serialize(userId, async () => {
        const previous = await readRecordAsync(userId);
        if (options.expectedRevision !== undefined && previous.revision !== options.expectedRevision) throw new Error('Nguồn đã thay đổi; đọc lại trước khi ghi');
        if (checkReceipt(previous, options.meta)) return { duplicate: true };
        await commitRecord(userId, previous, { ...clone(previous), sessions: clone(sessions) }, options.meta);
        return { revision: previous.revision + 1 };
    });
}
function mutate(userId, operation, meta) {
    return serialize(userId, async () => {
        const previous = await readRecordAsync(userId);
        if (checkReceipt(previous, meta)) return { duplicate: true };
        const next = clone(previous);
        const result = operation(next.sessions);
        await commitRecord(userId, previous, next, meta);
        return result;
    });
}
function createLiveSession(userId, data = {}) {
    return mutate(userId, sessions => {
        const now = new Date().toISOString();
        const id = data.id || generateSessionId();
        if (sessions.some(s => s.id === id)) throw new Error('ID phiên live đã tồn tại');
        const orders = Array.isArray(data.orders) ? data.orders : flattenConfirmedOrders(data.orders || {});
        const session = { id, userId, type: data.type || 'live_session', liveName: data.liveName || 'Phiên live', tiktokUsername: data.tiktokUsername || '', startedAt: data.startedAt || now, endedAt: data.endedAt === null ? null : (data.endedAt || now), createdAt: now, lastActivityAt: data.lastActivityAt || now, orders, summary: data.summary || calculateSessionSummary(orders) };
        if (Array.isArray(data.segments)) session.segments = data.segments;
        if (Array.isArray(data.sourceSessionIds)) session.sourceSessionIds = data.sourceSessionIds;
        sessions.unshift(session);
        return session;
    });
}
function getLiveSessionById(userId, sessionId) { return readUserSessions(userId).find(s => s.id === sessionId) || null; }
function deleteLiveSession(userId, sessionId) {
    return mutate(userId, sessions => {
        const i = sessions.findIndex(s => s.id === sessionId);
        if (i < 0) return false;
        if (!sessions[i].endedAt) throw new Error('Hãy kết thúc phiên trước khi xóa');
        sessions.splice(i, 1);
        return true;
    });
}
function openSegment(session) {
    if (!session.segments?.length) return { startedAt: session.startedAt, endedAt: null, orders: session.orders || [] };
    const open = session.segments.filter(s => !s.endedAt && !s.closedBySessionAt);
    if (open.length !== 1) throw new Error('Không xác định được segment đang mở; hãy đóng phiên cũ để tạo mới');
    return open[0];
}
function updateLiveSession(userId, sessionId, data = {}) {
    return mutate(userId, sessions => {
        const session = sessions.find(s => s.id === sessionId);
        if (!session || session.endedAt || session.type !== 'live_session') throw new Error('Không có phiên live đang hoạt động');
        const segment = openSegment(session);
        if (data.segmentStartedAt && segment.startedAt !== data.segmentStartedAt) throw new Error('Lượt live đã thay đổi');
        if (!session.segments?.length) session.segments = [segment];
        if (data.orders !== undefined) {
            segment.orders = Array.isArray(data.orders) ? data.orders : flattenConfirmedOrders(data.orders);
            segment.summary = calculateSessionSummary(segment.orders);
            session.orders = rebuildSessionOrders(session);
            session.summary = calculateSessionSummary(session.orders);
        }
        session.lastActivityAt = new Date().toISOString();
        segment.lastActivityAt = session.lastActivityAt;
        if (data.endedAt) {
            session.endedAt = data.endedAt;
            segment.endedAt = data.endedAt;
            if (data.closeReason) session.closeReason = data.closeReason;
        }
        return session;
    }, data.meta);
}
function startLiveSession(userId, { broadcasterId, resumeSessionId, liveName, startedAt, closeSessionIds = [] }) {
    return mutate(userId, sessions => {
        const now = startedAt || new Date().toISOString();
        for (const id of closeSessionIds) {
            const old = sessions.find(s => s.id === id && !s.endedAt && s.type === 'live_session');
            if (!old) throw new Error('Phiên cần đóng không còn mở');
            old.endedAt = now;
            old.closeReason = 'recovery-user-closed';
            old.lastActivityAt = now;
            (old.segments || []).filter(s => !s.endedAt).forEach(s => { s.endedAt = now; s.closeReason = old.closeReason; });
        }
        if (resumeSessionId) {
            const session = sessions.find(s => s.id === resumeSessionId);
            if (!session || session.tiktokUsername !== broadcasterId || session.type !== 'live_session') throw new Error('Lịch sử không thuộc tài khoản hoặc chủ live này');
            if (!session.endedAt) {
                const segment = openSegment(session);
                session.lastActivityAt = now;
                segment.lastActivityAt = now;
                return { ...session, currentSegmentOrders: segment.orders, currentSegmentStartedAt: segment.startedAt };
            }
            session.segments ||= [{ startedAt: session.startedAt, endedAt: session.endedAt, orders: session.orders || [] }];
            const seen = new Set();
            session.segments.forEach(segment => {
                // Legacy closed histories may lack per-segment end timestamps.
                // Record that the containing session was closed; do not invent
                // the actual end time of an individual segment.
                if (!segment.endedAt) segment.closedBySessionAt = session.endedAt;
                segment.orders = (segment.orders || []).filter(order => { const id = String(order?.id ?? ''); if (!id || seen.has(id)) return false; seen.add(id); return true; });
                segment.summary = calculateSessionSummary(segment.orders);
            });
            session.segments.push({ id: crypto.randomUUID(), startedAt: now, endedAt: null, orders: [] });
            session.orders = rebuildSessionOrders(session);
            session.summary = calculateSessionSummary(session.orders);
            session.endedAt = null;
            session.lastStartedAt = now;
            session.lastActivityAt = now;
            return { ...session, currentSegmentOrders: [], currentSegmentStartedAt: now };
        }
        if (sessions.some(s => !s.endedAt && s.type === 'live_session')) throw new Error('Còn phiên mở; hãy chọn tiếp tục hoặc đóng trước khi tạo phiên mới');
        const session = { id: generateSessionId(), userId, type: 'live_session', liveName, tiktokUsername: broadcasterId, startedAt: now, endedAt: null, createdAt: now, lastActivityAt: now, orders: [], summary: calculateSessionSummary([]), segments: [{ id: crypto.randomUUID(), startedAt: now, endedAt: null, orders: [] }] };
        sessions.unshift(session);
        return { ...session, currentSegmentOrders: [], currentSegmentStartedAt: now };
    });
}
function recoveryCandidates(userId, now = Date.now()) {
    const configured = Number(process.env.LIVE_RECOVERY_STALE_HOURS || 12);
    const hours = Number.isFinite(configured) && configured > 0 ? configured : 12;
    return readUserSessions(userId).filter(s => s.type === 'live_session' && !s.endedAt).map(session => {
        let segment, ambiguous = false;
        try { segment = openSegment(session); } catch (_) { ambiguous = true; }
        const fallback = [session.startedAt, ...(session.segments || []).flatMap(s => [s.startedAt, s.endedAt, s.lastActivityAt]), ...(session.orders || []).map(o => o.createdAt)].map(Date.parse).filter(t => Number.isFinite(t) && t <= now);
        const activity = Date.parse(session.lastActivityAt);
        const last = Number.isFinite(activity) && activity <= now ? activity : Math.max(...fallback);
        return { session, segment, ambiguous, stale: !Number.isFinite(last) || now - last >= hours * 3600000, lastActivityAt: Number.isFinite(last) ? new Date(last).toISOString() : null };
    });
}
function sourceRows(record, userId) { return record.sessions.flatMap(session => (session.orders || []).map(order => rawRow(userId, session, order))); }
function checksum(rows) { return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'); }
function sourceVersion(record) { return record.commitId || checksum(record.sessions); }
function indexPath(userId) { return path.join(HISTORY_DIR, safeId(userId), 'projection.json'); }
function buildIndex(userId) {
    const previous = indexBuilds.get(userId) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => buildIndexSnapshot(userId));
    indexBuilds.set(userId, task);
    const cleanup = () => { if (indexBuilds.get(userId) === task) indexBuilds.delete(userId); };
    task.then(cleanup, cleanup);
    return task;
}
async function buildIndexSnapshot(userId) {
    await persistence.acquireWriter(DATA_DIR);
    const record = await readRecordAsync(userId);
    const rows = sourceRows(record, userId);
    // One atomic snapshot publishes a complete generation across all dates.
    await persistence.atomicWrite(indexPath(userId), { schemaVersion: 2, revision: record.revision, sourceVersion: sourceVersion(record), checksum: checksum(rows), rows });
    return record.revision;
}
function requestIndexUpdate(userId, immediate = false) {
    if (disposed) return;
    let job = indexJobs.get(userId);
    if (!job) { job = { requested: true, running: false, timer: null, failures: 0 }; indexJobs.set(userId, job); }
    job.requested = true;
    if (job.running) return;
    if (job.timer) { if (!immediate) return; clearTimeout(job.timer); }
    job.timer = setTimeout(async () => {
        job.timer = null;
        job.running = true;
        job.requested = false;
        job.task = (async () => { try {
            const revision = await buildIndex(userId);
            await archiveOldIndexes(userId);
            job.failures = 0;
            if ((await readRecordAsync(userId)).revision !== revision) job.requested = true;
        } catch (error) { console.error(`[live-store] index ${userId}:`, error.message); job.requested = true; job.failures += 1; }
        finally { job.running = false; if (job.requested) requestIndexUpdate(userId); else indexJobs.delete(userId); }
        })();
        await job.task;
    }, immediate ? 0 : Math.min(30000, 250 * (2 ** Math.min(job.failures, 7))));
    job.timer.unref?.();
}
function readIndexedRows(userId, { start = '', end = '', offset = 0, limit = 0 } = {}) {
    const record = readRecord(userId);
    let rows;
    try {
        const index = JSON.parse(fs.readFileSync(indexPath(userId), 'utf8'));
        if (index.schemaVersion !== 2 || index.revision !== record.revision || index.sourceVersion !== sourceVersion(record) || !Array.isArray(index.rows) || checksum(index.rows) !== index.checksum) throw new Error('Index stale/incomplete');
        rows = index.rows;
    } catch (_) { rows = sourceRows(record, userId); requestIndexUpdate(userId); }
    const sorted = rows.filter(row => (!start || row.captureDate >= start) && (!end || row.captureDate <= end)).sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    return limit > 0 ? sorted.slice(offset, offset + limit) : sorted.slice(offset);
}
function migrationAudit(userId) {
    const record = readRecord(userId);
    const source = sourceRows(record, userId);
    const index = JSON.parse(fs.readFileSync(indexPath(userId), 'utf8'));
    const stats = rows => ({ count: rows.length, revenueCents: rows.reduce((sum, row) => sum + Math.round(Number(row.total || 0) * 100), 0), distinctEventIds: new Set(rows.map(row => row.eventId).filter(Boolean)).size });
    return { match: index.revision === record.revision && index.sourceVersion === sourceVersion(record) && checksum(source) === index.checksum && checksum(index.rows) === index.checksum, source: stats(source), indexed: stats(index.rows) };
}
async function migrateUserIndexes(userId) { await buildIndex(userId); return migrationAudit(userId); }
// Maintain legacy per-day files off the commit path. v2 never reads these
// archives; its atomic projection includes every date from the canonical source.
async function archiveOldIndexes(userId) {
    await persistence.acquireWriter(DATA_DIR);
    const directory = path.join(HISTORY_DIR, safeId(userId));
    let names;
    try { names = await fs.promises.readdir(directory); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const cutoff = Date.now() - 90 * 86400000;
    for (const name of names.filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))) {
        const source = path.join(directory, name);
        if ((await fs.promises.stat(source)).mtimeMs >= cutoff) continue;
        const compressed = await gzip(await fs.promises.readFile(source));
        await persistence.atomicWrite(path.join(ARCHIVE_DIR, userId, name + '.gz'), compressed);
        await fs.promises.unlink(source);
    }
}
async function recoverBackup(userId) {
    return serialize(userId, async () => {
        const target = filePath(userId);
        const backup = validateRecord(JSON.parse(await fs.promises.readFile(target + '.bak', 'utf8')));
        const damaged = await fs.promises.readFile(target, 'utf8');
        await persistence.atomicWrite(`${target}.corrupt-${Date.now()}`, damaged);
        await persistence.atomicWrite(target, backup);
        requestIndexUpdate(userId, true);
        return { revision: backup.revision, warning: 'Đã phục hồi backup; có thể thiếu commit mới hơn. Cần đối chiếu dữ liệu.' };
    });
}
async function initialize() {
    await persistence.acquireWriter(DATA_DIR);
    const names = await fs.promises.readdir(DATA_DIR);
    for (const name of names.filter(n => /^[a-zA-Z0-9_-]+\.json$/.test(n))) requestIndexUpdate(name.slice(0, -5), true);
}
async function drain() {
    await persistence.drain();
    await dispose();
}
async function dispose() {
    disposed = true;
    for (const job of indexJobs.values()) { if (job.timer) clearTimeout(job.timer); job.requested = false; }
    await Promise.allSettled([...indexJobs.values()].map(job => job.task).filter(Boolean));
    await Promise.allSettled([...indexBuilds.values()]);
}
module.exports = { ...projection, readUserSessions, readRecord, writeUserSessions, createLiveSession, getLiveSessionById, deleteLiveSession, updateLiveSession, startLiveSession, readIndexedRows, migrationAudit, migrateUserIndexes, DATA_DIR, HISTORY_DIR, ARCHIVE_DIR, archiveOldIndexes, serialize, operationMeta, isDuplicate, recordReceipt, recoveryCandidates, requestIndexUpdate, recoverBackup, initialize, drain, dispose };
