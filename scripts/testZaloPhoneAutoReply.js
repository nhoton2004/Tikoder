'use strict';

// Full local HTTP orchestration with a fake n8n receiver and fake Zalo sender.
// No production workflow, account, profile, credentials or real customer writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { createStore } = require('../utils/zaloAutoReplyStore');
const { createService } = require('../utils/zaloAutoReplyService');
const { createIntegrationRouter } = require('../routes/zaloAutoReply');

async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + server.address().port;
}
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

test('SĐT phrases traverse listener, durable queue, signed HTTP n8n callbacks and one guarded Zalo send', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-phone-flow-'));
    const uid = 'phone-flow-test', phone = '0900000000', name = 'Liên hệ kiểm thử';
    let clock = Date.now(), receiver, watching = false, deliveries = 0, n8nRequests = 0;
    const store = createStore({ root: path.join(root, 'queue'), now: () => clock });
    const env = { ZALO_WEB_EXPERIMENTAL: 'true', ZALO_TEST_PHONES: phone, N8N_NOTIFY_SECRET: 'offline-hmac-secret', N8N_HEADER_TOKEN: 'offline-header-token' };
    const service = createService({ store, env, now: () => clock, imageRoot: path.join(root, 'images'), adapter: {
        open: async () => {}, isOpen: () => true,
        stopWatching: () => { watching = false; },
        startWatching: async (user, callbacks) => { assert.equal(user, uid); receiver = callbacks.onMessage; watching = true; callbacks.onStatus({ watching: true, state: 'monitoring' }); },
        getWatchStatus: () => ({ open: true, watching, state: watching ? 'monitoring' : 'paused', capabilities: { image: false } }),
        sendReply: async (user, targetPhone, targetName, text, conversationKey, guard) => {
            assert.equal(user, uid); assert.equal(targetPhone, phone); assert.equal(targetName, name);
            assert.equal(text, 'Số điện thoại shop: 0900000000'); assert.equal(conversationKey, 'private:test-contact');
            assert.equal(store.read(uid).messages.find(item => item.status === 'sending')?.ruleKey, 'phone');
            guard(); deliveries++;
            return { outcome: 'sent' };
        },
    } });
    const app = express();
    app.use('/api/integrations/n8n/zalo-auto-reply', createIntegrationRouter(service));
    const appServer = http.createServer(app);
    let appBase;
    const n8nServer = http.createServer(async (req, res) => {
        try {
            assert.equal(req.url, '/webhook/tikoder/zalo-auto-reply');
            assert.equal(req.headers['x-tikoder-token'], env.N8N_HEADER_TOKEN);
            const chunks = []; for await (const chunk of req) chunks.push(chunk);
            const raw = Buffer.concat(chunks);
            assert.doesNotMatch(raw.toString(), /0900000000|Liên hệ|Số điện thoại shop|private:test-contact/);
            n8nRequests++;
            const headers = { 'content-type': 'application/json', 'x-tikoder-event-id': req.headers['x-tikoder-event-id'], 'x-tikoder-timestamp': req.headers['x-tikoder-timestamp'], 'x-tikoder-signature': req.headers['x-tikoder-signature'] };
            const inspected = await fetch(appBase + '/api/integrations/n8n/zalo-auto-reply/inspect', { method: 'POST', headers, body: raw });
            assert.equal(inspected.status, 200);
            const result = await inspected.json();
            assert.equal(result.route, 'phone');
            const command = result.command;
            const sent = await fetch(appBase + '/api/integrations/n8n/zalo-auto-reply/send', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tikoder-timestamp': command.timestamp, 'x-tikoder-signature': command.signature, 'x-tikoder-event-id': command.eventId }, body: command.body });
            assert.equal(sent.status, 202);
            res.writeHead(202, { 'content-type': 'application/json' }); res.end(JSON.stringify(await sent.json()));
        } catch (_) { res.writeHead(500); res.end('Offline orchestration assertion failed'); }
    });
    t.after(async () => { service.stop(); await close(n8nServer); await close(appServer); fs.rmSync(root, { recursive: true, force: true }); });
    appBase = await listen(appServer);
    env.N8N_AUTO_REPLY_WEBHOOK_URL = await listen(n8nServer) + '/webhook/tikoder/zalo-auto-reply';
    const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '../integrations/n8n/zalo-auto-reply.workflow.json'), 'utf8'));
    assert.ok(workflow.nodes.find(node => node.name === 'Inspect').parameters.url.endsWith('/api/integrations/n8n/zalo-auto-reply/inspect'));
    assert.ok(workflow.nodes.find(node => node.name === 'Send Signed Command').parameters.url.endsWith('/api/integrations/n8n/zalo-auto-reply/send'));
    store.saveSettings(uid, { enabled: true, cooldownSeconds: 30, target: { phone, name }, rules: { phone: { enabled: true, text: 'Số điện thoại shop: 0900000000' } } }, [phone]);
    await service.connect(uid);
    const input = (text, id = crypto.randomUUID()) => ({ sourceMessageId: id, conversationKey: 'private:test-contact', text, phone, name });
    const phrases = ['sdt', 'cho em xin sdt', 'SĐT', 'cho em xin số điện thoại shop với ạ!', 'Hotline shop là gì?', 'sdt?'];
    for (const [index, phrase] of phrases.entries()) {
        const incoming = input(phrase);
        receiver(incoming);
        const message = store.read(uid).messages.at(-1);
        assert.equal(message.status, 'queued', phrase);
        assert.deepEqual(message.candidates, ['phone'], phrase);
        await service.drain(); await service.waitForJobs();
        assert.equal(n8nRequests, index + 1, phrase);
        assert.equal(deliveries, index + 1, phrase);
        assert.equal(store.read(uid).messages.at(-1).status, 'sent', phrase);
        receiver(incoming); await service.drain(); await service.waitForJobs();
        assert.equal(deliveries, index + 1, 'Repeated source ID must not send again');

        clock += 31000;
    }
    for (const phrase of ['shop có hàng không?', 'sdtabc', 'abc_sdt', 'cho em xin QR']) {
        receiver(input(phrase));
        assert.equal(store.read(uid).messages.at(-1).status, 'pending', phrase);
    }
    await service.drain(); await service.waitForJobs();
    assert.equal(deliveries, phrases.length);
    assert.equal(n8nRequests, phrases.length);
    assert.equal(service.state(uid).connection.runtime.dispatchAttempt, phrases.length);
});
