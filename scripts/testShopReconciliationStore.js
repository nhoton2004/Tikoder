'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ShopReconciliationStore } = require('../utils/shopReconciliationStore');

function withStore(fn, options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-shop-ledger-'));
    const store = new ShopReconciliationStore(path.join(root, 'ledger.sqlite3'), options);
    try { fn(store); } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

test('selects or creates one active named live', () => withStore(store => {
    const first = store.setActiveLive('Live tối thứ sáu');
    const same = store.setActiveLive('Live tối thứ sáu');
    assert.equal(first.id, same.id);
    assert.equal(store.getActiveLive().name, 'Live tối thứ sáu');
    const second = store.setActiveLive('Live chủ nhật');
    assert.notEqual(first.id, second.id);
    assert.equal(store.getActiveLive().id, second.id);
    assert.equal(store.getLiveById(first.id).isActive, false);
}));

test('previews and confirms a live amount once, keeping a Tikoder snapshot', () => withStore(store => {
    const live = store.setActiveLive('Live kiểm thử');
    const prepared = store.prepareRecord({
        username: '@Buyer.One', amount: 200000, snapshot: {
            displayName: 'Buyer One', orderId: 'ORD-9', amount: 150000, orderedAt: 1700000000000, source: 'live_session'
        }
    });
    assert.equal(store.listRecords(live.id).length, 0);
    const record = store.confirmRecord(prepared.confirmationId);
    assert.equal(record.username, 'buyer.one');
    assert.equal(record.manualAmount, 200000);
    assert.equal(record.orderId, 'ORD-9');
    assert.equal(record.orderAmount, 150000);
    assert.equal(record.difference, 50000);
    assert.throws(() => store.confirmRecord(prepared.confirmationId), /hết hạn|đã dùng|không hợp lệ/i);
}));

test('updates a customer row in the same live and writes a revision', () => withStore(store => {
    store.setActiveLive('Live sửa số');
    const first = store.prepareRecord({ username: 'buyer', amount: 100000, snapshot: null });
    const row1 = store.confirmRecord(first.confirmationId);
    const second = store.prepareRecord({ username: '@BUYER', amount: 180000, snapshot: null });
    const row2 = store.confirmRecord(second.confirmationId);
    assert.equal(row1.id, row2.id);
    assert.equal(row2.manualAmount, 180000);
    assert.equal(row2.difference, null);
    assert.equal(store.getRevisions(row2.id).length, 1);
    assert.equal(store.getRevisions(row2.id)[0].oldAmount, 100000);
    assert.equal(store.getRevisions(row2.id)[0].newAmount, 180000);
}));

test('stores missing comparison data as null instead of zero', () => withStore(store => {
    const live = store.setActiveLive('Live chưa có đơn');
    const prepared = store.prepareRecord({ username: 'newbuyer', amount: 70000, snapshot: null });
    const record = store.confirmRecord(prepared.confirmationId);
    assert.equal(record.orderAmount, null);
    assert.equal(record.difference, null);
    assert.equal(record.status, 'no_order');
    assert.equal(store.listRecords(live.id).length, 1);
}));

test('lists saved live sessions by activity with aggregate counts only', () => withStore(store => {
    const first = store.setActiveLive('Live one');
    const entry = store.prepareRecord({ username: 'buyer.one', amount: 200000, snapshot: {
        displayName: 'Buyer One', orderId: 'ORD-1', amount: 150000, orderedAt: 1700000000000, source: 'live_session'
    } });
    store.confirmRecord(entry.confirmationId);
    store.setActiveLive('Live two');
    const lives = store.listLiveSessions();
    assert.equal(lives.length, 2);
    assert.equal(lives[0].name, 'Live two');
    assert.equal(lives[0].isActive, true);
    assert.equal(lives[1].id, first.id);
    assert.equal(lives[1].recordCount, 1);
    assert.equal(lives[1].mismatchCount, 1);
    assert.doesNotMatch(JSON.stringify(lives), /buyer|ORD|150000/);
}));

test('keeps same customer records separate across live sessions', () => withStore(store => {
    const first = store.setActiveLive('Live one');
    store.confirmRecord(store.prepareRecord({ username: 'buyer', amount: 1000, snapshot: null }).confirmationId);
    const second = store.setActiveLive('Live two');
    store.confirmRecord(store.prepareRecord({ username: 'buyer', amount: 2000, snapshot: null }).confirmationId);
    assert.equal(store.listRecords(first.id)[0].manualAmount, 1000);
    assert.equal(store.listRecords(second.id)[0].manualAmount, 2000);
}));
