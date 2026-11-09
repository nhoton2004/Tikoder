// Low-volume owner notifications. The quote and its event are stored atomically
// in the same per-tenant file; customer contact data never enters the event.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT } = require('./quoteQueue');

function configuration(env = process.env) {
    if (env.NOTIFY_ENABLED !== 'true') return null;
    const url = new URL(env.N8N_WEBHOOK_URL || '');
    const internalHttp = env.N8N_INTERNAL_HTTP_ORIGIN && url.origin === env.N8N_INTERNAL_HTTP_ORIGIN;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (internalHttp || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('N8N_WEBHOOK_URL must use HTTPS or explicitly allowed internal HTTP');
    if (!env.N8N_NOTIFY_SECRET || !env.N8N_HEADER_TOKEN) throw new Error('Notification secrets are required');
    const appUrl = new URL(env.PUBLIC_APP_URL || 'http://localhost:3000/app');
    if (!['https:', 'http:'].includes(appUrl.protocol)) throw new Error('Invalid PUBLIC_APP_URL');
    return { url: url.toString(), secret: env.N8N_NOTIFY_SECRET, token: env.N8N_HEADER_TOKEN, appUrl: appUrl.toString() };
}
function sign(secret, timestamp, body) { return 'sha256=' + crypto.createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex'); }
function save(file, data) {
    const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
async function drain(config, now = Date.now(), names = null) {
    if (!config || !fs.existsSync(ROOT)) return;
    for (const name of (names || fs.readdirSync(ROOT)).filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
        const file = path.join(ROOT, name);
        let data;
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { console.error('Notification queue read error:', err.message); continue; }
        const events = (data.notifications || []).filter(e => e.status === 'queued' && (!e.nextAttemptAt || Date.parse(e.nextAttemptAt) <= now)).slice(0, 20);
        for (const event of events) {
            const body = JSON.stringify({ eventId: event.eventId, eventType: event.eventType, occurredAt: event.occurredAt, tenantId: event.tenantId, summary: event.summary, appUrl: config.appUrl });
            const timestamp = String(Math.floor(Date.now() / 1000));
            let result = 'retry';
            try {
                const response = await fetch(config.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json', 'x-tikoder-timestamp': timestamp, 'x-tikoder-signature': sign(config.secret, timestamp, body), 'x-tikoder-event-id': event.eventId, 'x-tikoder-token': config.token }, body });
                result = response.ok ? 'sent' : response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status) ? 'failed' : 'retry';
            } catch (_) { /* network errors are retried */ }
            try {
                // Re-read after the request: quote operations may have changed the file.
                data = JSON.parse(fs.readFileSync(file, 'utf8'));
                const current = (data.notifications || []).find(e => e.eventId === event.eventId);
                if (!current || current.status !== 'queued') continue;
                current.attempts++; current.status = result === 'retry' && current.attempts >= 5 ? 'failed' : result === 'retry' ? 'queued' : result;
                if (current.status === 'queued') current.nextAttemptAt = new Date(Date.now() + Math.min(60000 * 2 ** (current.attempts - 1), 900000)).toISOString();
                else current.finishedAt = new Date().toISOString();
                data.notifications = data.notifications.filter(e => !e.finishedAt || Date.parse(e.finishedAt) > Date.now() - 7 * 86400000);
                save(file, data);
            } catch (err) { console.error('Notification queue update error:', err.message); }
        }
    }
}
function start() {
    let config;
    try { config = configuration(); } catch (err) { console.error('n8n notifications disabled:', err.message); return; }
    if (!config) return;
    return require('./intervalWorker').intervalWorker(() => drain(config), 15000, err => console.error('Notification worker error:', err.message));
}
module.exports = { configuration, sign, drain, start };
