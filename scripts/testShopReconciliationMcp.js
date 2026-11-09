'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { ShopReconciliationStore } = require('../utils/shopReconciliationStore');
const { createShopReconciliationServer } = require('../scripts/shopReconciliationMcp');

async function withMcp(fn) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tikoder-shop-mcp-'));
    const store = new ShopReconciliationStore(path.join(root, 'ledger.sqlite3'));
    const server = createShopReconciliationServer({
        store,
        userId: 'test-shop',
        lookupCustomer: async username => username === 'buyer.one' ? {
            username: 'buyer.one', displayName: 'Buyer One', phone: 'private', address: 'private',
            latestOrder: { orderId: 'ORD-42', amount: 150000, orderedAt: 1700000000000, source: 'live_session' }
        } : null,
        exportWorkbook: async records => ({ path: path.join(root, 'fake.xlsx'), rowCount: records.length })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'shop-mcp-test', version: '1.0.0' });
    try {
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        await fn({ client, store, root });
    } finally {
        await client.close();
        await server.close();
        store.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function parseResult(result) {
    assert.equal(result.isError, undefined);
    return JSON.parse(result.content[0].text);
}

test('registers only the bounded shop reconciliation tools', async () => withMcp(async ({ client }) => {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name).sort(), [
        'confirm_live_amount', 'export_live_reconciliation', 'get_live_reconciliation',
        'list_live_mismatches', 'list_live_sessions', 'lookup_customer_latest_order', 'prepare_live_amount', 'set_active_live'
    ]);
    assert.ok(tools.tools.every(tool => tool.inputSchema && tool.description));
}));

test('lists live sessions so historical rounds are discoverable without exposing customer rows', async () => withMcp(async ({ client }) => {
    await client.callTool({ name: 'set_active_live', arguments: { name: 'Live older' } });
    const first = parseResult(await client.callTool({ name: 'prepare_live_amount', arguments: { username: 'buyer.one', amount: 200000 } }));
    await client.callTool({ name: 'confirm_live_amount', arguments: { confirmation_id: first.preview.confirmationId } });
    await client.callTool({ name: 'set_active_live', arguments: { name: 'Live newer' } });
    const result = parseResult(await client.callTool({ name: 'list_live_sessions', arguments: {} }));
    assert.equal(result.lives.length, 2);
    assert.equal(result.lives[0].name, 'Live newer');
    assert.equal(result.lives[0].isActive, true);
    assert.equal(result.lives[1].mismatchCount, 1);
    assert.doesNotMatch(JSON.stringify(result), /buyer\.one|ORD-42|150000/);
}));

test('lookup returns minimal customer/order fields and never PII', async () => withMcp(async ({ client }) => {
    const result = parseResult(await client.callTool({ name: 'lookup_customer_latest_order', arguments: { username: '@Buyer.One' } }));
    assert.deepEqual(result, {
        found: true, username: 'buyer.one', displayName: 'Buyer One',
        latestOrder: { orderId: 'ORD-42', amount: 150000, orderedAt: 1700000000000, source: 'live_session' }
    });
    assert.doesNotMatch(JSON.stringify(result), /private|address|phone|userId/);
}));

test('amount proposal is preview-only until explicit confirmation tool call', async () => withMcp(async ({ client, store }) => {
    await client.callTool({ name: 'set_active_live', arguments: { name: 'Live test' } });
    const proposed = parseResult(await client.callTool({ name: 'prepare_live_amount', arguments: { username: '@Buyer.One', amount: 200000 } }));
    assert.equal(proposed.preview.manualAmount, 200000);
    assert.equal(proposed.preview.difference, 50000);
    assert.equal(store.listRecords().length, 0);
    const saved = parseResult(await client.callTool({ name: 'confirm_live_amount', arguments: { confirmation_id: proposed.preview.confirmationId } }));
    assert.equal(saved.record.manualAmount, 200000);
    assert.equal(saved.record.difference, 50000);
    assert.equal(store.listRecords().length, 1);
}));

test('unknown customer can be recorded with explicit no-order status, not zero variance', async () => withMcp(async ({ client }) => {
    await client.callTool({ name: 'set_active_live', arguments: { name: 'Live missing order' } });
    const proposed = parseResult(await client.callTool({ name: 'prepare_live_amount', arguments: { username: 'newbuyer', amount: 70000 } }));
    assert.equal(proposed.preview.snapshot, null);
    const saved = parseResult(await client.callTool({ name: 'confirm_live_amount', arguments: { confirmation_id: proposed.preview.confirmationId } }));
    assert.equal(saved.record.status, 'no_order');
    assert.equal(saved.record.difference, null);
}));

test('returns mismatch list and workbook export through fixed tool arguments', async () => withMcp(async ({ client }) => {
    await client.callTool({ name: 'set_active_live', arguments: { name: 'Live report' } });
    const proposed = parseResult(await client.callTool({ name: 'prepare_live_amount', arguments: { username: 'buyer.one', amount: 220000 } }));
    await client.callTool({ name: 'confirm_live_amount', arguments: { confirmation_id: proposed.preview.confirmationId } });
    const mismatches = parseResult(await client.callTool({ name: 'list_live_mismatches', arguments: {} }));
    assert.equal(mismatches.mismatches.length, 1);
    const exported = parseResult(await client.callTool({ name: 'export_live_reconciliation', arguments: {} }));
    assert.equal(exported.rowCount, 1);
    assert.match(exported.path, /fake\.xlsx$/);
}));
