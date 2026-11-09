'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeTikTokUsername, selectLatestOrder, buildCustomerOrderSnapshot, findCustomerLatestOrder } = require('../utils/shopReconciliationData');

test('normalizes TikTok usernames consistently', () => {
    assert.equal(normalizeTikTokUsername(' @Buyer.One '), 'buyer.one');
    assert.equal(normalizeTikTokUsername('@@BUYER_TWO'), 'buyer_two');
    assert.equal(normalizeTikTokUsername('   '), '');
});

test('selects the newest order for the exact normalized username', () => {
    const order = selectLatestOrder('@buyer.one', [
        { customerUsername: 'buyer.one', orderId: 'old', total: 200000, timestamp: 1000, source: 'legacy_history' },
        { customerUsername: '@BUYER.ONE', orderId: 'new', total: 150000, timestamp: 2000, source: 'live_session' },
        { customerUsername: 'buyer.two', orderId: 'other', total: 990000, timestamp: 3000, source: 'current_live' }
    ]);
    assert.deepEqual(order, {
        username: 'buyer.one', orderId: 'new', amount: 150000,
        orderedAt: 2000, source: 'live_session'
    });
});

test('uses deterministic source priority for equal timestamps', () => {
    const order = selectLatestOrder('buyer.one', [
        { customerUsername: 'buyer.one', orderId: 'legacy', total: 10, timestamp: 2000, source: 'legacy_history' },
        { customerUsername: 'buyer.one', orderId: 'current', total: 20, timestamp: 2000, source: 'current_live' }
    ]);
    assert.equal(order.orderId, 'current');
});

test('snapshot exposes only customer name and latest-order allowlist, not phone/address', () => {
    const result = buildCustomerOrderSnapshot({
        customer: {
            tiktokUsername: 'buyer.one', displayName: 'Buyer One', phone: '0900000000', addressDetail: 'Private address'
        },
        order: { username: 'buyer.one', orderId: 'order-1', amount: 200000, orderedAt: 1234, source: 'live_session', secret: 'nope' }
    });
    assert.deepEqual(result, {
        username: 'buyer.one', displayName: 'Buyer One',
        latestOrder: { orderId: 'order-1', amount: 200000, orderedAt: 1234, source: 'live_session' }
    });
    assert.doesNotMatch(JSON.stringify(result), /0900000000|Private address|secret/);
});

test('finds the newest order across saved live sessions and legacy history without leaking profile PII', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-shop-lookup-'));
    try {
        const historyRoot = path.join(root, 'history');
        const historyDir = path.join(historyRoot, 'shop-user');
        fs.mkdirSync(historyDir, { recursive: true });
        fs.writeFileSync(path.join(historyDir, '2026-10-28_shop.json'), JSON.stringify({
            buyer: { username: '@BUYER.ONE', nickname: 'Buyer One', items: [{ id: 'legacy-newest', price: 300000, time: '13:05' }] }
        }));
        const customerFile = path.join(root, 'data', 'customers', 'shop-user.json');
        const snapshot = findCustomerLatestOrder('shop-user', 'buyer.one', {
            historyRoot,
            getUserCustomerFile: () => customerFile,
            findCustomerByTikTok: () => ({ tiktokUsername: 'buyer.one', displayName: 'Buyer One', phone: 'private', addressDetail: 'private' }),
            readUserSessions: () => [{ createdAt: '2026-10-27T10:00:00Z', orders: [
                { id: 'saved-older', customerUsername: 'buyer.one', total: 200000, createdAt: '2026-10-27T10:00:00Z' }
            ] }]
        });
        assert.equal(snapshot.username, 'buyer.one');
        assert.equal(snapshot.latestOrder.orderId, 'legacy-newest');
        assert.equal(snapshot.latestOrder.amount, 300000);
        assert.equal(snapshot.latestOrder.source, 'legacy_history');
        assert.doesNotMatch(JSON.stringify(snapshot), /private|phone|address/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('returns null when there is no exact username match or usable order', () => {
    assert.equal(selectLatestOrder('buyer.one', [{ customerUsername: 'buyer.one2', orderId: 'x', total: 1, timestamp: 1 }]), null);
    assert.equal(selectLatestOrder('buyer.one', [{ customerUsername: 'buyer.one', orderId: '', total: 0, timestamp: 1 }]), null);
});
