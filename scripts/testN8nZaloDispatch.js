const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const customers = require('../utils/customerStore');
const queue = require('../utils/quoteQueue');
const dispatch = require('../utils/n8nZaloDispatch');
const { sign } = require('../utils/n8nNotifications');

test('n8n dispatch contains only identifiers and claims the delivery once', async () => {
    const uid = 'zalo_dispatch_' + crypto.randomUUID();
    const tenantId = crypto.createHash('sha256').update(uid).digest('hex');
    const queueFile = path.join(queue.ROOT, tenantId + '.json');
    const customerFile = customers.getUserCustomerFile(uid);
    const oldExperiment = process.env.ZALO_WEB_EXPERIMENTAL, oldPhones = process.env.ZALO_TEST_PHONES;
    let requests = 0;
    const server = http.createServer((req, res) => {
        let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
            try {
                requests++;
                assert.equal(req.headers['x-tikoder-signature'], sign('secret', req.headers['x-tikoder-timestamp'], body));
                assert.doesNotMatch(body, /0900000000|Private item|Khách thử/);
                const event = JSON.parse(body);
                const entry = queue.findZaloEvent(event.tenantId, event.eventId, event.deliveryId);
                queue.claimZalo(entry.uid, event.deliveryId, ['0900000000']);
                queue.markZaloNeedsCheck(entry.uid, event.deliveryId);
                res.writeHead(202); res.end();
            } catch (e) { res.writeHead(500); res.end(e.message); }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        process.env.ZALO_WEB_EXPERIMENTAL = 'true'; process.env.ZALO_TEST_PHONES = '0900000000';
        const customer = customers.createCustomer(uid, { displayName: 'Khách thử', tiktokUsername: 'test', phone: '0900000000' });
        customers.setQuoteConsent(uid, customer.id, 'granted');
        const q = queue.create(uid, customer, { items: [{ text: 'Private item', price: 100 }] });
        const d = queue.approve(uid, q.id, 'zalo', undefined, 'Khách thử', q.version);
        const config = { url: 'http://127.0.0.1:' + server.address().port, secret: 'secret', token: 'token' };
        await dispatch.drain(config, [path.basename(queueFile)]);
        assert.equal(queue.read(uid).deliveries.find(x => x.deliveryId === d.deliveryId).status, 'needs_check');
        await dispatch.drain(config, [path.basename(queueFile)]);
        assert.equal(requests, 1);
    } finally {
        if (oldExperiment === undefined) delete process.env.ZALO_WEB_EXPERIMENTAL; else process.env.ZALO_WEB_EXPERIMENTAL = oldExperiment;
        if (oldPhones === undefined) delete process.env.ZALO_TEST_PHONES; else process.env.ZALO_TEST_PHONES = oldPhones;
        await new Promise(resolve => server.close(resolve));
        for (const f of [queueFile, customerFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
    }
});
