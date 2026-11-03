'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../utils/zaloAutoReplyStore');
const { createService } = require('../utils/zaloAutoReplyService');

test('integration data exposes only the configured reply payload, never inbox messages or tenant uid', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-integration-data-'));
    try {
        const store = createStore({ root: path.join(root, 'queue') });
        const service = createService({
            store,
            adapter: { getWatchStatus: () => ({}), isOpen: () => false },
            env: { ZALO_TEST_PHONES: '0900000000' },
            imageRoot: path.join(root, 'images'),
            runtimeRoot: path.join(root, 'runtime'),
        });
        store.saveSettings('shop-1', {
            enabled: true,
            target: { phone: '0900000000', name: 'Shop' },
            rules: { phone: { enabled: true, triggers: ['sdt'], text: '0900000000' } },
        }, ['0900000000']);
        const data = service.integrationData('shop-1');
        assert.deepEqual(Object.keys(data).sort(), ['custom', 'enabled', 'phone', 'qr', 'revision']);
        assert.deepEqual(data.phone, { enabled: true, triggers: ['sdt'], text: '0900000000' });
        assert.deepEqual(data.qr, { enabled: false, triggers: ['qr', 'mã qr', 'qr code', 'quét mã'], caption: '', image: null });
        assert.equal(data.revision, 1);
        assert.doesNotMatch(JSON.stringify(data), /shop-1|messages|target/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
