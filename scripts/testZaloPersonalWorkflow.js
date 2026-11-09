'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const crypto = require('node:crypto');
const workflow = require('../integrations/n8n/zalo-personal-auto-reply.workflow.json');

test('personal workflow uses HTTP Request nodes rather than unavailable Code HTTP helpers', () => {
    const codeNodes = workflow.nodes.filter(node => node.type === 'n8n-nodes-base.code');
    const httpNodes = workflow.nodes.filter(node => node.type === 'n8n-nodes-base.httpRequest');
    assert.ok(codeNodes.length >= 2);
    assert.ok(httpNodes.length >= 2);
    for (const node of codeNodes) {
        assert.doesNotMatch(node.parameters.jsCode, /this\.helpers\.httpRequest|\bfetch\s*\(/);
    }
    const linked = new Set(Object.values(workflow.connections).flatMap(output => output.main.flatMap(branch => branch.map(edge => edge.node))));
    for (const node of httpNodes) {
        assert.ok(linked.has(node.name), `${node.name} is connected`);
        assert.equal(node.onError, 'continueRegularOutput', `${node.name} fails closed via response path`);
    }
    for (const secret of ['sample-event-secret', 'sample-command-secret']) assert.ok(!JSON.stringify(workflow).includes(secret));
});

const env = { ZALO_PERSONAL_EVENT_SECRET: 'sample-event-secret', N8N_DATA_API_SECRET: 'sample-data-secret', N8N_DATA_API_TENANT: 'sample-tenant', ZALO_PERSONAL_COMMAND_SECRET: 'sample-command-secret', TIKODER_DATA_API_URL: 'http://127.0.0.1:3000/data', TIKODER_DATA_API_IMAGE_URL: 'http://127.0.0.1:3000/data/qr', ZALO_PERSONAL_COMMAND_URL: 'http://127.0.0.1:3010/command' };
const sign = (key, ts, bytes) => 'sha256=' + crypto.createHmac('sha256', key).update(ts + '.').update(bytes).digest('hex');
const event = (extra = {}) => ({ eventId: 'evt1', sourceMessageId: 'msg1', threadId: 'thread1', threadType: 0, isSelf: false, text: 'so dien thoai', ...extra });
const config = { enabled: true, phone: { enabled: true, triggers: ['so dien thoai'], text: 'Call us' }, qr: { enabled: true, triggers: ['ma qr'], image: { filename: 'qr.png', mime: 'image/png' }, caption: 'Scan' } };
async function simulate(payload = event(), { signature, raw, configuration = config, state = {}, adapterResult = { status: 'sent' } } = {}) {
    const bytes = raw || Buffer.from(JSON.stringify(payload)), ts = String(Math.floor(Date.now() / 1000));
    const input = { json: { headers: { 'x-adapter-timestamp': ts, 'x-adapter-signature': signature === undefined ? sign(env.ZALO_PERSONAL_EVENT_SECRET, ts, bytes) : signature }, body: payload }, binary: { data: { data: bytes.toString('base64') } } };
    const nodes = new Map(workflow.nodes.map(n => [n.name, n])), outputs = new Map(), calls = [];
    async function visit(name, item, depth = 0) {
        assert.ok(depth < 30, 'graph terminates');
        const node = nodes.get(name); assert.ok(node, `missing ${name}`);
        let result = item, branch = 0;
        if (node.type === 'n8n-nodes-base.code') {
            const context = { $input: { first: () => item }, $env: env, $getWorkflowStaticData: () => state,
                $: n => ({ first: () => outputs.get(n) }), Buffer, Date,
                require: module => { assert.equal(module, 'crypto'); return crypto; },
                helpers: { helpers: { getBinaryDataBuffer: async (_index, key) => Buffer.from(item.binary[key].data, 'base64') } } };
            result = (await vm.runInNewContext(`(async function () { ${node.parameters.jsCode}\n }).call(helpers)`, context, { timeout: 1000 }))[0];
        } else if (node.type === 'n8n-nodes-base.if') {
            const c = node.parameters.conditions.conditions[0]; assert.equal(c.operator.operation, 'equals');
            const key = /^=\{\{ \$json\.(\w+) \}\}$/.exec(c.leftValue)?.[1];
            assert.ok(key, `unsupported IF ${c.leftValue}`);
            branch = item.json[key] === c.rightValue ? 0 : 1;
        } else if (node.type === 'n8n-nodes-base.httpRequest') {
            calls.push(node.name);
            if (/Config/.test(node.name)) result = { json: configuration };
            else if (/QR/.test(node.name)) result = { json: {}, binary: { data: { data: Buffer.from('image').toString('base64') } } };
            else if (/Command/.test(node.name)) {
                const prepared = outputs.get('Prepare Command').json;
                assert.equal(sign(env.ZALO_PERSONAL_COMMAND_SECRET, prepared.commandTimestamp, prepared.commandRaw), prepared.commandSignature);
                const command = JSON.parse(prepared.commandRaw);
                assert.equal(command.action, prepared.rule === 'phone' ? 'send_text' : 'send_image');
                if (prepared.rule === 'qr') assert.equal(command.data, Buffer.from('image').toString('base64'));
                result = { json: { eventId: JSON.parse(prepared.commandRaw).eventId, ...adapterResult } };
            } else assert.fail(`unexpected request ${node.name}`);
        } else if (node.type === 'n8n-nodes-base.respondToWebhook') return { response: result.json, calls, state };
        outputs.set(name, result);
        const edges = workflow.connections[name]?.main?.[branch] || [];
        assert.equal(edges.length, 1, `edge from ${name} branch ${branch}`);
        return visit(edges[0].node, result, depth + 1);
    }
    return visit('Webhook - Zalo Personal Event', input);
}
test('invalid signature and raw body mismatch fail closed without I/O', async () => {
    for (const options of [{ signature: 'sha256=' + '0'.repeat(64) }, { raw: Buffer.from('different bytes') }]) {
        const r = await simulate(event(), options); assert.equal(r.response.status, 'ignored'); assert.deepEqual(r.calls, []);
    }
});
test('phone event loads config, sends signed command; duplicate and cooldown prevent resend', async () => {
    const state = {}, sent = await simulate(event(), { state });
    assert.equal(sent.response.status, 'sent', JSON.stringify(sent)); assert.deepEqual(sent.calls, ['HTTP - Tikoder Config', 'HTTP - Adapter Command']);
    const duplicate = await simulate(event(), { state });
    assert.equal(duplicate.response.status, 'duplicate'); assert.deepEqual(duplicate.calls, []);
    const cooldown = await simulate(event({ eventId: 'evt2', sourceMessageId: 'msg2' }), { state });
    assert.equal(cooldown.response.reason, 'cooldown'); assert.deepEqual(cooldown.calls, ['HTTP - Tikoder Config']);
});
test('QR reads binary and sends signed image command', async () => {
    const r = await simulate(event({ text: 'ma qr' }));
    assert.equal(r.response.status, 'sent'); assert.equal(r.response.rule, 'qr');
    assert.deepEqual(r.calls, ['HTTP - Tikoder Config', 'HTTP - Tikoder QR', 'HTTP - Adapter Command']);
});
test('disabled, unmatched and ambiguous messages never send', async () => {
    for (const [payload, configuration] of [[event(), { ...config, enabled: false }], [event({ text: 'hello' }), config], [event({ text: 'so dien thoai ma qr' }), config]]) {
        const r = await simulate(payload, { configuration });
        assert.equal(r.response.status, 'ignored'); assert.deepEqual(r.calls, ['HTTP - Tikoder Config']);
    }
});
test('raw JSON whitespace is authenticated byte-for-byte without body reserialization', async () => {
    const raw = Buffer.from(JSON.stringify(event(), null, 2));
    const r = await simulate(event(), { raw });
    assert.equal(r.response.status, 'sent');
    assert.deepEqual(r.calls, ['HTTP - Tikoder Config', 'HTTP - Adapter Command']);
});
test('adapter non-sent result is ignored without cooldown', async () => {
    const r = await simulate(event(), { adapterResult: { status: 'pending' } });
    assert.equal(r.response.status, 'ignored');
    assert.deepEqual(r.calls, ['HTTP - Tikoder Config', 'HTTP - Adapter Command']);
    assert.equal(Object.keys(r.state.cooldown).length, 0);
});
test('HTTP nodes send signed raw JSON and retrieve QR as binary with authenticated headers', () => {
    const byName = name => workflow.nodes.find(n => n.name === name).parameters;
    const configRequest = byName('HTTP - Tikoder Config');
    const qrRequest = byName('HTTP - Tikoder QR');
    const command = byName('HTTP - Adapter Command');
    for (const p of [configRequest, qrRequest]) {
        assert.deepEqual(p.headerParameters.parameters.map(h => h.name), ['x-tikoder-data-tenant', 'x-tikoder-data-timestamp', 'x-tikoder-data-signature']);
        assert.equal(p.method, 'GET');
    }
    assert.equal(qrRequest.options.response.response.responseFormat, 'file');
    assert.equal(qrRequest.options.response.response.outputPropertyName, 'data');
    assert.equal(command.method, 'POST'); assert.equal(command.contentType, 'raw');
    assert.equal(command.body, '={{ $json.commandRaw }}');
    assert.equal(command.rawContentType, 'application/json');
    assert.deepEqual(command.headerParameters.parameters.map(h => h.name), ['content-type', 'x-adapter-timestamp', 'x-adapter-signature']);
});
