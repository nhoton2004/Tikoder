'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createService } = require('../utils/zaloAutoReplyService');
const { sign } = require('../utils/n8nNotifications');

test('data API authentication binds n8n to one configured tenant', () => {
    const now = 1700000000000;
    const service = createService({
        env: { N8N_DATA_API_SECRET: 'data-secret', N8N_DATA_API_TENANT: 'shop-tenant', N8N_DATA_API_UID: 'shop-1' },
        now: () => now,
        store: { read: () => ({ settings: {}, messages: [] }), readIntegration: () => ({ settings: {}, settingsRevision: 0 }) },
        adapter: { getWatchStatus: () => ({}) },
    });
    const timestamp = String(Math.floor(now / 1000));
    const headers = {
        'x-tikoder-data-tenant': 'shop-tenant',
        'x-tikoder-data-timestamp': timestamp,
        'x-tikoder-data-signature': sign('data-secret', timestamp, 'shop-tenant'),
    };
    assert.equal(service.verifyDataAccess(headers, '127.0.0.1'), 'shop-1');
    assert.throws(() => service.verifyDataAccess({ ...headers, 'x-tikoder-data-tenant': 'other' }, '127.0.0.1'), { status: 401 });
    assert.throws(() => service.verifyDataAccess(headers, '192.168.1.4'), { status: 403 });
    assert.throws(() => service.verifyDataAccess({ ...headers, 'x-tikoder-data-signature': 'sha256=' + '0'.repeat(64) }, '127.0.0.1'), { status: 401 });
});
