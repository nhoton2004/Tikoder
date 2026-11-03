'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createAdapter } = require('../utils/zaloPersonalAdapter');

function message(overrides = {}) {
    return { isSelf: false, type: 'USER', threadId: 'friend-1', data: { content: 'xin sđt', msgId: 'm-1', ts: 1700000000000 }, ...overrides };
}
test('personal adapter forwards only new private incoming text events', async () => {
    const sent = [];
    const adapter = createAdapter({ client: { sendMessage: async () => ({ msgId: 1 }) }, postEvent: async event => sent.push(event) });
    assert.equal(await adapter.handleMessage(message()), true);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { sourceMessageId: 'm-1', conversationId: 'friend-1', threadId: 'friend-1', threadType: 'USER', text: 'xin sđt', receivedAt: new Date(1700000000000).toISOString(), isSelf: false });
    assert.equal(await adapter.handleMessage(message()), false);
    assert.equal(sent.length, 1);
    assert.equal(await adapter.handleMessage(message({ isSelf: true })), false);
    assert.equal(await adapter.handleMessage(message({ type: 'GROUP' })), false);
});
test('personal adapter claims a command before sending and does not replay it', async () => {
    let sends = 0;
    const adapter = createAdapter({ client: { sendMessage: async () => { sends++; return { msgId: 9 }; } } });
    const body = { eventId: 'evt-1', action: 'send_text', threadId: 'friend-1', threadType: 'USER', text: 'Số shop' };
    const timestamp = '1700000000';
    const headers = { 'x-adapter-timestamp': timestamp, 'x-adapter-signature': 'sha256=' + crypto.createHmac('sha256', 'secret').update(timestamp + '.' + JSON.stringify(body)).digest('hex') };
    const first = await adapter.executeCommand(body, headers, 'secret', 1700000000000);
    const second = await adapter.executeCommand(body, headers, 'secret', 1700000000000);
    assert.equal(first.status, 'sent');
    assert.deepEqual(second, first);
    assert.equal(sends, 1);
});
test('personal adapter sends a validated QR image as an attachment', async () => {
    let payload;
    const adapter = createAdapter({ client: { sendMessage: async (...args) => { payload = args; return {}; } } });
    const body = { eventId: 'evt-qr', action: 'send_image', threadId: 'friend-1', threadType: 'USER', filename: 'qr.png', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WQAAAABJRU5ErkJggg==', caption: 'QR' };
    const timestamp = '1700000000';
    const headers = { 'x-adapter-timestamp': timestamp, 'x-adapter-signature': 'sha256=' + crypto.createHmac('sha256', 'secret').update(timestamp + '.' + JSON.stringify(body)).digest('hex') };
    const result = await adapter.executeCommand(body, headers, 'secret', 1700000000000);
    assert.equal(result.status, 'sent');
    assert.equal(payload[0].msg, 'QR');
    assert.equal(payload[0].attachments.data.length, 67);
    assert.equal(payload[1], 'friend-1');
    assert.equal(payload[2], 0);
});
