'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteSessionStore } = require('../utils/sqliteSessionStore');
const { intervalWorker } = require('../utils/intervalWorker');
const call = (store, method, ...args) => new Promise((resolve, reject) => store[method](...args, (err, value) => err ? reject(err) : resolve(value)));

test('internal webhook HTTP is opt-in and restricted to an exact origin', () => {
    const { configuration } = require('../utils/n8nNotifications');
    const env = { NOTIFY_ENABLED: 'true', N8N_WEBHOOK_URL: 'http://n8n:5678/webhook/test', N8N_HEADER_TOKEN: 'token', N8N_NOTIFY_SECRET: 'secret' };
    assert.throws(() => configuration(env), /HTTPS/);
    assert.equal(configuration({ ...env, N8N_INTERNAL_HTTP_ORIGIN: 'http://n8n:5678' }).url, env.N8N_WEBHOOK_URL);
    assert.throws(() => configuration({ ...env, N8N_INTERNAL_HTTP_ORIGIN: 'http://n8n:5679' }), /HTTPS/);
    assert.throws(() => configuration({ ...env, N8N_WEBHOOK_URL: 'http://n8n.evil:5678', N8N_INTERNAL_HTTP_ORIGIN: 'http://n8n:5678' }), /HTTPS/);
});

test('sessions survive reopen, isolate users, expire, touch and logout durably', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-session-'));
    let now = 1000;
    let store = new SqliteSessionStore(path.join(dir, 'sessions.sqlite'), { ttl: 1000, now: () => now });
    try {
        await call(store, 'set', 'one', { cookie: {}, user: { uid: 'alice' } });
        await call(store, 'set', 'two', { cookie: { expires: new Date(1500) }, user: { uid: 'bob' } });
        store.close();
        store = new SqliteSessionStore(path.join(dir, 'sessions.sqlite'), { ttl: 1000, now: () => now });
        assert.equal((await call(store, 'get', 'one')).user.uid, 'alice');
        assert.equal((await call(store, 'get', 'two')).user.uid, 'bob');
        now = 1600;
        assert.equal(await call(store, 'get', 'two'), null);
        await call(store, 'touch', 'one', { cookie: {} });
        now = 2200;
        assert.equal((await call(store, 'get', 'one')).user.uid, 'alice');
        await call(store, 'destroy', 'one');
        assert.equal(await call(store, 'get', 'one'), null);
        await call(store, 'set', 'three', { cookie: {} });
        now = 3201;
        assert.equal(await call(store, 'get', 'three'), null);
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('worker shutdown awaits in-flight work and stops scheduling', async () => {
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let runs = 0;
    const stop = intervalWorker(async () => { runs++; started(); await new Promise(resolve => { release = resolve; }); }, 5, error => { throw error; });
    await ready;
    let stopped = false;
    const completion = stop().then(() => { stopped = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(stopped, false);
    assert.equal(runs, 1);
    release();
    await completion;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(runs, 1);
});

test('isolated server starts, serves health, requires auth and shuts down', { timeout: 20000 }, async () => {
    const { fork } = require('node:child_process');
    const { once } = require('node:events');
    const net = require('node:net');
    const root = path.resolve(__dirname, '..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-runtime-'));
    let child;
    try {
        for (const name of ['server.js', 'utils', 'routes', 'public', 'templates', 'sockets']) fs.cpSync(path.join(root, name), path.join(dir, name), { recursive: true });
        fs.writeFileSync(path.join(dir, 'config.json'), '{}');
        const listener = net.createServer();
        listener.listen(0, '127.0.0.1');
        await once(listener, 'listening');
        const port = listener.address().port;
        await new Promise(resolve => listener.close(resolve));
        fs.writeFileSync(path.join(dir, 'launch.js'), "process.on('message', () => process.emit('SIGTERM')); require('./server');");
        child = fork(path.join(dir, 'launch.js'), [], {
            cwd: dir, silent: true,
            env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_PATH: path.join(root, 'node_modules'), NODE_ENV: 'development', SESSION_SECRET: 'isolated-test-secret-not-for-production', SESSION_STORE: 'sqlite', PORT: String(port), NOTIFY_ENABLED: 'false', ZALO_WEB_EXPERIMENTAL: 'false', VITE_DEV_SKIP_AUTH: 'false', CORS_ORIGIN: 'https://shop.example' }
        });
        let stderr = '';
        child.stderr.on('data', data => { stderr += data; });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Startup timeout: ' + stderr)), 10000);
            child.once('exit', code => { clearTimeout(timer); reject(new Error('Early exit ' + code + ': ' + stderr)); });
            child.stdout.on('data', data => { if (data.toString().includes('Server running')) { clearTimeout(timer); resolve(); } });
        });
        const response = await fetch(`http://127.0.0.1:${port}/healthz`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ok' });
        const protectedResponse = await fetch(`http://127.0.0.1:${port}/api/customers`);
        assert.equal(protectedResponse.status, 401);
        const cors = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { origin: 'https://shop.example' } });
        assert.equal(cors.headers.get('access-control-allow-origin'), 'https://shop.example');
        const exited = once(child, 'exit');
        child.send('shutdown');
        assert.equal((await exited)[0], 0);
        assert.ok(fs.existsSync(path.join(dir, 'data', 'sessions.sqlite')));
    } finally {
        if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
