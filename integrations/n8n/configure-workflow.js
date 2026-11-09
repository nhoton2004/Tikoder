'use strict';

// Read a temporary n8n API key from stdin, never from a committed file.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
    const key = fs.readFileSync(0, 'utf8').trim();
    if (!key) throw new Error('Provide a temporary n8n API key through stdin');
    const base = 'http://127.0.0.1:5678';
    const id = 'jzJwwSTD9yUgEgPr';
    async function api(method, route, body) {
        const response = await fetch(base + '/api/v1' + route, {
            method,
            headers: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(`n8n API ${method} ${route}: HTTP ${response.status}: ${error.message || 'Request rejected'}`);
                }
        return response.json();
    }
    const original = await api('GET', '/workflows/' + id);
    assert.equal(original.name, 'Tikoder - Zalo thu nghiem qua n8n');
    const webhook = original.nodes.find(n => n.type === 'n8n-nodes-base.webhook');
    const forward = original.nodes.find(n => n.name === 'HTTP Request');
    assert.equal(webhook?.parameters.path, 'tikoder/event');
    assert.equal(forward?.parameters.url, 'http://127.0.0.1:3000/api/integrations/n8n/verify');
    assert.equal(webhook.parameters.options.rawBody, true);
    assert.equal(forward.parameters.contentType, 'binaryData');
    const allowedNames = new Set([webhook.name, forward.name, 'Respond - Tikoder', 'Respond - Connection Error']);
    assert.ok(original.nodes.every(n => allowedNames.has(n.name)), 'Unexpected nodes; inspect before changing');
    const backup = path.join(os.tmpdir(), `tikoder-n8n-${id}-${Date.now()}.json`);
    // Exclude pinned webhook data: it can contain authentication headers.
    fs.writeFileSync(backup, JSON.stringify({ name: original.name, nodes: original.nodes, connections: original.connections, settings: original.settings }, null, 2), { mode: 0o600, flag: 'wx' });
    console.log('Workflow configuration backup:', backup);

    webhook.parameters.responseMode = 'responseNode';
    forward.parameters.options = {
        ...forward.parameters.options,
        redirect: { redirect: { followRedirects: false } },
        response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
        timeout: 8000,
    };
    forward.onError = 'continueErrorOutput';
    forward.retryOnFail = false;
    const respond = {
        id: 'tikoder-respond-backend', name: 'Respond - Tikoder',
        type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.4, position: [480, -80],
        parameters: { respondWith: 'json', responseBody: '={{ $json.body }}', options: { responseCode: '={{ $json.statusCode }}' } },
    };
    const unavailable = {
        id: 'tikoder-respond-connection-error', name: 'Respond - Connection Error',
        type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.4, position: [480, 160],
        parameters: { respondWith: 'json', responseBody: '{"error":"Tikoder connection failed or timed out; delivery outcome is unknown. Check Tikoder before retrying."}', options: { responseCode: 503 } },
    };
    const body = {
        name: original.name,
        nodes: [webhook, forward, respond, unavailable],
        connections: {
            [webhook.name]: { main: [[{ node: forward.name, type: 'main', index: 0 }]] },
            [forward.name]: { main: [
                [{ node: respond.name, type: 'main', index: 0 }],
                [{ node: unavailable.name, type: 'main', index: 0 }],
            ] },
        },
        // The read API also returns binaryMode/availableInMCP, which the write API rejects.
        settings: Object.fromEntries(Object.entries(original.settings).filter(([name]) => !['binaryMode', 'availableInMCP'].includes(name))),
    };
    const updated = await api('PUT', '/workflows/' + id, body);
    console.log('Saved workflow:', updated.id);
    await api('POST', '/workflows/' + id + '/activate', { versionId: updated.versionId });
    const current = await api('GET', '/workflows/' + id);
    assert.equal(current.active, true);
    assert.equal(current.activeVersionId, updated.versionId);
    assert.equal(current.nodes.length, 4);
    console.log('Published and verified active version:', current.activeVersionId);

    // Deliberately invalid HMAC: verify must reject before any claim or Zalo send.
    const token = original.pinData?.[webhook.name]?.[0]?.json?.headers?.['x-tikoder-token'];
    if (!token) {
        console.log('Webhook test skipped: no existing test authentication available. No credentials were changed.');
        return;
    }
    const eventId = 'workflow-rejection-check-' + Date.now();
    const response = await fetch(base + '/webhook/tikoder/event', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', 'x-tikoder-token': token,
            'x-tikoder-timestamp': String(Math.floor(Date.now() / 1000)),
            'x-tikoder-signature': 'sha256=' + '0'.repeat(64),
            'x-tikoder-event-id': eventId,
        },
        body: JSON.stringify({ eventId, eventType: 'invalid.test' }),
        signal: AbortSignal.timeout(12000),
    });
    const result = await response.json();
    console.log('Production webhook rejection test:', response.status, JSON.stringify(result));
    assert.equal(response.status, 401, 'Expected Tikoder to reject invalid HMAC');
    assert.equal(result.error, 'Xác thực thất bại', 'Expected passthrough from Tikoder, not webhook authentication rejection');
    console.log('PASS: backend rejection is passed through; no valid send event was submitted.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
