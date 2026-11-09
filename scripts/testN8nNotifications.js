const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const customers = require('../utils/customerStore');
const queue = require('../utils/quoteQueue');
const notifications = require('../utils/n8nNotifications');

test('notifications are signed, tenant scoped and do not include customer details', async () => {
    const uid = 'notify_test_' + crypto.randomUUID();
    const queueFile = path.join(queue.ROOT, crypto.createHash('sha256').update(uid).digest('hex') + '.json');
    const customerFile = customers.getUserCustomerFile(uid);
    const oldEnabled = process.env.NOTIFY_ENABLED;
    let received;
    const server = http.createServer((req, res) => { let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { received = { body, headers: req.headers }; res.writeHead(202); res.end(); }); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        process.env.NOTIFY_ENABLED = 'true';
        const c = customers.createCustomer(uid, { displayName: 'Private Customer', tiktokUsername: 'privateuser', phone: '0912345678' });
        queue.create(uid, c, { items: [{ text: 'Private item', price: 123 }] });
        const config = notifications.configuration({ NOTIFY_ENABLED: 'true', N8N_WEBHOOK_URL: 'http://127.0.0.1:' + server.address().port + '/webhook/tikoder/event', N8N_HEADER_TOKEN: 'test-token', N8N_NOTIFY_SECRET: 'test-secret', PUBLIC_APP_URL: 'http://localhost:3000/app' });
        await notifications.drain(config, Date.now(), [path.basename(queueFile)]);
        assert.ok(received);
        assert.equal(received.headers['x-tikoder-token'], 'test-token');
        assert.equal(received.headers['x-tikoder-signature'], notifications.sign('test-secret', received.headers['x-tikoder-timestamp'], received.body));
        assert.doesNotMatch(received.body, /Private|0912345678|privateuser/);
        assert.equal(JSON.parse(received.body).eventType, 'quote.pending_approval');
        assert.equal(queue.read(uid).notifications[0].status, 'sent');
        assert.throws(() => notifications.configuration({ NOTIFY_ENABLED: 'true', N8N_WEBHOOK_URL: 'http://example.com', N8N_HEADER_TOKEN: 'x', N8N_NOTIFY_SECRET: 'x' }), /HTTPS/);
    } finally {
        if (oldEnabled === undefined) delete process.env.NOTIFY_ENABLED; else process.env.NOTIFY_ENABLED = oldEnabled;
        await new Promise(resolve => server.close(resolve));
        for (const f of [queueFile, customerFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
    }
});
