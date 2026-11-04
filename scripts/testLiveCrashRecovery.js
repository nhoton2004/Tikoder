'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { atomicWrite } = require('../utils/livePersistence');
const { loadStore } = require('./helpers/liveRecoveryFixture');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-recovery-'));
    const store = loadStore(directory);
    t.after(async () => { await store.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
    return { directory, store };
}
const order = (id, price = 100) => ({ id, customerUsername: 'buyer', productName: id, price, total: price, createdAt: '2026-11-04T00:00:00Z' });
function recoveryRequest(store, ids, requestId = 'recovery-request') {
    const versions = Object.fromEntries(store.readUserSessions('a').filter(s => !s.endedAt).map(s => [s.id, require('node:crypto').createHash('sha256').update(JSON.stringify(s)).digest('hex')]));
    const payload = { closeSessionIds: ids, uniqueId: 'new-shop', requestId };
    return { broadcasterId: 'new-shop', closeSessionIds: ids, recovery: { confirmed: true, versions }, meta: store.operationMeta('recovery-start', payload, '') };
}

test('selected recovery closes A and creates one C while preserving B, including retry and reload', async t => {
    const { store, directory } = fixture(t);
    for (const id of ['A', 'B']) await store.createLiveSession('a', { id, endedAt: null, type: 'live_session', tiktokUsername: 'shop', orders: [order(id)] });
    const beforeB = JSON.stringify(store.getLiveSessionById('a', 'B'));
    const request = recoveryRequest(store, ['A']);
    const created = await store.startLiveSession('a', request);
    assert.ok(store.getLiveSessionById('a', 'A').endedAt);
    assert.equal(store.getLiveSessionById('a', 'A').closeReason, 'recovery-user-closed');
    assert.equal(JSON.stringify(store.getLiveSessionById('a', 'B')), beforeB);
    assert.notEqual(created.id, 'A'); assert.notEqual(created.id, 'B');
    assert.equal((await store.startLiveSession('a', request)).duplicate, true);
    const reloaded = loadStore(directory); t.after(() => reloaded.dispose());
    assert.equal(reloaded.readUserSessions('a').length, 3);
    assert.equal(JSON.stringify(reloaded.getLiveSessionById('a', 'B')), beforeB);
    assert.equal((await reloaded.startLiveSession('a', request)).duplicate, true);
    await assert.rejects(store.startLiveSession('a', { broadcasterId: 'ordinary' }), /Còn phiên mở/);
});

test('recovery close-all is limited to the offered IDs; stale/foreign/invalid requests commit nothing', async t => {
    const { store } = fixture(t);
    for (const id of ['A', 'B']) await store.createLiveSession('a', { id, endedAt: null, tiktokUsername: 'shop', orders: [] });
    const all = recoveryRequest(store, ['A', 'B']);
    await store.createLiveSession('a', { id: 'appeared-later', endedAt: null, tiktokUsername: 'later', orders: [] });
    await store.startLiveSession('a', all);
    assert.equal(store.getLiveSessionById('a', 'appeared-later').endedAt, null);
    const unchanged = JSON.stringify(store.readRecord('a'));
    for (const ids of [['A'], ['appeared-later', 'foreign'], ['appeared-later', 'appeared-later'], []]) {
        await assert.rejects(store.startLiveSession('a', recoveryRequest(store, ids, 'invalid-' + JSON.stringify(ids))));
        assert.equal(JSON.stringify(store.readRecord('a')), unchanged);
    }
    await assert.rejects(store.startLiveSession('a', { broadcasterId: 'shop', closeSessionIds: ['appeared-later'] }));
    const stale = recoveryRequest(store, ['appeared-later'], 'stale');
    await store.updateLiveSession('a', 'appeared-later', { orders: [order('changed')] });
    const changed = JSON.stringify(store.readRecord('a'));
    await assert.rejects(store.startLiveSession('a', stale));
    assert.equal(JSON.stringify(store.readRecord('a')), changed);
});

test('atomic rename retries transient Windows locks after closing synced handle', async t => {
    const { directory } = fixture(t);
    const target = path.join(directory, 'atomic.json');
    fs.writeFileSync(target, 'old');
    let attempts = 0, synced = false, closed = false;
    const io = { ...fs.promises,
        async open(...args) {
            const handle = await fs.promises.open(...args);
            return { writeFile: (...a) => handle.writeFile(...a), sync: async () => { await handle.sync(); synced = true; }, close: async () => { await handle.close(); closed = true; } };
        },
        async rename(...args) {
            assert.ok(synced && closed);
            attempts += 1;
            if (attempts < 3) throw Object.assign(new Error('file locked'), { code: attempts === 1 ? 'EPERM' : 'EBUSY' });
            return fs.promises.rename(...args);
        }
    };
    await atomicWrite(target, { committed: true }, io);
    assert.equal(attempts, 3);
    assert.equal(JSON.parse(fs.readFileSync(target)).committed, true);
});

test('persistent rename errors stop after five attempts and preserve destination; fsync errors fail closed', async t => {
    const { directory } = fixture(t);
    const target = path.join(directory, 'atomic.json');
    fs.writeFileSync(target, 'old');
    let attempts = 0;
    await assert.rejects(atomicWrite(target, {}, { ...fs.promises, async rename() { attempts += 1; throw Object.assign(new Error('permission denied'), { code: 'EPERM' }); } }), /rename attempt 5/);
    assert.equal(attempts, 5);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    await assert.rejects(atomicWrite(target, {}, { ...fs.promises, async open(...args) {
        const handle = await fs.promises.open(...args);
        return { writeFile: (...a) => handle.writeFile(...a), sync: async () => { throw new Error('sync failure'); }, close: () => handle.close() };
    } }), /sync failure/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
    assert.deepEqual(fs.readdirSync(directory), ['atomic.json']);
});

test('whole read-modify-write serializes; durable receipts survive delete and reject changed payload', async t => {
    const { store } = fixture(t);
    const session = await store.startLiveSession('a', { broadcasterId: 'shop' });
    await Promise.all(['one', 'two'].map(id => store.serialize('a', async () => {
        const current = store.getLiveSessionById('a', session.id);
        await new Promise(resolve => setTimeout(resolve, 5));
        await store.updateLiveSession('a', session.id, { orders: [...current.orders, order(id)] });
    })));
    assert.equal(store.getLiveSessionById('a', session.id).orders.length, 2);
    const meta = store.operationMeta('confirm-item', { requestId: 'receipt', price: 7 }, session.id);
    await store.updateLiveSession('a', session.id, { orders: [order('receipt', 7)], meta });
    await store.updateLiveSession('a', session.id, { orders: [] });
    assert.equal((await store.updateLiveSession('a', session.id, { orders: [order('resurrect')], meta })).duplicate, true);
    assert.equal(store.getLiveSessionById('a', session.id).orders.length, 0);
    await assert.rejects(store.updateLiveSession('a', session.id, { orders: [], meta: store.operationMeta('confirm-item', { requestId: 'receipt', price: 9 }, session.id) }), /requestId/);
    await assert.rejects(store.writeUserSessions('a', []), /expectedRevision/);
});

test('deferred connector/timer callbacks cannot reuse an expired queue scope', async t => {
    const { store } = fixture(t);
    const events = [];
    let finish;
    const deferred = new Promise(resolve => { finish = resolve; });
    await store.serialize('a', async () => {
        setTimeout(() => store.serialize('a', async () => { events.push('deferred'); finish(); }), 20);
    });
    await Promise.all([deferred, store.serialize('a', async () => {
        events.push('start');
        await new Promise(resolve => setTimeout(resolve, 60));
        events.push('end');
    })]);
    assert.deepEqual(events, ['start', 'end', 'deferred']);
});

test('stale, partial, corrupt and empty indexes read canonical source without duplicate/archive resurrection', async t => {
    const { store } = fixture(t);
    const session = await store.startLiveSession('a', { broadcasterId: 'shop' });
    await store.updateLiveSession('a', session.id, { orders: [order('one')] });
    await store.migrateUserIndexes('a');
    assert.equal(store.migrationAudit('a').match, true);
    await store.updateLiveSession('a', session.id, { orders: [order('one', 200), order('two')] });
    assert.equal(store.readIndexedRows('a').length, 2);
    assert.equal(store.readIndexedRows('a').find(r => r.orderId === 'one').total, 200);
    const index = path.join(store.HISTORY_DIR, 'a', 'projection.json');
    fs.writeFileSync(index, '{partial');
    assert.equal(store.readIndexedRows('a').length, 2);
    await store.updateLiveSession('a', session.id, { orders: [] });
    const archive = path.join(store.ARCHIVE_DIR, 'a'); fs.mkdirSync(archive, { recursive: true });
    fs.writeFileSync(path.join(archive, '2026-11-04.json.gz'), 'obsolete');
    assert.equal(store.readIndexedRows('a', { includeArchive: true }).length, 0);
    await store.migrateUserIndexes('a');
    assert.equal(store.migrationAudit('a').match, true);
});

test('legacy index archive runs asynchronously with durable binary gzip output', async t => {
    const { store } = fixture(t);
    const directory = path.join(store.HISTORY_DIR, 'a'); fs.mkdirSync(directory, { recursive: true });
    const source = path.join(directory, '2020-01-01.json');
    fs.writeFileSync(source, '{"sessions":{}}'); fs.utimesSync(source, new Date('2020-01-01'), new Date('2020-01-01'));
    await store.archiveOldIndexes('a');
    const compressed = fs.readFileSync(path.join(store.ARCHIVE_DIR, 'a', '2020-01-01.json.gz'));
    assert.equal(require('node:zlib').gunzipSync(compressed).toString(), '{"sessions":{}}');
    assert.equal(fs.existsSync(source), false);
});

test('JSON corruption fails closed and explicit backup recovery preserves evidence and reports revision', async t => {
    const { store } = fixture(t);
    const session = await store.startLiveSession('a', { broadcasterId: 'shop' });
    await store.updateLiveSession('a', session.id, { orders: [order('one')] });
    const target = path.join(store.DATA_DIR, 'a.json');
    fs.writeFileSync(target, '{broken');
    await assert.rejects(store.updateLiveSession('a', session.id, { orders: [] }), /backup/);
    assert.equal(fs.readFileSync(target, 'utf8'), '{broken');
    const result = await store.recoverBackup('a');
    assert.equal(result.revision, 1);
    assert.match(result.warning, /commit/);
    assert.ok(fs.readdirSync(store.DATA_DIR).some(n => n.includes('.corrupt-')));
});

test('recovery selects the actual open segment, preserves identity, and closes at user decision time', async t => {
    const { store } = fixture(t);
    const now = new Date().toISOString();
    await store.createLiveSession('a', { id: 'multi', tiktokUsername: 'shop', endedAt: null, orders: [order('old'), order('open')], segments: [{ id: 'closed', startedAt: '2026-11-01T00:00:00Z', endedAt: '2026-11-01T01:00:00Z', orders: [order('old')] }, { id: 'open', startedAt: now, endedAt: null, orders: [order('open')] }, { id: 'later-closed', startedAt: now, endedAt: now, orders: [] }] });
    const resumed = await store.startLiveSession('a', { broadcasterId: 'shop', resumeSessionId: 'multi' });
    assert.equal(resumed.currentSegmentOrders[0].id, 'open');
    assert.equal(resumed.segments.length, 3);
    assert.equal(store.recoveryCandidates('a')[0].stale, false);
    assert.equal(store.recoveryCandidates('b').length, 0);
    await store.updateLiveSession('a', 'multi', { orders: [order('open'), order('new')], segmentStartedAt: now });
    await store.serialize('a', async () => { const record = store.readRecord('a'); record.sessions[0].lastActivityAt = '2020-01-01T00:00:00Z'; await store.writeUserSessions('a', record.sessions); });
    assert.equal(store.recoveryCandidates('a')[0].stale, true);
    const fresh = await store.startLiveSession('a', recoveryRequest(store, ['multi']));
    const closed = store.getLiveSessionById('a', 'multi');
    assert.equal(closed.closeReason, 'recovery-user-closed');
    assert.equal(closed.endedAt, fresh.startedAt);
    assert.notEqual(closed.endedAt, order('new').createdAt);
});

function child(directory, mode) {
    return fork(path.join(__dirname, 'helpers/liveRecoveryChild.js'), [directory, mode], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
}
test('real SIGKILL after commit: ACKed source and lost-ACK retry survive restart, index rebuilds', async t => {
    const { directory } = fixture(t);
    const writer = child(directory, 'commit');
    t.after(() => writer.kill('SIGKILL'));
    const [committed] = await once(writer, 'message');
    assert.equal(committed.committed, true, committed.error);
    const stopped = once(writer, 'exit'); writer.kill('SIGKILL'); await stopped;
    const reader = child(directory, 'inspect');
    t.after(() => reader.kill('SIGKILL'));
    const exited = once(reader, 'exit');
    const [result] = await once(reader, 'message');
    assert.equal(result.retry.duplicate, true, result.error);
    assert.equal(result.session.orders.length, 1);
    assert.equal(result.session.orders[0].id, 'one');
    assert.equal(result.audit.match, true);
    await exited;
});

test('a second process cannot obtain write ownership', async t => {
    const { directory } = fixture(t);
    const first = child(directory, 'lock');
    t.after(() => first.kill('SIGKILL'));
    assert.equal((await once(first, 'message'))[0].acquired, true);
    const second = child(directory, 'lock');
    t.after(() => second.kill('SIGKILL'));
    const secondExited = once(second, 'exit');
    assert.match((await once(second, 'message'))[0].error, /tiến trình ghi/);
    await secondExited;
    const firstExited = once(first, 'exit'); first.kill('SIGKILL'); await firstExited;
});

test('index job failure cannot reject a committed order, and a source change during rebuild is caught up', async t => {
    const { store } = fixture(t);
    const persistence = require('../utils/livePersistence');
    const original = persistence.atomicWrite;
    let release, started;
    const blocked = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let intercepted = false;
    persistence.atomicWrite = async (target, value, ...args) => {
        if (target.endsWith('projection.json') && !intercepted) {
            intercepted = true;
            started(); await gate;
            throw new Error('injected index failure');
        }
        return original(target, value, ...args);
    };
    t.after(() => { release(); persistence.atomicWrite = original; });
    const session = await store.startLiveSession('a', { broadcasterId: 'shop' });
    store.requestIndexUpdate('a', true);
    await blocked;
    await store.updateLiveSession('a', session.id, { orders: [order('committed-during-index')] });
    assert.equal(store.getLiveSessionById('a', session.id).orders.length, 1);
    release();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        try { if (store.migrationAudit('a').match) break; } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(store.migrationAudit('a').match, true);
    assert.equal(store.readIndexedRows('a')[0].orderId, 'committed-during-index');
});
