'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const BASE = 'http://127.0.0.1:5678';
const QUOTE_ID = 'jzJwwSTD9yUgEgPr';
const NAME = 'TikTokOrder - Zalo auto reply';

async function main() {
    const args = process.argv.slice(2);
    assert.ok(args.every(arg => arg === '--test-invalid-signature'), 'Only --test-invalid-signature is supported');
    const key = fs.readFileSync(0, 'utf8').trim();
    assert.ok(key, 'Provide a temporary n8n API key through stdin (end with EOF)');
    async function api(method, route, body) {
        const response = await fetch(BASE + '/api/v1' + route, {
            method,
            headers: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
        });
        // Never print response bodies: API errors and workflow data may contain secrets.
        if (!response.ok) throw new Error(`n8n API ${method} ${route}: HTTP ${response.status}`);
        return response.json();
    }
    const desired = JSON.parse(fs.readFileSync(path.join(__dirname, 'zalo-auto-reply.workflow.json'), 'utf8'));
    assert.equal(desired.name, NAME);
    assert.deepEqual(desired.settings, { executionOrder: 'v1' });
    assert.deepEqual(Object.keys(desired).sort(), ['connections', 'name', 'nodes', 'settings']);
    assert.ok(!desired.nodes.some(node => node.credentials), 'Export must not contain credential references');

    const matches = [];
    const cursors = new Set();
    let cursor;
    do {
        const page = await api('GET', '/workflows?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
        assert.ok(Array.isArray(page.data), 'Invalid workflow list');
        matches.push(...page.data.filter(workflow => workflow.name === NAME));
        assert.ok(matches.length <= 1, 'Multiple workflows have the target name; refusing to write');
        cursor = page.nextCursor;
        if (cursor) {
            assert.ok(!cursors.has(cursor), 'Repeated pagination cursor; refusing to write');
            cursors.add(cursor);
        }
    } while (cursor);
    assert.notEqual(matches[0]?.id, QUOTE_ID, 'Quote workflow is protected');

    // Read only. Never update, activate, deactivate, or execute the quote workflow.
    const original = await api('GET', '/workflows/' + QUOTE_ID);
    assert.equal(original.active, true, 'Expected the protected quote workflow to remain active');
    const webhooks = original.nodes.filter(node => node.type === 'n8n-nodes-base.webhook'
        && node.parameters?.path === 'tikoder/event' && node.parameters.authentication === 'headerAuth');
    assert.equal(webhooks.length, 1, 'Expected one quote HeaderAuth webhook');
    const reference = webhooks[0].credentials?.httpHeaderAuth;
    assert.ok(typeof reference?.id === 'string' && reference.id, 'Quote webhook lacks a HeaderAuth credential reference');
    const webhook = desired.nodes.find(node => node.type === 'n8n-nodes-base.webhook');
    assert.ok(webhook && desired.nodes.filter(node => node.type === 'n8n-nodes-base.webhook').length === 1, 'Expected one target webhook');
    webhook.credentials = { httpHeaderAuth: { id: reference.id, ...(reference.name ? { name: reference.name } : {}) } };

    let target;
    if (matches.length) {
        target = await api('GET', '/workflows/' + encodeURIComponent(matches[0].id));
        assert.equal(target.name, NAME, 'Target name changed; refusing to write');
        assert.notEqual(target.id, QUOTE_ID, 'Quote workflow is protected');
        // Select configuration fields explicitly. Never persist pinData or API response bodies.
        const backup = path.join(os.tmpdir(), `tikoder-auto-reply-${Date.now()}-${require('node:crypto').randomUUID()}.json`);
        fs.writeFileSync(backup, JSON.stringify({
            id: target.id, name: target.name, active: target.active,
            versionId: target.versionId, activeVersionId: target.activeVersionId,
            nodes: target.nodes, connections: target.connections, settings: target.settings,
        }, null, 2), { mode: 0o600, flag: 'wx' });
        console.log('Target configuration backup (no pinData):', backup);
    }
    // Write only supported settings, never copy read-only binaryMode/availableInMCP.
    const writable = { name: desired.name, nodes: desired.nodes, connections: desired.connections, settings: { executionOrder: 'v1' } };
    const saved = target
        ? await api('PUT', '/workflows/' + encodeURIComponent(target.id), writable)
        : await api('POST', '/workflows', writable);
    assert.ok(typeof saved.id === 'string' && saved.id !== QUOTE_ID, 'Invalid target workflow ID');
    assert.ok(typeof saved.versionId === 'string' && saved.versionId, 'Saved workflow lacks a versionId');
    const route = '/workflows/' + encodeURIComponent(saved.id);
    // Updating an active workflow needs explicit publication of the newly saved version.
    // No deactivation gap and no workflow execution request.
    await api('POST', route + '/activate', { versionId: saved.versionId });
    const current = await api('GET', route);
    assert.equal(current.active, true, 'Target is not active');
    assert.equal(current.activeVersionId, saved.versionId, 'Saved version is not the active version');
    // Compare without assertion diffs, which could expose stored workflow data.
    const same = (a, b) => { try { assert.deepEqual(a, b); return true; } catch (_) { return false; } };
    assert.equal(current.name, NAME);
    assert.ok(same(current.connections, desired.connections), 'Target connections differ from export');
    assert.equal(current.settings?.executionOrder, 'v1');
    assert.equal(current.nodes.length, desired.nodes.length, 'Target node count differs');
    for (const expected of desired.nodes) {
        const actual = current.nodes.find(node => node.id === expected.id);
        assert.ok(actual, 'Target node missing');
        for (const field of Object.keys(expected)) {
            assert.ok(same(actual[field], expected[field]), `Target node ${expected.name}: ${field} differs`);
        }
    }
    const quoteAfter = await api('GET', '/workflows/' + QUOTE_ID);
    assert.ok(quoteAfter.active === true && quoteAfter.versionId === original.versionId
        && quoteAfter.activeVersionId === original.activeVersionId, 'Protected quote workflow changed during installation');
    console.log('Auto-reply workflow installed; saved version is active. Quote workflow remains active and unchanged.');

    if (!args.includes('--test-invalid-signature')) {
        console.log('Rejection test skipped (opt in with --test-invalid-signature). No event submitted.');
        return;
    }
    // Authentication token is read only in memory, never written or logged.
    const headers = original.pinData?.[webhooks[0].name]?.[0]?.json?.headers;
    const token = headers && Object.entries(headers).find(([name]) => name.toLowerCase() === 'x-tikoder-token')?.[1];
    if (typeof token !== 'string' || !token) {
        console.log('Rejection test skipped: no pinned test token available.');
        return;
    }
    const eventId = 'auto-reply-invalid-' + require('node:crypto').randomUUID();
    const response = await fetch(BASE + '/webhook/tikoder/zalo-auto-reply', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', 'x-tikoder-token': token,
            'x-tikoder-timestamp': String(Math.floor(Date.now() / 1000)),
            'x-tikoder-signature': 'sha256=' + '0'.repeat(64),
            'x-tikoder-event-id': eventId,
        },
        body: JSON.stringify({ eventId, eventType: 'invalid.test' }),
        redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => null);
    if (response.status === 401 && result?.error === 'Xác thực thất bại') {
        console.log('PASS: new Tikoder route rejected invalid signature with HTTP 401. No valid event submitted.');
    } else if (response.status === 404) {
        console.log('PENDING: HTTP 404. Restart Tikoder to load backend routes, verify webhook publication, then rerun the optional rejection check. Installation remains complete.');
    } else {
        throw new Error(`Rejection check unverified (HTTP ${response.status}); expected app HTTP 401. Installation is saved; inspect locally without sharing headers or bodies.`);
    }
}

main().catch(error => {
    // Do not log raw fetch errors/assertion objects or any response body.
    console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : (error.name === 'Error' ? error.message : 'Installation failed; check local n8n connectivity/configuration.'));
    process.exitCode = 1;
});
