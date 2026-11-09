const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const customers = require('../utils/customerStore');
const queue = require('../utils/quoteQueue');

test('quote snapshots, approval idempotency, versioning and tenant isolation', () => {
    const uid = 'test_quote_' + crypto.randomUUID();
    const queueFile = path.join(__dirname, '..', 'data', 'quote-queue', crypto.createHash('sha256').update(uid).digest('hex') + '.json');
    const customerFile = customers.getUserCustomerFile(uid);
    const oldExperiment = process.env.ZALO_WEB_EXPERIMENTAL, oldPhones = process.env.ZALO_TEST_PHONES;
    try {
        const customer = customers.createCustomer(uid, { displayName: 'Khách thử', tiktokUsername: 'testuser', phone: '0900000000' });
        const order = { items: [{ id: 'one', text: 'Món', price: 120000 }] };
        const quote = queue.create(uid, customer, order); order.items[0].price = 1;
        assert.equal(queue.read(uid).quotes[0].total, 120000);
        assert.throws(() => queue.create(uid, customer, order), /chưa gửi/);
        const first = queue.approve(uid, quote.id, 'zalo', undefined, undefined, 1);
        assert.equal(queue.approve(uid, quote.id, 'zalo', undefined, undefined, 1).deliveryId, first.deliveryId);
        assert.throws(() => queue.approve(uid, quote.id, 'tiktok', undefined, undefined, 1), /trạng thái nháp/);
        assert.equal(queue.read(uid + '_other').quotes.length, 0);
        const updated = queue.patch(uid, quote.id, { version: 1, items: [{ label: 'Món mới', amount: 150000 }] });
        assert.equal(updated.version, 2);
        assert.equal(updated.previousVersions[0].total, 120000);
        assert.equal(queue.read(uid).deliveries[0].status, 'cancelled');
        const second = queue.approve(uid, quote.id, 'tiktok', undefined, undefined, 2);
        assert.equal(queue.delivery(uid, second.deliveryId, 'sent').status, 'sent');
        assert.equal(queue.delivery(uid, second.deliveryId, 'sent').status, 'sent');
        assert.throws(() => queue.cancel(uid, quote.id, 2), /đã gửi/);
        customers.setQuoteConsent(uid, customer.id, 'denied');
        customers.updateCustomer(uid, customer.id, { displayName: 'Đã sửa', consent: { quoteMessages: 'granted' } });
        assert.equal(customers.getCustomerById(uid, customer.id).consent.quoteMessages, 'denied');
        assert.ok(customers.getCustomerById(uid, customer.id).consent.optedOutAt);
        queue.patch(uid, quote.id, { version: 2 });
        assert.throws(() => queue.approve(uid, quote.id, 'tiktok', undefined, undefined, 3), /từ chối/);
        customers.setQuoteConsent(uid, customer.id, 'granted');
        assert.equal(customers.getCustomerById(uid, customer.id).consent.optedOutAt, '');
        process.env.ZALO_WEB_EXPERIMENTAL = 'true'; process.env.ZALO_TEST_PHONES = '0900000000';
        const third = queue.approve(uid, quote.id, 'zalo', undefined, 'Khách thử', 3);
        assert.equal(third.status, 'queued');
        const tenantId = crypto.createHash('sha256').update(uid).digest('hex');
        assert.equal(queue.findZaloEvent(tenantId, third.eventId, third.deliveryId).uid, uid);
        assert.throws(() => queue.findZaloEvent(tenantId, 'other', third.deliveryId), /Không tìm thấy/);
        assert.throws(() => queue.claimZalo(uid, third.deliveryId, []), /danh sách thử/);
        assert.equal(queue.claimZalo(uid, third.deliveryId, ['0900000000']).delivery.status, 'sending');
        assert.throws(() => queue.claimZalo(uid, third.deliveryId, ['0900000000']), /không sẵn sàng/);
        assert.equal(queue.markZaloNeedsCheck(uid, third.deliveryId).status, 'needs_check');
        assert.throws(() => queue.claimZalo(uid, third.deliveryId, ['0900000000']), /không sẵn sàng/);
    } finally {
        if (oldExperiment === undefined) delete process.env.ZALO_WEB_EXPERIMENTAL; else process.env.ZALO_WEB_EXPERIMENTAL = oldExperiment;
        if (oldPhones === undefined) delete process.env.ZALO_TEST_PHONES; else process.env.ZALO_TEST_PHONES = oldPhones;
        for (const f of [queueFile, customerFile]) if (fs.existsSync(f)) fs.unlinkSync(f);
    }
});
