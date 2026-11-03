'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-live-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(root, 'utils/liveSessionStore.js');
    const source = fs.readFileSync(filename, 'utf8').replace(
        "const DATA_DIR = path.join(__dirname, '..', 'data', 'live-sessions');",
        `const DATA_DIR = ${JSON.stringify(directory)};`
    );
    const module = { exports: {} };
    vm.runInNewContext(source, { require: createRequire(filename), module, __dirname: path.dirname(filename), console });
    return { store: module.exports, directory };
}

function serverFixture(t) {
    const { store, directory } = fixture(t);
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const runtimeByUser = new Map();
    const sockets = [];
    const connectors = [];
    const historyDirectory = path.join(directory, 'history');
    fs.mkdirSync(historyDirectory);
    const getUserHistoryDir = uid => path.join(historyDirectory, uid);
    for (const uid of ['a', 'b']) fs.mkdirSync(getUserHistoryDir(uid));
    let connectHandler;
    class FakeConnector extends EventEmitter {
        constructor(id) { super(); this.id = id; connectors.push(this); }
        connect() { return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
        disconnect() { this.emit('disconnected'); }
    }
    const context = {
        console: { log() {}, error() {}, warn() {} },
        liveSessionStore: store, liveRuntimeByUser: runtimeByUser,
        WebcastPushConnection: FakeConnector,
        customerStore: { normalizeTikTokUsername: value => String(value || '').replace(/^@/, '').toLowerCase() },
        normalizeDisplayText: value => String(value || ''), cleanDisplayText: value => String(value || ''),
        displayFallbackFromUsername: value => '@' + value,
        isAdminOrSuperAdmin: () => false, getUserRoom: id => id,
        emitToUser: (id, event, data) => sockets.filter(s => s.uid === id).forEach(s => s.emit(event, data)),
        io: { on(event, handler) { connectHandler = handler; } },
        printerInterface: '', tiktokSignApiKey: '',
        fs, path, HISTORY_ROOT_DIR: historyDirectory, getUserHistoryDir,
                CHAT_BUFFER_LIMIT: 300, parsePrice: () => 0,
        printBill() {}, printDetailedBill() {}, setTimeout: () => 0
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function safeLegacyHistoryFileName('), source.indexOf('function legacyHistoryFileToOrders(')), context);
    vm.runInContext(source.slice(source.indexOf('function createEmptyLiveRuntime('), source.indexOf('if (fs.existsSync(CONFIG_FILE))')), context);
    vm.runInContext(source.slice(source.indexOf('function sanitizeConfirmedOrders('), source.indexOf('function initPrinter(')), context);
    vm.runInContext(source.slice(source.indexOf("io.on('connection'"), source.indexOf('const PORT =')), context);
    const socket = uid => {
        const handlers = new Map();
        const messages = [];
        const s = {
            uid, id: String(sockets.length), request: { session: { user: { uid } } },
            join() {}, disconnect() {}, on: (event, handler) => handlers.set(event, handler),
            emit: (event, data) => messages.push({ event, data }),
            send: (event, ...args) => handlers.get(event)(...args),
            messages,
            last: event => messages.filter(m => m.event === event).at(-1)?.data
        };
        sockets.push(s);
        connectHandler(s);
        return s;
    };
    return { store, directory, socket, connectors, runtimeByUser, historyDirectory, getUserHistoryDir };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('store honors IDs/null end, rejects duplicates and updates only active records', t => {
    const { store } = fixture(t);
    const session = store.createLiveSession('a', { id: 'stable', endedAt: null, orders: [] });
    assert.equal(session.id, 'stable');
    assert.equal(session.endedAt, null);
    assert.throws(() => store.createLiveSession('a', { id: 'stable' }));
    assert.throws(() => store.updateLiveSession('b', session.id, { orders: [] }));
    store.updateLiveSession('a', session.id, { endedAt: new Date().toISOString() });
    assert.throws(() => store.updateLiveSession('a', session.id, { orders: [] }));
    assert.equal(store.readUserSessions('a').length, 1);
});

test('reuse keeps ended runs and timestamps without duplicate histories', t => {
    const { store } = fixture(t);
    const first = store.startLiveSession('a', { broadcasterId: 'shop', startedAt: '2026-11-01T01:02:03Z' });
    store.updateLiveSession('a', first.id, { orders: [{ id: 'one', price: 10, createdAt: '2026-11-01T01:03:04Z' }], endedAt: '2026-11-01T02:03:04Z' });
    assert.throws(() => store.startLiveSession('b', { broadcasterId: 'shop', resumeSessionId: first.id }));
    assert.throws(() => store.startLiveSession('a', { broadcasterId: 'other', resumeSessionId: first.id }));
    const reused = store.startLiveSession('a', { broadcasterId: 'shop', resumeSessionId: first.id });
    assert.equal(reused.segments.length, 2);
    assert.equal(reused.segments[0].endedAt, '2026-11-01T02:03:04Z');
    store.updateLiveSession('a', first.id, { orders: [], endedAt: '2026-11-02T01:02:03Z' });
    const saved = store.getLiveSessionById('a', first.id);
    assert.equal(saved.segments[0].orders.length, 1);
    assert.equal(saved.segments[1].orders.length, 0);
    assert.equal(store.readUserSessions('a').length, 1);
});

test('resuming a session starts an empty current run without losing cumulative history', t => {
    const { store } = fixture(t);
    const first = store.startLiveSession('a', { broadcasterId: 'shop', startedAt: '2026-11-01T01:02:03Z' });
    store.updateLiveSession('a', first.id, {
        orders: [{ id: 'old-order', price: 100, createdAt: '2026-11-01T01:03:04Z' }],
        endedAt: '2026-11-01T02:03:04Z'
    });

    const resumed = store.startLiveSession('a', {
        broadcasterId: 'shop', resumeSessionId: first.id, startedAt: '2026-11-02T01:02:03Z'
    });
    assert.deepEqual(JSON.parse(JSON.stringify(resumed.currentSegmentOrders)), []);
    assert.equal(resumed.orders.length, 1);

    store.updateLiveSession('a', first.id, {
        orders: [{ id: 'new-order', price: 200, createdAt: '2026-11-02T01:03:04Z' }]
    });
    const saved = store.getLiveSessionById('a', first.id);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.orders.map(order => order.id))), ['old-order', 'new-order']);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.segments.map(segment => segment.orders.map(order => order.id)))), [['old-order'], ['new-order']]);
    assert.equal(saved.summary.totalRevenue, 300);

    store.updateLiveSession('a', first.id, { orders: [] });
    const afterCurrentRunDeletion = store.getLiveSessionById('a', first.id);
    assert.deepEqual(JSON.parse(JSON.stringify(afterCurrentRunDeletion.orders.map(order => order.id))), ['old-order']);
    assert.equal(afterCurrentRunDeletion.summary.totalRevenue, 100);
});

test('resuming a cumulative legacy segment history normalizes snapshots without dropping orders', t => {
    const { store } = fixture(t);
    const legacy = { id: 'legacy-old', price: 50 };
    const one = { id: 'new-one', price: 100 };
    const two = { id: 'new-two', price: 200 };
    store.createLiveSession('a', {
        id: 'cumulative', type: 'live_session', tiktokUsername: 'shop', endedAt: '2026-11-02T03:00:00Z',
        orders: [legacy, one, two],
        segments: [
            { startedAt: '2026-11-01T01:00:00Z', orders: [legacy] },
            { startedAt: '2026-11-02T01:00:00Z', orders: [legacy, one] },
            { startedAt: '2026-11-02T02:00:00Z', orders: [legacy, one, two] }
        ]
    });

    const resumed = store.startLiveSession('a', { broadcasterId: 'shop', resumeSessionId: 'cumulative' });
    const saved = store.getLiveSessionById('a', 'cumulative');
    assert.equal(resumed.orders.length, 3);
    assert.equal(resumed.currentSegmentOrders.length, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.segments.map(segment => segment.orders.map(order => order.id)))), [['legacy-old'], ['new-one'], ['new-two'], []]);
    assert.equal(saved.summary.totalRevenue, 350);
});

test('resuming an ended Live does not preload prior orders into current Live runtime', t => {
    const { store, socket, runtimeByUser } = serverFixture(t);
    const s = socket('a');
    s.send('start-live', { uniqueId: 'shop', resumeSessionId: null });
    const originalId = store.readUserSessions('a')[0].id;
    s.send('confirm-item', { uniqueId: 'buyer', price: 100, comment: 'old' }, () => {});
    s.send('end-live');
    s.send('start-live', { uniqueId: 'shop', resumeSessionId: originalId });

    const runtime = runtimeByUser.get('a');
    assert.equal(Object.values(runtime.confirmedOrders).reduce((n, customer) => n + customer.items.length, 0), 0);
    assert.equal(store.getLiveSessionById('a', originalId).orders.length, 1);
});

test('unreadable history fails closed and is not overwritten', t => {
    const { store, directory } = fixture(t);
    const filename = path.join(directory, 'a.json');
    fs.writeFileSync(filename, '{broken');
    assert.throws(() => store.startLiveSession('a', { broadcasterId: 'shop' }));
    assert.equal(fs.readFileSync(filename, 'utf8'), '{broken');
});

test('login/reconnect do not create history; start is durable; orders cannot create sessions', async t => {
    const { store, socket, connectors, runtimeByUser, directory } = serverFixture(t);
    const s = socket('a');
    s.send('get-live-state');
    let result;
    s.send('confirm-item', { uniqueId: 'buyer', price: 10 }, data => { result = data; });
    assert.equal(result.ok, false);
    s.send('replace-confirmed-orders', { broadcasterId: 'shop', orders: {} });
    assert.equal(store.readUserSessions('a').length, 0);
    s.send('start-live', 'shop');
    const id = store.readUserSessions('a')[0].id;
    assert.equal(store.readUserSessions('a')[0].endedAt, null);
    s.send('start-live', { uniqueId: 'shop', resumeSessionId: null });
    assert.equal(connectors.length, 1);
    connectors[0].resolve({ roomId: 'room' });
    await tick();
    s.send('confirm-item', { uniqueId: 'buyer', comment: 'item', price: 10, requestId: 'request' }, data => { result = data; });
    assert.equal(result.ok, true);
    const saved = store.getLiveSessionById('a', id);
    assert.equal(saved.orders.length, 1);
    assert.match(saved.orders[0].time, /\d{2}:\d{2}:\d{2}.*\d{4}|\d{4}.*\d{2}:\d{2}:\d{2}/);
    assert.ok(saved.orders[0].createdAt);
    s.send('disconnect');
    const refreshed = socket('a');
    assert.equal(refreshed.last('live-state').sessionId, id);
    assert.equal(runtimeByUser.get('a').tiktokConnection, connectors[0]);
    assert.equal(store.readUserSessions('a').length, 1);
    assert.equal(fs.readdirSync(directory).filter(name => name.endsWith('.json')).length, 1);
    refreshed.send('end-live');
    assert.ok(store.getLiveSessionById('a', id).endedAt);
    refreshed.send('end-live');
    assert.equal(store.readUserSessions('a').length, 1);
    refreshed.send('start-live', 'shop');
    assert.equal(refreshed.last('ask-resume-session').session.id, id);
    refreshed.send('start-live', { uniqueId: 'shop', resumeSessionId: id });
    assert.equal(store.readUserSessions('a').length, 1);
    assert.equal(store.getLiveSessionById('a', id).segments.length, 2);
    connectors[1].emit('streamEnd');
    assert.ok(store.getLiveSessionById('a', id).endedAt);
});

test('network errors keep run open; retries/stale callbacks and cross-user resume are safe', async t => {
    const { store, socket, connectors } = serverFixture(t);
    const s = socket('a');
    s.send('start-live', 'shop');
    const id = store.readUserSessions('a')[0].id;
    connectors[0].reject(new Error('network'));
    await tick();
    assert.equal(store.getLiveSessionById('a', id).endedAt, null);
    s.send('start-live', 'shop');
    assert.equal(store.readUserSessions('a').length, 1);
    connectors[0].emit('streamEnd');
    connectors[0].emit('chat', { uniqueId: 'buyer', comment: 'stale' });
    assert.equal(store.getLiveSessionById('a', id).endedAt, null);
    const other = socket('b');
    other.send('start-live', { uniqueId: 'shop', resumeSessionId: id });
    assert.equal(store.readUserSessions('b').length, 0);
    s.send('start-live', { uniqueId: 'other', resumeSessionId: null });
    assert.equal(store.readUserSessions('a').length, 1);
    connectors[1].emit('streamEnd');
    assert.ok(store.getLiveSessionById('a', id).endedAt);
    s.send('start-live', { uniqueId: 'shop', resumeSessionId: null });
    assert.equal(store.readUserSessions('a').length, 2);
    connectors[1].resolve({ roomId: 'stale' });
    await tick();
    assert.notEqual(s.last('status')?.roomId, 'stale');
});

test('failed writes roll back orders and leave run retryable, including empty runs', t => {
    const { store, socket, runtimeByUser } = serverFixture(t);
    const s = socket('a');
    s.send('start-live', 'shop');
    const id = store.readUserSessions('a')[0].id;
    const originalUpdate = store.updateLiveSession;
    store.updateLiveSession = () => { throw new Error('disk full'); };
    let result;
    s.send('confirm-item', { uniqueId: 'buyer', price: 10 }, data => { result = data; });
    assert.equal(result.ok, false);
    assert.equal(Object.keys(runtimeByUser.get('a').confirmedOrders).length, 0);
    s.send('replace-confirmed-orders', { broadcasterId: 'shop', orders: { buyer: { username: 'buyer', items: [{ id: 1, price: 10 }] } } });
    assert.equal(Object.keys(runtimeByUser.get('a').confirmedOrders).length, 0);
    s.send('end-live');
    assert.equal(s.last('session-ended').saved, false);
    assert.equal(runtimeByUser.get('a').currentSessionId, id);
    assert.equal(store.getLiveSessionById('a', id).endedAt, null);
    store.updateLiveSession = originalUpdate;
    s.send('end-live');
    assert.equal(store.readUserSessions('a').length, 1);
    assert.ok(store.getLiveSessionById('a', id).endedAt);
    assert.equal(store.getLiveSessionById('a', id).orders.length, 0);
    s.send('delete-customer', 'buyer');
    s.send('delete-item', { username: 'buyer', itemId: 1 });
    s.send('edit-item', { username: 'buyer', itemId: 1, price: 20 });
    s.send('edit-item-price', { username: 'buyer', itemId: 1, newPrice: 20 });
    assert.equal(store.readUserSessions('a').length, 1);
});

test('legacy history loads offline and during any broadcaster without writes or broadcasts', t => {
    const { store, socket, runtimeByUser, getUserHistoryDir, historyDirectory } = serverFixture(t);
    const name = '2026-11-01_shop.json';
    const orders = { buyer: { username: 'buyer', nickname: 'History buyer', items: [{ id: 'old', text: 'Old item', price: 10 }], total: 10 } };
    fs.writeFileSync(path.join(getUserHistoryDir('a'), name), JSON.stringify(orders));
    fs.writeFileSync(path.join(historyDirectory, name), JSON.stringify(orders));
    const s = socket('a');
    const peer = socket('a');
    const before = fs.readFileSync(path.join(getUserHistoryDir('a'), name), 'utf8');
    s.send('load-history-file', name);
    assert.equal(s.last('history-data').data.buyer.items[0].id, 'old');
    assert.equal(peer.last('history-data'), undefined);
    assert.equal(store.readUserSessions('a').length, 0);
    for (const broadcaster of ['shop', 'different']) {
        s.send('start-live', { uniqueId: broadcaster, resumeSessionId: null });
        s.send('confirm-item', { uniqueId: 'buyer', price: 20 });
        const runtimeBefore = JSON.stringify(runtimeByUser.get('a').confirmedOrders);
        const storedBefore = JSON.stringify(store.readUserSessions('a'));
        s.send('load-history-file', name);
        assert.equal(JSON.stringify(runtimeByUser.get('a').confirmedOrders), runtimeBefore);
        assert.equal(JSON.stringify(store.readUserSessions('a')), storedBefore);
        s.send('end-live');
    }
    assert.equal(fs.readFileSync(path.join(getUserHistoryDir('a'), name), 'utf8'), before);
    const other = socket('b');
    other.send('load-history-file', name);
    other.send('load-history-file', 'shared:' + name);
    other.send('load-history-file', '../a/' + name);
    assert.equal(other.last('history-data'), undefined, 'No cross-user or shared access for ordinary users');
    fs.writeFileSync(path.join(getUserHistoryDir('a'), name), '{broken');
    s.send('load-history-file', name);
    assert.match(s.last('system-status'), /Không thể đọc lịch sử/);
    assert.equal(store.readUserSessions('a').length, 2);
});

test('session detail API is read-only for saved/merged/legacy histories and enforces ownership', t => {
    const { store, directory } = fixture(t);
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    let route;
    const auth = () => {};
    const context = { fs, path, liveSessionStore: store, LIVE_SESSIONS_DIR: directory, console,
        requireApiAuth: auth, historyWorkspace: require('../utils/historyOrderWorkspace'),
        app: { get(url, middleware, handler) { assert.equal(middleware, auth); route = handler; } },
        readLegacyHistorySession: (uid, name, options) => ({ id: name, orders: [{ id: 'legacy-order' }] })
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function isAdminOrSuperAdmin('), source.indexOf('function deleteVisibleStoredLiveSession(')), context);
    vm.runInContext(source.slice(source.indexOf('function parseLegacySessionRef('), source.indexOf('function buildLegacySessionId(')), context);
    vm.runInContext(source.slice(source.indexOf('function getLegacyHistorySession('), source.indexOf('function deleteLegacyHistorySession(')), context);
    vm.runInContext(source.slice(source.indexOf("app.get('/api/live-sessions/:sessionId',"), source.indexOf('// DELETE /api/live-sessions/:sessionId')), context);
    const endedAt = '2026-11-01T02:00:00Z';
    store.createLiveSession('a', { id: 'saved', endedAt, orders: [{ id: 'saved-order' }] });
    store.createLiveSession('a', { id: 'merged', type: 'merged_session', endedAt, orders: [{ id: 'merged-order' }] });
    const before = fs.readFileSync(path.join(directory, 'a.json'), 'utf8');
    const get = (uid, id, role = 'user') => {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
        route({ session: { user: { uid, role } }, params: { sessionId: id } }, res);
        return res;
    };
    for (const id of ['saved', 'merged', 'legacy:user:old.json']) assert.equal(get('a', id).code, 200);
    for (const id of ['saved', 'merged', 'user:a:saved', 'legacy:user:a:old.json', 'legacy:shared:old.json']) assert.equal(get('b', id).code, 404);
    assert.equal(get('b', 'user:a:saved', 'admin').code, 200);
    assert.equal(get('b', 'legacy:user:a:old.json', 'admin').code, 200);
    assert.equal(fs.readFileSync(path.join(directory, 'a.json'), 'utf8'), before);
    assert.equal(fs.existsSync(path.join(directory, 'b.json')), false);
});

test('manual history-save API only flushes existing run; no legacy mirror writes', () => {
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const api = source.slice(source.indexOf("app.post('/api/live-sessions',"), source.indexOf('// GET /api/live-sessions/:sessionId'));
    assert.match(api, /if \(!runtime.currentSessionId\)/);
    assert.doesNotMatch(api, /createLiveSession/);
    const persist = source.slice(source.indexOf('function saveSessionDataForUser('), source.indexOf('function formatLiveName('));
    assert.match(persist, /updateLiveSession/);
    assert.doesNotMatch(persist, /writeFileSync|getSessionFileName/);
});

test('frontend restores state without auto-start and exposes explicit end/reuse controls', () => {
    const source = fs.readFileSync(path.join(root, 'public/js/dashboard.js'), 'utf8');
    const login = source.slice(source.indexOf("const res = await fetch('/api/me')"), source.indexOf('let selectedSessionIds'));
    assert.doesNotMatch(login, /emit\('start-live'/);
    assert.match(source, /socket\.on\('ask-resume-session'/);
    assert.match(source, /socket\.on\('connect', \(\) => socket\.emit\('get-live-state'\)/);
    assert.match(source, /timeZone: 'Asia\/Ho_Chi_Minh'/);
    const html = fs.readFileSync(path.join(root, 'public/app.html'), 'utf8');
    assert.match(html, /id="btn-end-live"/);
});
