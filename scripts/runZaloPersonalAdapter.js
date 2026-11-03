'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Zalo } = require('zca-js');
const { sign } = require('../utils/n8nNotifications');
const { createAdapter } = require('../utils/zaloPersonalAdapter');
const { createAdapterServer } = require('../utils/zaloPersonalAdapterServer');

const credentialsFile = process.env.ZALO_PERSONAL_CREDENTIALS_FILE || path.join(__dirname, '..', 'data', 'zalo-personal', 'credentials.json');
const qrPath = process.env.ZALO_PERSONAL_QR_PATH || path.join(path.dirname(credentialsFile), 'login-qr.png');
const eventUrl = process.env.ZALO_PERSONAL_EVENT_URL || 'http://127.0.0.1:5678/webhook/tikoder/zalo-personal-event';
const eventSecret = process.env.ZALO_PERSONAL_EVENT_SECRET;
const commandSecret = process.env.ZALO_PERSONAL_COMMAND_SECRET;
const commandPort = Number(process.env.ZALO_PERSONAL_ADAPTER_PORT || 3010);
const stateFile = process.env.ZALO_PERSONAL_STATE_FILE || path.join(path.dirname(credentialsFile), 'command-state.json');

function loadCredentials() {
    if (!fs.existsSync(credentialsFile)) return null;
    return JSON.parse(fs.readFileSync(credentialsFile, 'utf8'));
}
function saveCredentials(credentials) {
    fs.mkdirSync(path.dirname(credentialsFile), { recursive: true });
    fs.writeFileSync(credentialsFile, JSON.stringify(credentials), { encoding: 'utf8', mode: 0o600, flag: 'w' });
}
function loadCommandState() {
    try {
        const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        return { seen: new Set(Array.isArray(data.seen) ? data.seen : []), results: new Map(Object.entries(data.results || {})) };
    } catch (_) { return { seen: new Set(), results: new Map() }; }
}
function saveCommandState(state) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ seen: [...state.seen].slice(-2000), results: Object.fromEntries([...state.results.entries()].slice(-2000)) }), { encoding: 'utf8', mode: 0o600, flag: 'w' });
}
async function login() {
    const zalo = new Zalo({ logging: false });
    const credentials = loadCredentials();
    if (credentials) return { zalo, api: await zalo.login(credentials) };
    if (process.env.ZALO_PERSONAL_ALLOW_QR_LOGIN !== 'true') throw new Error('Thiếu credentials; đặt ZALO_PERSONAL_ALLOW_QR_LOGIN=true rồi chạy lại để đăng nhập QR');
    fs.mkdirSync(path.dirname(qrPath), { recursive: true });
    const api = await zalo.loginQR({ qrPath }, async event => {
        if (event.type === 0) {
            if (event.actions && typeof event.actions.saveToFile === 'function') {
                await event.actions.saveToFile(qrPath);
            }
            console.log('Đã tạo QR đăng nhập tại:', qrPath);
        }
        if (event.type === 4) saveCredentials({ cookie: event.data.cookie, imei: event.data.imei, userAgent: event.data.userAgent });
    });
    return { zalo, api };
}
async function main() {
    if (!eventSecret || !commandSecret) throw new Error('Cần ZALO_PERSONAL_EVENT_SECRET và ZALO_PERSONAL_COMMAND_SECRET');
    const { api } = await login();
    const commandState = loadCommandState();
    const adapter = createAdapter({
        client: api,
        seen: commandState.seen,
        results: commandState.results,
        onCommandResult: () => saveCommandState(commandState),
        postEvent: async event => {
            const body = { eventId: crypto.createHash('sha256').update(event.sourceMessageId).digest('hex'), ...event };
            const raw = JSON.stringify(body), timestamp = String(Math.floor(Date.now() / 1000));
            const response = await fetch(eventUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', 'x-adapter-timestamp': timestamp, 'x-adapter-signature': sign(eventSecret, timestamp, raw), 'x-adapter-event-id': body.eventId }, body: raw });
            if (!response.ok) throw new Error('n8n event webhook returned HTTP ' + response.status);
        },
    });
    api.listener.on('message', message => adapter.handleMessage(message).catch(() => {}));
    api.listener.on('error', () => {});
    api.listener.start({ retryOnClose: true });
    const host = process.env.ZALO_PERSONAL_ADAPTER_HOST || '127.0.0.1';
    const server = createAdapterServer({ adapter, secret: commandSecret, host, port: commandPort });
    await server.listen();
    console.log('Zalo personal adapter listening on ' + host + ':' + commandPort);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
