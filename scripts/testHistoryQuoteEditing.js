'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const workspace = require('../utils/historyOrderWorkspace');
const root = path.resolve(__dirname, '..');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-edit-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const normalize = value => String(value || '').replace(/^@/, '').toLowerCase();
    const customers = { a: [{ id: 'buyer-a', tiktokUsername: 'buyer', displayName: 'Buyer', phone: '0900000000', consent: { quoteMessages: 'granted' } }], b: [{ id: 'buyer-b', tiktokUsername: 'buyer' }] };
    const customerStore = {
        normalizeTikTokUsername: normalize,
        getCustomerById: (uid, id) => customers[uid]?.find(c => c.id === id),
        listCustomers: uid => customers[uid] || [],
        findCustomerByTikTok: (uid, username) => customers[uid]?.find(c => c.tiktokUsername === username),
        createCustomer(uid, body) { const customer = { ...body, id: 'new-' + uid }; customers[uid].push(customer); return customer; }
    };
    function load(relative, from, to, dependency) {
        const filename = path.join(root, relative);
        const source = fs.readFileSync(filename, 'utf8').replace(from, to);
        const module = { exports: {} };
        vm.runInNewContext(source, { module, require: name => name === './customerStore' ? dependency : createRequire(filename)(name), __dirname: path.dirname(filename), console, process: { env: { ZALO_WEB_EXPERIMENTAL: 'true', ZALO_TEST_PHONES: '0900000000' } } });
        return module.exports;
    }
    const store = load('utils/liveSessionStore.js', "const DATA_DIR = path.join(__dirname, '..', 'data', 'live-sessions');", 'const DATA_DIR = ' + JSON.stringify(path.join(directory, 'sessions')) + ';');
    const queue = load('utils/quoteQueue.js', "const ROOT = path.join(__dirname, '..', 'data', 'quote-queue');", 'const ROOT = ' + JSON.stringify(path.join(directory, 'quotes')) + ';', customerStore);
    const app = express();
    app.use(express.json());
    // Session shim deliberately distinguishes unauthenticated and per-account requests.
    app.use((req, res, next) => { if (req.get('x-user')) req.session = { user: { uid: req.get('x-user'), role: req.get('x-role') || 'user' } }; next(); });
    const auth = (req, res, next) => req.session?.user ? next() : res.status(401).json({ error: 'Unauthorized' });
    const runtimeByUser = new Map();
    const getLiveRuntime = uid => {
        if (!runtimeByUser.has(uid)) runtimeByUser.set(uid, { currentSessionId: null, confirmedOrders: {} });
        return runtimeByUser.get(uid);
    };
    const historyRoot = path.join(directory, 'history');
    fs.mkdirSync(historyRoot);
    const getUserHistoryDir = uid => { const dir = path.join(historyRoot, uid); fs.mkdirSync(dir, { recursive: true }); return dir; };
    const context = { app, requireApiAuth: auth, fs, path, console, customerStore, liveSessionStore: store, quoteQueue: queue,
        historyWorkspace: workspace, LIVE_SESSIONS_DIR: path.join(directory, 'sessions'), HISTORY_ROOT_DIR: historyRoot,
        getUserHistoryDir, getLiveRuntime, liveRuntimeByUser: runtimeByUser, emitToUser() {},
        normalizeDisplayText: value => String(value || ''), cleanDisplayText: value => String(value || ''),
        normalizeOrderCustomerName: (name, username) => name || username,
        historyMetaFromFile: () => ({ date: '2026-11-01', shop: 'shop' }), timestampFromParts: () => Date.parse('2026-11-01'),
        zaloWeb: { isOpen: () => true }
    };
    vm.createContext(context);
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const run = (start, end) => vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
    run('function isAdminOrSuperAdmin(', 'function deleteVisibleStoredLiveSession(');
    run('function parseLegacySessionRef(', 'function readAllUserHistoryRows(');
    run('function safeLegacyHistoryFileName(', 'function readLegacyHistorySessions(');
    run('function getLegacyHistorySession(', 'function deleteLegacyHistorySession(');
    run('function rebuildConfirmedOrders(', 'if (fs.existsSync(CONFIG_FILE))');
    run('function readHistoryWorkspace(', '// DELETE /api/live-sessions/:sessionId');
    run("app.use('/api/quotes',", 'function requireLocalZaloExperiment(');
    return { app, store, queue, runtimeByUser, getLiveRuntime, getUserHistoryDir, context, directory, customers };
}
async function httpFixture(t) {
    const f = fixture(t);
    const server = f.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const api = async (url, method = 'GET', body, uid = 'a', extra = {}) => {
        const response = await fetch(origin + url, { method, headers: { 'Content-Type': 'application/json', ...(uid ? { 'x-user': uid } : {}), origin, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    };
    return { ...f, api };
}
const seed = [{ id: 'one', customerUsername: 'buyer', customerName: 'Buyer', productName: 'History item', price: 45000, total: 45000, quantity: 1, note: 'preserve', createdAt: '2026-11-01T00:00:00Z' }];

test('history edits persist saved/merged/legacy with no Live or unrelated active run; quote uses selected history', async t => {
    const f = await httpFixture(t);
    for (const active of [null, 'shop', 'different']) {
        const activeSession = active && f.store.startLiveSession('a', { broadcasterId: active });
        const runtime = f.getLiveRuntime('a');
        runtime.currentSessionId = activeSession?.id || null;
        runtime.confirmedOrders = { buyer: { username: 'buyer', items: [{ id: 'live', text: 'Wrong live item', price: 999 }] } };
        const runtimeBefore = JSON.stringify(runtime);
        const activeBefore = activeSession && JSON.stringify(f.store.getLiveSessionById('a', activeSession.id));
        for (const kind of ['saved', 'merged', 'legacy']) {
            const id = kind === 'legacy' ? 'legacy:user:2026-11-01_shop.json' : kind + '-' + active;
            if (kind === 'legacy') fs.writeFileSync(path.join(f.getUserHistoryDir('a'), '2026-11-01_shop.json'), JSON.stringify({ buyer: { username: 'buyer', nickname: 'Buyer', items: [{ id: 'old', text: 'History item', price: 45000, time: '01:00:00' }], total: 45000 } }));
            else f.store.createLiveSession('a', { id, type: kind === 'merged' ? 'merged_session' : 'live_session', orders: seed });
            const url = '/api/live-sessions/' + encodeURIComponent(id);
            let read = await f.api(url);
            assert.equal(read.status, 200);
            const originalRevision = read.body.revision;
            const itemId = read.body.orders[0].id;
            let changed = await f.api(url + '/orders', 'PATCH', { action: 'edit', username: 'buyer', itemId, text: 'Edited history', price: 55000, revision: originalRevision });
            assert.equal(changed.status, 200, JSON.stringify(changed.body));
            assert.equal((await f.api(url + '/orders', 'PATCH', { action: 'delete', username: 'buyer', itemId, revision: originalRevision })).status, 409);
            assert.equal((await f.api(url + '/orders', 'PATCH', { action: 'add', username: 'buyer', text: 'Bad', price: -1, revision: changed.body.revision })).status, 400);
            assert.equal((await f.api(url + '/orders', 'PATCH', { action: 'delete', username: 'buyer', itemId, revision: changed.body.revision }, 'b')).status, 404);
            assert.equal((await f.api(url + '/orders', 'PATCH', {}, null)).status, 401);
            assert.equal((await f.api(url + '/orders', 'PATCH', {}, 'a', { origin: 'https://evil.test' })).status, 403);
            assert.equal((await f.api('/api/quotes', 'POST', { username: 'buyer', source: { sessionId: id, revision: changed.body.revision } }, 'b')).status, 404);
            let quote = await f.api('/api/quotes', 'POST', { username: 'buyer', source: { sessionId: id, revision: changed.body.revision } });
            assert.equal(quote.status, 200, JSON.stringify(quote.body));
            assert.equal(quote.body.quote.items[0].label, 'Edited history');
            assert.equal(quote.body.quote.total, 55000);
            assert.equal((await f.api('/api/quotes/' + quote.body.quote.id, 'DELETE', { version: 1 })).status, 200);
            assert.equal((await f.api('/api/quotes', 'POST', { username: 'buyer', source: { sessionId: id, revision: originalRevision } })).status, 409);
            changed = await f.api(url + '/orders', 'PATCH', { action: 'add', username: 'newbuyer', text: 'Added', price: 1, revision: changed.body.revision });
            assert.equal(changed.body.orders.length, 2);
            changed = await f.api(url + '/orders', 'PATCH', { action: 'delete', username: 'buyer', itemId, revision: changed.body.revision });
            assert.equal(changed.body.orders.length, 1);
            changed = await f.api(url + '/orders', 'PATCH', { action: 'delete-customer', username: 'newbuyer', revision: changed.body.revision });
            assert.equal(changed.body.orders.length, 0);
            assert.equal((await f.api(url)).body.orders.length, 0, 'Reload reads durable edits');
            assert.equal(JSON.stringify(runtime), runtimeBefore);
            if (activeSession) assert.equal(JSON.stringify(f.store.getLiveSessionById('a', activeSession.id)), activeBefore);
        }
    }
});

test('exact active history edits synchronize only that runtime and reject stale snapshots after Live writes', async t => {
    const f = await httpFixture(t);
    const session = f.store.startLiveSession('a', { broadcasterId: 'shop' });
    f.store.updateLiveSession('a', session.id, { orders: seed });
    const runtime = f.getLiveRuntime('a'); runtime.currentSessionId = session.id;
    const url = '/api/live-sessions/' + session.id;
    const read = await f.api(url);
    const changed = await f.api(url + '/orders', 'PATCH', { action: 'edit', username: 'buyer', itemId: 'one', text: 'Targeted', price: 9, revision: read.body.revision });
    assert.equal(changed.status, 200);
    assert.equal(runtime.confirmedOrders.buyer.items[0].text, 'Targeted');
    assert.equal(f.store.getLiveSessionById('a', session.id).segments[0].orders[0].productName, 'Targeted');
    f.store.updateLiveSession('a', session.id, { orders: [...seed, { ...seed[0], id: 'two' }] });
    assert.equal((await f.api(url + '/orders', 'PATCH', { action: 'delete-customer', username: 'buyer', revision: changed.body.revision })).status, 409);
    const latest = await f.api(url);
    const previousWrite = f.store.writeUserSessions;
    f.store.writeUserSessions = () => { throw new Error('Disk failure'); };
    const runtimeBefore = JSON.stringify(runtime);
    assert.equal((await f.api(url + '/orders', 'PATCH', { action: 'delete-customer', username: 'buyer', revision: latest.body.revision })).status, 500);
    assert.equal(JSON.stringify(runtime), runtimeBefore, 'Failed persistence never mutates runtime');
    f.store.writeUserSessions = previousWrite;
    assert.equal(f.store.readUserSessions('a').length, 1);
});

test('standalone quote CRUD enforces versions, account auth, consent and in-flight delivery safety', async t => {
    const f = await httpFixture(t);
    const payload = { customerId: 'buyer-a', items: [{ label: 'Standalone', amount: 100 }], shippingNote: 'Shipping later' };
    assert.equal((await f.api('/api/quotes', 'POST', payload, null)).status, 401);
    assert.equal((await f.api('/api/quotes', 'POST', payload, 'b')).status, 404);
    assert.equal((await f.api('/api/quotes', 'POST', { ...payload, items: [] })).status, 400);
    let created = await f.api('/api/quotes', 'POST', payload);
    assert.equal(created.status, 200);
    const id = created.body.quote.id, url = '/api/quotes/' + id;
    assert.equal(created.body.quote.shippingNote, 'Shipping later');
    assert.equal((await f.api(url, 'PATCH', { version: 1 }, 'b')).status, 404);
    assert.equal((await f.api(url, 'DELETE', { version: 1 }, 'b')).status, 404);
    assert.equal((await f.api(url, 'DELETE', { version: 1 }, 'a', { origin: 'https://evil.test' })).status, 403);
    const updated = await f.api(url, 'PATCH', { version: 1, items: [{ label: 'Changed', amount: 200 }] });
    assert.equal(updated.body.quote.version, 2);
    assert.equal(updated.body.quote.previousVersions[0].items[0].label, 'Standalone');
    assert.equal((await f.api(url, 'PATCH', {})).status, 409);
    assert.equal((await f.api(url, 'PATCH', { version: 1 })).status, 409);
    assert.equal((await f.api(url, 'DELETE', { version: 1 })).status, 409);
    assert.equal((await f.api(url + '/approve', 'POST', { version: 1, channel: 'tiktok' })).status, 409);
    f.customers.a[0].consent.quoteMessages = 'denied';
    assert.equal((await f.api(url + '/approve', 'POST', { version: 2, channel: 'tiktok' })).status, 400);
    f.customers.a[0].consent.quoteMessages = 'granted';
    let approved = await f.api(url + '/approve', 'POST', { version: 2, channel: 'zalo', autoName: 'Buyer' });
    assert.equal(approved.body.delivery.status, 'queued');
    assert.equal((await f.api(url, 'PATCH', { version: 2 })).body.quote.version, 3);
    assert.throws(() => f.queue.claimZalo('a', approved.body.delivery.deliveryId, ['0900000000']), /không sẵn sàng/);
    approved = await f.api(url + '/approve', 'POST', { version: 3, channel: 'zalo', autoName: 'Buyer' });
    f.queue.claimZalo('a', approved.body.delivery.deliveryId, ['0900000000']);
    for (const method of ['PATCH', 'DELETE']) assert.equal((await f.api(url, method, { version: 3 })).status, 409);
    f.queue.markZaloNeedsCheck('a', approved.body.delivery.deliveryId);
    assert.equal((await f.api(url, 'DELETE', { version: 3 })).status, 409);
    f.queue.delivery('a', approved.body.delivery.deliveryId, 'skipped', 'Verified no send');
    assert.equal((await f.api(url + '/cancel', 'POST', { version: 3 })).status, 200);
    const cancelled = f.queue.read('a').quotes[0];
    assert.equal((await f.api(url, 'PATCH', { version: cancelled.version })).body.quote.status, 'draft', 'Cancelled quotes can be edited back to draft');
    const version = f.queue.read('a').quotes[0].version;
    approved = await f.api(url + '/approve', 'POST', { version, channel: 'zalo', autoName: 'Buyer' });
    assert.equal((await f.api(url, 'DELETE', { version })).status, 200);
    assert.equal(f.queue.read('a').quotes.length, 0);
    assert.equal(f.queue.read('a').deliveries[0].status, 'cancelled');
    assert.throws(() => f.queue.claimZalo('a', approved.body.delivery.deliveryId, ['0900000000']));
    created = await f.api('/api/quotes', 'POST', payload);
    const sentId = created.body.quote.id;
    const manual = await f.api('/api/quotes/' + sentId + '/approve', 'POST', { version: 1, channel: 'tiktok' });
    f.queue.delivery('a', manual.body.delivery.deliveryId, 'sent');
    assert.equal((await f.api('/api/quotes/' + sentId, 'DELETE', { version: 1 })).status, 200, 'Confirmed sent quotes may be removed without another send');
    assert.equal(f.queue.read('a').deliveries[0].status, 'sent', 'Keep delivery audit even when deleting sent quote');
    assert.equal(f.store.readUserSessions('a').length, 0, 'Standalone quotes never create Live history');
});

test('admin-scoped and shared history edits keep existing authorization; merged sources and run snapshots are preserved', async t => {
    const f = await httpFixture(t);
    f.store.createLiveSession('a', { id: 'source', orders: seed, segments: [{ orders: seed }] });
    f.store.createLiveSession('a', { id: 'merged', type: 'merged_session', orders: seed, sourceSessionIds: ['source'] });
    const sourceBefore = JSON.stringify(f.store.getLiveSessionById('a', 'source'));
    const url = '/api/live-sessions/' + encodeURIComponent('user:a:merged');
    const read = await f.api(url, 'GET', undefined, 'b', { 'x-role': 'admin' });
    assert.equal(read.status, 200);
    assert.equal((await f.api(url + '/orders', 'PATCH', { action: 'edit', username: 'buyer', itemId: 'one', text: 'Admin edit', price: 99, revision: read.body.revision }, 'b', { 'x-role': 'admin' })).status, 200);
    assert.equal(JSON.stringify(f.store.getLiveSessionById('a', 'source')), sourceBefore);
    assert.equal(f.store.getLiveSessionById('a', 'merged').sourceSessionIds[0], 'source');
    const target = path.join(f.directory, 'history', '2026-11-01_shared.json');
    fs.writeFileSync(target, JSON.stringify({ buyer: { username: 'buyer', items: [{ id: 'one', text: 'Shared', price: 1 }] } }));
    const sharedUrl = '/api/live-sessions/' + encodeURIComponent('legacy:shared:2026-11-01_shared.json');
    const shared = await f.api(sharedUrl, 'GET', undefined, 'b', { 'x-role': 'admin' });
    const body = { action: 'delete-customer', username: 'buyer', revision: shared.body.revision };
    assert.equal((await f.api(sharedUrl + '/orders', 'PATCH', body, 'b')).status, 404);
    assert.equal((await f.api(sharedUrl + '/orders', 'PATCH', body, 'b', { 'x-role': 'admin' })).status, 200);
    fs.writeFileSync(target, '{broken');
    assert.equal((await f.api(sharedUrl + '/orders', 'PATCH', body, 'b', { 'x-role': 'admin' })).status, 404);
    assert.equal(fs.readFileSync(target, 'utf8'), '{broken');
});
