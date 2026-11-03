const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const queue = require('./quoteQueue');
const { configuration, sign } = require('./n8nNotifications');

async function drain(config, onlyNames) {
    if (!config || !fs.existsSync(queue.ROOT)) return;
    for (const name of (onlyNames || fs.readdirSync(queue.ROOT)).filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
        let data;
        try { data = JSON.parse(fs.readFileSync(path.join(queue.ROOT, name), 'utf8')); } catch (_) { continue; }
        const events = (data.deliveries || []).filter(d => d.status === 'queued' && d.adapter === 'zalo_web_experimental' && (!d.nextDispatchAt || Date.parse(d.nextDispatchAt) <= Date.now()));
        for (const d of events) {
            const q = data.quotes.find(item => item.id === d.quoteId);
            if (!q || !q.createdBy) continue;
            const tenantId = crypto.createHash('sha256').update(String(q.createdBy)).digest('hex');
            if (name !== tenantId + '.json') continue;
            const body = JSON.stringify({ eventId: d.eventId, eventType: 'quote.send_requested', occurredAt: d.readyAt, tenantId, deliveryId: d.deliveryId });
            const timestamp = String(Math.floor(Date.now() / 1000));
            try {
                await fetch(config.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', 'x-tikoder-timestamp': timestamp, 'x-tikoder-signature': sign(config.secret, timestamp, body), 'x-tikoder-event-id': d.eventId, 'x-tikoder-token': config.token }, body });
            } catch (_) { /* Claim state in Tikoder decides whether retry is safe. */ }
            // Read again: n8n may already have claimed or cancelled the delivery.
            try {
                const current = queue.read(q.createdBy);
                const item = current.deliveries.find(x => x.deliveryId === d.deliveryId && x.eventId === d.eventId);
                if (!item || item.status !== 'queued') continue;
                item.dispatchAttempts = (item.dispatchAttempts || 0) + 1;
                if (item.dispatchAttempts >= 5) item.status = 'dispatch_failed';
                else item.nextDispatchAt = new Date(Date.now() + 30000 * item.dispatchAttempts).toISOString();
                queue.write(q.createdBy, current);
            } catch (e) { console.error('Lỗi cập nhật hàng chờ n8n:', e.message); }
        }
    }
}
function start() {
    if (process.env.ZALO_WEB_EXPERIMENTAL !== 'true') return;
    let config;
    try { config = configuration({ ...process.env, NOTIFY_ENABLED: 'true' }); }
    catch (e) { console.error('Chưa cấu hình n8n cho Zalo:', e.message); return; }
    return require('./intervalWorker').intervalWorker(() => drain(config), 10000, e => console.error('Lỗi điều phối n8n:', e.message));
}
module.exports = { drain, start };
