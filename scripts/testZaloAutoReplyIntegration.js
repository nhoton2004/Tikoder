'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createStore } = require('../utils/zaloAutoReplyStore');
const { createService } = require('../utils/zaloAutoReplyService');
const { createRuntime } = require('../utils/zaloAutoReplyRuntime');
const { createIntegrationRouter, createUiRouter } = require('../routes/zaloAutoReply');
const { sign } = require('../utils/n8nNotifications');
const uid = 'integration-test';
const phone = '0900000000';
const name = 'Khách kiểm thử';
function setup(t, options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-auto-integration-'));
    let service;
    t.after(() => { service.stop(); fs.rmSync(root, { force: true, recursive: true }); });
    const clock = { time: Date.now() };
    const store = createStore({ root: path.join(root, 'queue'), now: () => clock.time });
    const env = { ZALO_WEB_EXPERIMENTAL: 'true', ZALO_TEST_PHONES: phone, N8N_NOTIFY_SECRET: 'test-secret', N8N_HEADER_TOKEN: 'test-token', N8N_WEBHOOK_URL: 'http://127.0.0.1:5678/webhook/tikoder/event' };
    const calls = [];
    const adapter = {
        isOpen: () => true, open: async () => {}, stopWatching: () => {}, startWatching: async () => {},
        getWatchStatus: () => ({ open: true, watching: true, state: 'monitoring', capabilities: { image: false } }),
        sendReply: async (...args) => { args[5](); calls.push(args.slice(0, 5)); },
        sendImage: async () => { throw new Error('Unsupported image'); },
        ...options.adapter,
    };
    service = createService({ store, adapter, env, now: () => clock.time, fetcher: options.fetcher, imageRoot: path.join(root, 'images'), runtimeRoot: options.runtimeRoot ? path.join(root, options.runtimeRoot) : undefined });
    store.saveSettings(uid, { enabled: true, target: { phone, name }, rules: { phone: { enabled: true, text: 'Số điện thoại shop đã cấu hình', triggers: ['sdt', 'số điện thoại'] } } }, [phone]);
    const ingest = (text = 'xin sđt', id = crypto.randomUUID()) => store.ingest(uid, { sourceMessageId: id, conversationKey: 'private:123', text, phone, name }, [phone]);
    const event = message => ({ eventType: 'zalo.auto_reply_requested', tenantId: message.tenantId, messageId: message.id, eventId: message.eventId, occurredAt: message.receivedAt });
    const verify = (body, type = 'inspect', overrides = {}) => {
        const raw = Buffer.from(JSON.stringify(body)), timestamp = String(Math.floor(clock.time / 1000));
        return service.verify(raw, { 'x-tikoder-timestamp': timestamp, 'x-tikoder-signature': sign(env.N8N_NOTIFY_SECRET, timestamp, raw), 'x-tikoder-event-id': body.eventId, ...overrides }, '127.0.0.1');
    };
    return { root, clock, store, env, service, calls, adapter, ingest, event, verify };
}
test('signed inspect/send path preserves PII boundary and claims once before browser action', async t => {
    const f = setup(t), message = f.ingest();
    const result = f.service.inspect(f.verify(f.event(message)));
    assert.equal(result.route, 'phone');
    assert.doesNotMatch(JSON.stringify(result), /0900000000|Khách|xin sđt|Số điện thoại shop/);
    const command = JSON.parse(result.command.body);
    assert.equal(command.eventType, 'zalo.auto_reply_command');
    assert.equal(f.service.enqueue(f.verify(command)).status, 'accepted');
    assert.equal(f.store.read(uid).messages[0].status, 'sending');
    assert.equal(f.service.enqueue(f.verify(command)).status, 'sending');
    await f.service.waitForJobs();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0][4], 'private:123');
    assert.equal(f.store.read(uid).messages[0].status, 'needs_check');
    assert.equal(f.service.enqueue(f.verify(command)).status, 'needs_check');
    assert.equal(f.service.resolve(uid, message.id, 'sent').status, 'sent');
});
test('conditional QR dispatch binds persisted image digest and contact key, with no replay', async t => {
    const received = [];
    const f = setup(t, { adapter: {
        getWatchStatus: () => ({ open: true, watching: true, state: 'monitoring', capabilities: { image: true } }),
        sendImage: async (...args) => { args[5](); received.push(args); return { outcome: 'needs_check' }; },
    } });
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==';
    const image = f.service.upload(uid, { mime: 'image/png', data });
    f.store.saveSettings(uid, { rules: { qr: { enabled: true, caption: 'QR đã xác nhận' } } }, [phone]);
    const message = f.ingest('xin QR');
    const inspected = f.service.inspect(f.verify(f.event(message)));
    assert.equal(inspected.route, 'qr');
    assert.doesNotMatch(JSON.stringify(inspected), /QR đã xác nhận|0900000000|image\/png/);
    const command = JSON.parse(inspected.command.body);
    assert.equal(f.service.enqueue(command).status, 'accepted');
    await f.service.waitForJobs();
    assert.equal(received.length, 1);
    assert.equal(received[0][6], message.conversationKey);
    assert.equal(received[0][7], image.sha256);
    assert.equal(received[0][4], 'QR đã xác nhận');
    assert.equal(f.service.enqueue(command).status, 'needs_check');
    assert.equal(received.length, 1);
});
test('wrong signatures, timestamps, peer address, event header and action cannot send', async t => {
    const f = setup(t), event = f.event(f.ingest()), raw = Buffer.from(JSON.stringify(event));
    assert.throws(() => f.verify(event, 'inspect', { 'x-tikoder-signature': 'sha256=' + '0'.repeat(64) }), { status: 401 });
    assert.throws(() => f.verify(event, 'inspect', { 'x-tikoder-timestamp': '1000000000' }), { status: 401 });
    assert.throws(() => f.verify(event, 'inspect', { 'x-tikoder-event-id': 'other' }), { status: 400 });
    assert.throws(() => f.service.verify(raw, {}, '192.168.0.2'), { status: 403 });
    assert.throws(() => f.service.enqueue(f.verify(event)), { status: 400 });
    assert.throws(() => f.service.inspect(f.verify({ ...event, tenantId: 'a'.repeat(64) })), { status: 404 });
    assert.equal(f.calls.length, 0);
});
test('pause and re-enable invalidates callbacks and beforeSend even with identical content', async t => {
    const f = setup(t), message = f.ingest();
    const command = JSON.parse(f.service.inspect(f.event(message)).command.body);
    f.service.enqueue(command);
    f.service.pause(uid);
    f.store.saveSettings(uid, { enabled: true }, [phone]);
    await f.service.waitForJobs();
    assert.equal(f.calls.length, 0);
    assert.equal(f.store.read(uid).messages[0].status, 'needs_check');
});
test('confirmed phone and QR sends complete automatically; uncertain old events do not block fresh requests', async t => {
    let nextOutcome = 'sent';
    const sends = [];
    const f = setup(t, { adapter: {
        getWatchStatus: () => ({ open: true, watching: true, state: 'monitoring', capabilities: { image: true } }),
        sendReply: async (...args) => { args[5](); sends.push('phone'); return { outcome: nextOutcome }; },
        sendImage: async (...args) => { args[5](); sends.push('qr'); return { outcome: nextOutcome }; },
    } });
    f.service.upload(uid, { mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==' });
    f.store.saveSettings(uid, { cooldownSeconds: 30, rules: { qr: { enabled: true } } }, [phone]);
    const send = async text => {
        const message = f.ingest(text);
        const inspected = f.service.inspect(f.verify(f.event(message)));
        const command = JSON.parse(inspected.command.body);
        assert.equal(f.service.enqueue(f.verify(command)).status, 'accepted');
        await f.service.waitForJobs();
        const finished = f.store.read(uid).messages.find(item => item.id === message.id);
        assert.equal(f.service.enqueue(f.verify(command)).status, finished.status);
        return finished;
    };
    assert.equal((await send('sdt')).status, 'sent');
    assert.equal(f.service.state(uid).connection.runtime.reasonCode, 'send_confirmed');
    assert.equal((await send('qr')).status, 'sent');
    f.clock.time += 31000;
    nextOutcome = 'needs_check';
    const uncertain = await send('sdt');
    assert.equal(uncertain.status, 'needs_check');
    f.clock.time += 31000;
    nextOutcome = 'sent';
    assert.equal((await send('sdt')).status, 'sent');
    assert.equal(f.store.read(uid).messages.find(item => item.id === uncertain.id).status, 'needs_check');
    assert.deepEqual(sends, ['phone', 'qr', 'phone', 'phone']);
});

test('browser errors become needs_check and cannot be replayed', async t => {
    const f = setup(t, { adapter: { sendReply: async () => { throw new Error('network after Enter'); } } });
    const message = f.ingest(), command = JSON.parse(f.service.inspect(f.event(message)).command.body);
    f.service.enqueue(command); await f.service.waitForJobs();
    assert.equal(f.store.read(uid).messages[0].status, 'needs_check');
    assert.equal(f.service.enqueue(command).status, 'needs_check');
});
test('QR upload is tenant private, validates bytes/digest; unsupported QR is held before claim', t => {
    const f = setup(t);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==', 'base64');
    assert.throws(() => f.service.upload(uid, { mime: 'image/png', data: Buffer.from('<html>').toString('base64') }), { status: 400 });
    const image = f.service.upload(uid, { mime: 'image/png', data: png.toString('base64') });
    assert.equal(image.mime, 'image/png');
    const location = f.service.image(uid).filename;
    assert.ok(location.startsWith(f.root));
    assert.throws(() => f.service.image('other-tenant'), { status: 409 });
    f.store.saveSettings(uid, { rules: { qr: { enabled: true } } }, [phone]);
    const message = f.ingest('xin mã QR');
    const result = f.service.inspect(f.event(message));
    assert.equal(result.route, 'review');
    assert.equal(f.store.read(uid).messages[0].status, 'pending');
    assert.equal(f.store.pendingDispatch().length, 0);
    assert.equal(f.calls.length, 0);
    fs.writeFileSync(location, 'changed');
    assert.throws(() => f.service.image(uid), { status: 409 });
});
test('old incoming events are held instead of dispatching send commands', t => {
    const f = setup(t), message = f.ingest();
    f.clock.time += 11 * 60 * 1000;
    assert.equal(f.service.inspect(f.event(message)).route, 'review');
    assert.equal(f.store.read(uid).messages[0].status, 'pending');
});
test('transport derives a separate webhook and forwards only signed metadata', async t => {
    let f;
    f = setup(t, { fetcher: async (url, options) => {
        assert.equal(url, 'http://127.0.0.1:5678/webhook/tikoder/zalo-auto-reply');
        assert.equal(options.headers['x-tikoder-token'], 'test-token');
        assert.equal(options.headers['x-tikoder-signature'], sign('test-secret', options.headers['x-tikoder-timestamp'], options.body));
        assert.doesNotMatch(options.body, /0900000000|Khách|xin|private:123/);
        const command = JSON.parse(f.service.inspect(JSON.parse(options.body)).command.body);
        f.service.enqueue(command);
        return { ok: true, status: 202 };
    } });
    f.ingest(); await f.service.drain(); await f.service.waitForJobs();
    assert.equal(f.calls.length, 1);
    await f.service.drain(); assert.equal(f.calls.length, 1);
});
test('authenticated LAN device can upload QR and retrieve its saved preview, but cannot control automation', async t => {
    const f = setup(t), app = express();
    app.use(express.json({ limit: '8mb' }));
    app.use('/ui', (req, res, next) => {
        Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: req.get('x-test-peer') || '192.168.1.45' });
        next();
    }, createUiRouter(f.service, (req, res, next) => {
        if (req.get('x-test-login') !== 'yes') return res.status(401).json({ error: 'Chưa đăng nhập' });
        req.session = { user: { uid } }; next();
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = 'http://127.0.0.1:' + server.address().port;
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==';
    const headers = { 'x-test-login': 'yes', 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/ui')).status, 401);
    assert.equal((await fetch(base + '/ui', { headers: { ...headers, 'x-test-peer': '8.8.8.8' } })).status, 403);
    assert.equal((await fetch(base + '/ui', { headers })).status, 200);
    assert.equal((await fetch(base + '/ui/image', { method: 'POST', headers, body: JSON.stringify({ mime: 'image/png', data }) })).status, 403);
    assert.equal((await fetch(base + '/ui/image', { method: 'POST', headers: { ...headers, origin: base }, body: JSON.stringify({ mime: 'image/png', data }) })).status, 200);
    const state = await (await fetch(base + '/ui', { headers })).json();
    assert.equal(state.settings.rules.qr.image.mime, 'image/png');
    const preview = await fetch(base + '/ui/image', { headers });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), Buffer.from(data, 'base64'));
    assert.equal((await fetch(base + '/ui/connect', { method: 'POST', headers: { ...headers, origin: base }, body: '{}' })).status, 403);
});

test('HTTP routes retain raw HMAC bytes, require login and same origin, isolate state', async t => {
    const f = setup(t), app = express();
    app.use('/integration', createIntegrationRouter(f.service));
    app.use(express.json({ limit: '8mb' }));
    app.use('/ui', createUiRouter(f.service, (req, res, next) => {
        if (req.get('x-test-login') !== 'yes') return res.status(401).json({ error: 'Chưa đăng nhập' });
        req.session = { user: { uid } }; next();
    }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base + '/ui')).status, 401);
    const headers = { 'x-test-login': 'yes', 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/ui/pause', { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/ui', { headers })).status, 200);
    const message = f.ingest(), body = JSON.stringify(f.event(message)), timestamp = String(Math.floor(f.clock.time / 1000));
    const response = await fetch(base + '/integration/inspect', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tikoder-timestamp': timestamp, 'x-tikoder-signature': sign('test-secret', timestamp, body), 'x-tikoder-event-id': message.eventId }, body });
    assert.equal(response.status, 200); assert.equal((await response.json()).route, 'phone');
    f.env.N8N_DATA_API_SECRET = 'data-secret'; f.env.N8N_DATA_API_TENANT = 'shop-tenant'; f.env.N8N_DATA_API_UID = uid;
    const dataTimestamp = String(Math.floor(f.clock.time / 1000));
    const dataResponse = await fetch(base + '/integration/data', { headers: { 'x-tikoder-data-tenant': 'shop-tenant', 'x-tikoder-data-timestamp': dataTimestamp, 'x-tikoder-data-signature': sign('data-secret', dataTimestamp, 'shop-tenant') } });
    assert.equal(dataResponse.status, 200); assert.equal((await dataResponse.json()).phone.text, 'Số điện thoại shop đã cấu hình');
    assert.equal((await fetch(base + '/ui/pause', { method: 'POST', headers: { ...headers, origin: base }, body: '{}' })).status, 200);
    assert.equal(f.store.read(uid).settings.enabled, false);
});

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function watcherSetup(t, onStart, options = {}) {
    const control = { open: false, watching: false, state: 'paused', starts: [], opens: 0, stops: 0, reader: undefined };
    const status = () => ({ open: control.open, watching: control.watching, state: control.state, reader: control.reader });
    const adapter = {
        isOpen: () => control.open,
        open: async () => { control.opens++; control.open = true; },
        stopWatching: () => { control.stops++; control.watching = false; control.state = 'paused'; },
        getWatchStatus: status,
        startWatching: async (user, callbacks) => {
            control.starts.push(callbacks);
            if (onStart) return onStart(control, callbacks, status);
            control.watching = true; control.state = 'monitoring'; callbacks.onStatus(status());
        },
    };
    return { ...setup(t, { ...options, adapter }), control, status };
}
function incoming(sourceMessageId = crypto.randomUUID()) {
    return { sourceMessageId, conversationKey: 'private:123', text: 'xin sđt', phone, name };
}
function runtimeFile(f, directory = 'zalo-auto-reply-runtime') {
    return path.join(f.root, directory, crypto.createHash('sha256').update(uid).digest('hex') + '.json');
}
function persisted(f, directory) { return JSON.parse(fs.readFileSync(runtimeFile(f, directory), 'utf8')); }

test('unsupported initial login retries only when due, then watches without opening again; GET never resets attempts', async t => {
    let loggedIn = false;
    const f = watcherSetup(t, (control, callbacks, status) => {
        control.watching = loggedIn;
        control.state = loggedIn ? 'monitoring' : 'unsupported';
        callbacks.onStatus(status());
    });
    const initial = await f.service.connect(uid);
    assert.equal(initial.connection.runtime.phase, 'waiting_zalo');
    assert.equal(initial.connection.runtime.attempts, 1);
    assert.equal(Date.parse(initial.connection.runtime.lastAttemptAt), f.clock.time);
    assert.equal(Date.parse(initial.connection.runtime.nextRetryAt), f.clock.time + 5000);
    for (let i = 0; i < 3; i++) assert.deepEqual(f.service.state(uid).connection.runtime, initial.connection.runtime);
    f.clock.time += 4999;
    await f.service.supervise();
    assert.equal(f.control.starts.length, 1);
    loggedIn = true; f.clock.time++;
    await f.service.supervise();
    assert.equal(f.control.starts.length, 2);
    assert.equal(f.control.opens, 1);
    assert.equal(persisted(f).phase, 'monitoring');
    assert.equal(persisted(f).attempts, 2);
    assert.equal(persisted(f).nextRetryAt, null);
    assert.ok(f.control.starts[1].onMessage(incoming()));
    assert.equal(f.store.read(uid).messages.length, 1);
    assert.equal(persisted(f).ingested, 1);
});

test('repeated unsupported or throwing starts use bounded 5..30 second backoff', async t => {
    const f = watcherSetup(t, control => {
        control.state = 'unsupported';
        if (control.starts.length % 2 === 0) throw new Error('private login failure ' + phone);
    });
    await f.service.connect(uid);
    for (const delay of [5000, 10000, 20000, 30000, 30000]) {
        const before = f.control.starts.length, runtime = f.service.state(uid).connection.runtime;
        assert.equal(Date.parse(runtime.nextRetryAt) - f.clock.time, delay);
        f.clock.time += delay - 1;
        await f.service.supervise();
        assert.equal(f.control.starts.length, before);
        f.clock.time++;
        await f.service.supervise();
        assert.equal(f.control.starts.length, before + 1);
    }
    assert.equal(f.control.opens, 1);
    assert.equal(f.service.state(uid).connection.runtime.phase, 'waiting_zalo');
});

test('a transient stopped listener recovers using watching, not a resolved startup promise', async t => {
    const f = watcherSetup(t);
    await f.service.connect(uid);
    f.control.watching = false; f.control.state = 'error';
    f.control.starts[0].onStatus(f.status());
    assert.equal(persisted(f).phase, 'waiting_zalo');
    await f.service.supervise();
    assert.equal(f.control.starts.length, 1);
    f.clock.time += 5000;
    await f.service.supervise();
    assert.equal(f.control.starts.length, 2);
    assert.equal(persisted(f).phase, 'monitoring');
    assert.equal(f.control.opens, 1);
});

test('enabled settings and GET alone never authorize a browser or watcher; a closed browser is not reopened', async t => {
    const f = watcherSetup(t);
    f.service.state(uid);
    await f.service.supervise();
    await f.service.save(uid, { enabled: true });
    f.clock.time += 30000; await f.service.supervise();
    assert.equal(f.control.starts.length, 0);
    assert.equal(f.control.opens, 0);
    await f.service.connect(uid);
    const old = f.control.starts[0];
    f.control.open = false; f.control.watching = false; f.control.state = 'closed';
    await f.service.supervise();
    assert.equal(persisted(f).phase, 'disconnected');
    assert.equal(persisted(f).nextRetryAt, null);
    assert.equal(old.onMessage(incoming()), null);
    f.clock.time += 90000; await f.service.supervise();
    assert.equal(f.control.starts.length, 1);
    assert.equal(f.control.opens, 1);
});

test('pause during pending startup rejects callbacks and cancels retry, including late status and completion', async t => {
    const gate = deferred(), entered = deferred();
    const f = watcherSetup(t, async (control, callbacks, status) => {
        entered.resolve(); await gate.promise;
        control.watching = true; control.state = 'monitoring'; callbacks.onStatus(status());
    });
    const connecting = f.service.connect(uid);
    await entered.promise;
    const old = f.control.starts[0];
    f.service.pause(uid);
    assert.equal(old.onMessage(incoming('stale-pending')), null);
    gate.resolve(); await connecting;
    old.onStatus({ watching: true, state: 'monitoring' });
    f.clock.time += 90000; await f.service.supervise();
    assert.equal(f.control.watching, false);
    assert.equal(f.control.starts.length, 1);
    assert.equal(f.store.read(uid).messages.length, 0);
    assert.equal(persisted(f).phase, 'paused');
    assert.equal(persisted(f).nextRetryAt, null);
    assert.equal(persisted(f).reader.rejectedCount, 1);
});

test('explicit re-enable invalidates old generations without persisting stale message dedup', async t => {
    const f = watcherSetup(t);
    await f.service.connect(uid);
    const old = f.control.starts[0], event = incoming('same-event-after-reenable');
    f.service.pause(uid);
    await f.service.save(uid, { enabled: true });
    const fresh = f.control.starts[1];
    assert.equal(old.onMessage(event), null);
    old.onStatus({ state: 'unsupported', watching: false });
    assert.equal(persisted(f).phase, 'monitoring');
    assert.ok(fresh.onMessage(event));
    assert.equal(f.store.read(uid).messages.length, 1);
    assert.equal(persisted(f).reader.rejectedCount, 1);
    assert.equal(persisted(f).ingested, 1);
    f.store.saveSettings(uid, { enabled: false }, [phone]);
    assert.equal(fresh.onMessage(incoming()), null);
    await f.service.supervise();
    assert.equal(persisted(f).phase, 'paused');
});

test('save while a start is pending serializes generations; concurrent supervisors cannot double start', async t => {
    const gate = deferred(), entered = deferred();
    const f = watcherSetup(t, async (control, callbacks, status) => {
        if (control.starts.length === 1) { entered.resolve(); await gate.promise; }
        control.watching = true; control.state = 'monitoring'; callbacks.onStatus(status());
    });
    const first = f.service.connect(uid); await entered.promise;
    const saving = f.service.save(uid, { enabled: true });
    await Promise.all([f.service.supervise(), f.service.supervise()]);
    assert.equal(f.control.starts.length, 1);
    gate.resolve(); await Promise.all([first, saving]);
    assert.equal(f.control.starts.length, 2);
    assert.equal(f.control.starts[0].onMessage(incoming()), null);
    assert.ok(f.control.starts[1].onMessage(incoming()));
    assert.equal(persisted(f).attempts, 1);
    f.control.watching = false;
    await f.service.supervise(); f.clock.time += 5000;
    await Promise.all([f.service.supervise(), f.service.supervise(), f.service.supervise()]);
    assert.equal(f.control.starts.length, 3);
});

test('stop invalidates pending starts and retries, and disabled supervisors cannot start later', async t => {
    const gate = deferred(), entered = deferred();
    const f = watcherSetup(t, async (control, callbacks, status) => {
        entered.resolve(); await gate.promise;
        control.watching = true; control.state = 'monitoring'; callbacks.onStatus(status());
    });
    const first = f.service.connect(uid); await entered.promise;
    f.service.stop();
    const old = f.control.starts[0];
    assert.equal(old.onMessage(incoming()), null);
    gate.resolve(); await first;
    await f.service.save(uid, { enabled: true });
    await f.service.connect(uid);
    f.clock.time += 90000;
    await f.service.supervise();
    assert.equal(f.control.starts.length, 1);
    assert.equal(f.control.opens, 1);
    assert.equal(f.control.watching, false);
    assert.equal(persisted(f).nextRetryAt, null);
});

test('runtime whitelists reader numbers, timestamps, enums and paths, never PII or arbitrary detail', async t => {
    const f = watcherSetup(t);
    await f.service.connect(uid);
    const secret = uid + ' ' + phone + ' ' + name + ' customer text test-secret test-token';
    f.control.starts[0].onStatus({ watching: true, state: 'monitoring', detail: secret, uid, token: secret,
        reader: { lastPollAt: f.clock.time, readableMessages: 12, inboundMessages: 8, eligibleMessages: 3, pollCount: 4, deliveredCount: 2,
            observationStartedAt: f.clock.time - 1000, trackerEpoch: 4, atBottom: false, candidateCount: 2, resetReason: 'outside-history-mutation',
                        skipped: { structure: 1, identity: 2, direction: 3, plaintext: 4, time: 5, baseline: 6, untracked: 7, duplicate: 8, future: 9, text: secret },
            resetCounts: { 'user-scroll': 2, 'root-detached': 1, [secret]: 99 },
            name: secret, customerText: secret, error: { message: secret } } });
    const disk = persisted(f);
    assert.equal(disk.lastPollAt, new Date(f.clock.time).toISOString());
    assert.deepEqual(disk.reader, { lastPollAt: disk.lastPollAt, readableMessages: 12, inboundMessages: 8, eligibleMessages: 3,
        pollCount: 4, deliveredCount: 2, acceptedCount: 0, rejectedCount: 0,
        observationStartedAt: new Date(f.clock.time - 1000).toISOString(), trackerEpoch: 4, atBottom: false, candidateCount: 2, resetReason: 'outside-history-mutation',
                skipped: { structure: 1, identity: 2, direction: 3, plaintext: 4, time: 5, baseline: 6, untracked: 7, duplicate: 8, future: 9 }, resetCounts: { 'user-scroll': 2, 'root-detached': 1 } });
    const raw = fs.readFileSync(runtimeFile(f), 'utf8');
    for (const value of [uid, phone, name, 'customer text', 'test-secret', 'test-token', 'detail', 'customerText']) assert.equal(raw.includes(value), false);
    assert.deepEqual(fs.readdirSync(path.dirname(runtimeFile(f))), [path.basename(runtimeFile(f))]);
    assert.ok(!runtimeFile(f).includes(path.sep + 'public' + path.sep));
    f.control.starts[0].onStatus({ watching: true, state: secret, reader: { readableMessages: -10, inboundMessages: Infinity, eligibleMessages: secret,
        pollCount: 1e100, deliveredCount: 2.8, lastPollAt: secret, skipped: { identity: NaN }, resetCounts: { 'user-scroll': secret } } });
    const bounded = persisted(f);
    assert.equal(bounded.adapterState, 'unknown');
    assert.equal(bounded.reader.readableMessages, 0);
    assert.equal(bounded.reader.inboundMessages, 0);
    assert.equal(bounded.reader.eligibleMessages, 0);
    assert.equal(bounded.reader.pollCount, 1000000000);
    assert.equal(bounded.reader.deliveredCount, 2);
    assert.equal(bounded.lastPollAt, null);
    assert.equal(bounded.reader.resetCounts['user-scroll'], 0);
});

test('reader drop diagnostics reject malicious values and preserve optional legacy shape', () => {
    const { sanitize } = require('../utils/zaloAutoReplyRuntime');
    const secret = '<img src=x onerror=alert(1)> customer token raw DOM';
    assert.deepEqual(sanitize({ reader: {} }).reader, {});
    const reader = sanitize({ reader: {
        observationStartedAt: secret, trackerEpoch: secret, candidateCount: { text: secret }, atBottom: secret, resetReason: secret,
        skipped: { baseline: secret, untracked: { token: secret }, duplicate: Infinity, future: -1, [secret]: 1 },
        rawDom: secret, messages: [secret], token: secret
    } }).reader;
    assert.deepEqual(reader, { observationStartedAt: null, trackerEpoch: 0, candidateCount: 0,
        skipped: { baseline: 0, untracked: 0, duplicate: 0, future: 0 } });
    assert.equal(JSON.stringify(reader).includes(secret), false);
    for (const invalid of [true, 1, {}, ['user-scroll'], '__proto__', 'toString']) {
        assert.equal(Object.hasOwn(sanitize({ reader: { resetReason: invalid, atBottom: invalid === true ? 1 : invalid } }).reader, 'resetReason'), false);
        assert.equal(Object.hasOwn(sanitize({ reader: { atBottom: invalid === true ? 1 : invalid } }).reader, 'atBottom'), false);
    }
    assert.deepEqual(sanitize({ reader: { observationStartedAt: '2026-10-25T10:00:00.000Z', trackerEpoch: 2.9, candidateCount: 1e100, atBottom: true, resetReason: 'initial-baseline' } }).reader,
        { observationStartedAt: '2026-10-25T10:00:00.000Z', trackerEpoch: 2, candidateCount: 1000000000, atBottom: true, resetReason: 'initial-baseline' });
});

test('mutation trace is bounded, reconstructs every field and never persists DOM or customer data', () => {
    const { sanitize } = require('../utils/zaloAutoReplyRuntime');
    const secret = 'private-message-phone-token';
    const event = { at: '2026-10-26T10:43:59.000Z', event: 'reset', reason: 'baseline-mutation',
        epoch: 2, candidatesBefore: 1, rowsBefore: 15, rowsAfter: 16, atBottom: true, mutationCount: 12,
        payload: secret, mutations: Array.from({ length: 12 }, () => ({ kind: 'attributes', region: 'timestamp',
            attribute: 'style', added: 0, removed: 0, oldValue: secret, target: { innerHTML: secret } })) };
    const reader = sanitize({ reader: { implementation: 'observed-dom-mutation-trace-1',
        trace: Array.from({ length: 30 }, () => event) } }).reader;
    assert.equal(reader.trace.length, 24);
    assert.equal(reader.trace[0].mutations.length, 8);
    assert.equal(reader.implementation, 'observed-dom-mutation-trace-1');
    assert.equal(JSON.stringify(reader).includes(secret), false);
    assert.deepEqual(Object.keys(reader.trace[0]).sort(), ['at', 'event', 'reason', 'epoch', 'candidatesBefore',
        'rowsBefore', 'rowsAfter', 'atBottom', 'mutationCount', 'mutations'].sort());
    const bad = sanitize({ reader: { implementation: secret, trace: [
        { ...event, reason: secret }, { ...event, at: secret }, { ...event, event: secret },
        { ...event, atBottom: secret, candidatesBefore: Infinity,
            mutations: [{ kind: secret, region: secret, attribute: secret, added: -1, removed: 1e100, text: secret }] },
    ] } }).reader;
    assert.equal(bad.trace.length, 1);
    assert.equal(bad.trace[0].atBottom, false);
    assert.equal(bad.trace[0].candidatesBefore, 0);
    assert.deepEqual(bad.trace[0].mutations[0], { kind: 'other', region: 'outside-root', attribute: 'other', added: 0, removed: 1000000000 });
    assert.equal(JSON.stringify(bad).includes(secret), false);
});

test('accepted, rejected and invalid incoming callbacks persist counts but no event contents', async t => {
    const f = watcherSetup(t); await f.service.connect(uid);
    const callback = f.control.starts[0].onMessage;
    assert.ok(callback(incoming()));
    assert.equal(callback({ ...incoming(), phone: '0911111111' }), null);
    assert.throws(() => callback({ ...incoming(), sourceMessageId: '<invalid>' }));
    const disk = persisted(f);
    assert.equal(disk.ingested, 1);
    assert.equal(disk.reader.acceptedCount, 1);
    assert.equal(disk.reader.rejectedCount, 2);
    assert.equal(disk.lastIncomingAt, new Date(f.clock.time).toISOString());
    assert.equal(disk.reasonCode, 'ingest_failed');
    assert.doesNotMatch(fs.readFileSync(runtimeFile(f), 'utf8'), /xin|private:123|0900000000|Khách|invalid/);
});

test('runtimeRoot override and sanitized restart snapshot do not restore auto-connect authority', async t => {
    const f = watcherSetup(t, undefined, { runtimeRoot: 'private-runtime' });
    await f.service.connect(uid);
    assert.ok(fs.existsSync(runtimeFile(f, 'private-runtime')));
    assert.equal(fs.existsSync(path.join(f.root, 'zalo-auto-reply-runtime')), false);
    const disk = persisted(f, 'private-runtime');
    fs.writeFileSync(runtimeFile(f, 'private-runtime'), JSON.stringify({ ...disk, uid, token: 'test-secret', reader: { ...disk.reader, text: name } }));
    const restarted = createService({ store: f.store, adapter: f.adapter, env: f.env, now: () => f.clock.time, imageRoot: path.join(f.root, 'images'), runtimeRoot: path.join(f.root, 'private-runtime') });
    const restored = restarted.state(uid).connection.runtime;
    assert.equal(restored.attempts, disk.attempts);
    assert.doesNotMatch(JSON.stringify(restored), /integration-test|test-secret|Khách/);
    f.control.watching = false;
    f.clock.time += 30000;
    await restarted.supervise();
    assert.equal(f.control.starts.length, 1);
    assert.equal(f.control.opens, 1);
});

test('dispatch runtime retains HTTP codes and bounded counts, never response payloads or thrown secrets', async t => {
    let response = 503;
    const f = setup(t, { fetcher: async () => {
        if (response === 0) throw new Error(uid + phone + name + 'test-secret customer payload');
        return { ok: response === 202, status: response, body: { token: 'test-token', text: name } };
    } });
    f.ingest(); await f.service.drain();
    assert.equal(persisted(f).lastDispatchStatus, 503);
    assert.equal(persisted(f).dispatchAttempt, 1);
    assert.equal(persisted(f).phase, 'needs_check');
    assert.equal(persisted(f).reasonCode, 'dispatch_failed');
    response = 0; f.clock.time += 30000; await f.service.drain();
    assert.equal(persisted(f).lastDispatchStatus, 0);
    assert.equal(persisted(f).dispatchAttempt, 2);
    assert.equal(persisted(f).reasonCode, 'dispatch_failed');
    assert.doesNotMatch(fs.readFileSync(runtimeFile(f), 'utf8'), /integration-test|0900000000|Khách|test-secret|test-token|payload|body|error/);
});

test('async browser send results remain needs_check even after healthy reader status or successful n8n dispatch', async t => {
    let f, dispatchBrowser = true;
    f = watcherSetup(t, undefined, { fetcher: async (url, options) => {
        if (dispatchBrowser) {
            const command = JSON.parse(f.service.inspect(JSON.parse(options.body)).command.body);
            f.service.enqueue(command);
            await f.service.waitForJobs();
        }
        return { ok: true, status: 202 };
    } });
    await f.service.connect(uid);
    f.ingest();
    const draining = f.service.drain();
    assert.equal(persisted(f).phase, 'dispatching');
    f.control.starts[0].onStatus(f.status());
    assert.equal(persisted(f).phase, 'dispatching');
    await draining;
    assert.equal(persisted(f).lastDispatchStatus, 202);
    assert.equal(persisted(f).phase, 'needs_check');
    assert.equal(persisted(f).reasonCode, 'send_uncertain');
    f.control.starts[0].onStatus(f.status());
    assert.equal(persisted(f).phase, 'needs_check');
    assert.equal(persisted(f).reasonCode, 'send_uncertain');
    assert.equal(f.store.read(uid).messages[0].status, 'needs_check');
    dispatchBrowser = false;
    f.ingest(); await f.service.drain();
    assert.equal(persisted(f).lastDispatchStatus, 202);
    assert.equal(persisted(f).phase, 'needs_check');
    assert.equal(persisted(f).reasonCode, 'send_uncertain');
    assert.equal(f.calls.length, 1);
});

test('browser send failure emits a known runtime reason, not exception text', async t => {
    const f = setup(t, { adapter: { sendReply: async () => { throw new Error(uid + phone + name + ' test-secret payload'); } } });
    const message = f.ingest(), command = JSON.parse(f.service.inspect(f.event(message)).command.body);
    f.service.enqueue(command); await f.service.waitForJobs();
    assert.equal(persisted(f).phase, 'needs_check');
    assert.equal(persisted(f).reasonCode, 'send_failed');
    assert.doesNotMatch(fs.readFileSync(runtimeFile(f), 'utf8'), /integration-test|0900000000|Khách|test-secret|payload/);
});

test('runtime writes reconstruct the exact schema and failed atomic replacement preserves the old snapshot', t => {
    const f = setup(t), root = path.join(f.root, 'atomic-runtime');
    const runtime = createRuntime({ root, now: () => f.clock.time });
    assert.equal(fs.existsSync(root), false);
    assert.equal(runtime.read(uid).phase, 'disconnected');
    assert.equal(fs.existsSync(root), false);
    const initial = runtime.write(uid, { phase: 'monitoring', attempts: 1, reasonCode: 'none', uid, phone, name, token: 'test-secret' });
    assert.deepEqual(Object.keys(initial).sort(), ['updatedAt', 'phase', 'attempts', 'lastAttemptAt', 'nextRetryAt', 'adapterState', 'reader', 'lastPollAt', 'lastIncomingAt', 'ingested', 'dispatchAttempt', 'lastDispatchStatus', 'reasonCode'].sort());
    const rename = fs.renameSync;
    try {
        fs.renameSync = () => { throw new Error('private filesystem detail ' + uid); };
        assert.throws(() => runtime.write(uid, { phase: 'connecting' }));
    } finally { fs.renameSync = rename; }
    assert.deepEqual(runtime.read(uid), initial);
    assert.deepEqual(fs.readdirSync(root), [path.basename(runtimeFile(f))]);
    const safe = runtime.write(uid, { phase: name, adapterState: phone, reasonCode: 'test-secret', attempts: 1e99, dispatchAttempt: -4, lastDispatchStatus: '503 ' + name,
        lastIncomingAt: 'customer text', lastAttemptAt: { phone }, detail: 'payload' });
    assert.equal(safe.phase, 'disconnected');
    assert.equal(safe.adapterState, 'unknown');
    assert.equal(safe.reasonCode, 'none');
    assert.equal(safe.attempts, 1000000000);
    assert.equal(safe.dispatchAttempt, 0);
    assert.equal(safe.lastDispatchStatus, 0);
    assert.equal(safe.lastIncomingAt, null);
    assert.equal(safe.lastAttemptAt, null);
    assert.doesNotMatch(fs.readFileSync(runtimeFile(f, 'atomic-runtime'), 'utf8'), /integration-test|0900000000|Khách|test-secret|customer|payload|detail/);
});

test('the timer supervises independently of n8n config failure, and stop cancels subsequent ticks', async t => {
    const originalSet = global.setInterval, originalClear = global.clearInterval;
    let tick, cancelled = false;
    global.setInterval = callback => { tick = callback; return { unref() {} }; };
    global.clearInterval = () => { cancelled = true; };
    t.after(() => { global.setInterval = originalSet; global.clearInterval = originalClear; });
    const f = watcherSetup(t, control => { control.state = 'unsupported'; }, { fetcher: async () => { assert.fail('Invalid config must not reach transport'); } });
    await f.service.connect(uid);
    f.ingest(); f.env.N8N_HEADER_TOKEN = '';
    f.service.start();
    assert.equal(typeof tick, 'function');
    f.clock.time += 5000;
    tick();
    // Let both independent promise lanes, including the rejected config path, settle.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.control.starts.length, 2);
    assert.equal(persisted(f).reasonCode, 'dispatch_config');
    assert.equal(persisted(f).phase, 'needs_check');
    f.service.stop();
    assert.equal(cancelled, true);
    f.clock.time += 30000;
    await f.service.supervise();
    assert.equal(f.control.starts.length, 2);
    assert.equal(persisted(f).reasonCode, 'stopped');
});
