const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const customers = require('./customerStore');
const ROOT = path.join(__dirname, '..', 'data', 'quote-queue');
function file(uid) { return path.join(ROOT, crypto.createHash('sha256').update(String(uid)).digest('hex') + '.json'); }
function read(uid) {
    const f = file(uid);
    if (!fs.existsSync(f)) return { quotes: [], deliveries: [], notifications: [] };
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(data.quotes) || !Array.isArray(data.deliveries)) throw new Error('Invalid quote data');
    if (!Array.isArray(data.notifications)) data.notifications = [];
    return data;
}
function write(uid, data) {
    fs.mkdirSync(ROOT, { recursive: true });
    writeFile(file(uid), data);
}
function writeFile(target, data) {
    const tmp = target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, target); }
    finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function get(data, id) { const q = data.quotes.find(x => x.id === id); if (!q) fail('Không tìm thấy báo giá', 404); return q; }
function itemsFrom(items) {
    if (!Array.isArray(items) || !items.length || items.length > 500) fail('Danh sách món không hợp lệ');
    return items.map(item => { const amount = Number(item.amount); const label = String(item.label || '').trim().slice(0, 300); if (!label || !Number.isSafeInteger(amount) || amount < 0) fail('Món hoặc số tiền không hợp lệ'); return { label, amount, sourceItemId: String(item.sourceItemId || '').slice(0, 200) }; });
}
function totals(q) { q.subtotal = q.items.reduce((n, i) => n + i.amount, 0); if (!Number.isSafeInteger(q.subtotal)) fail('Tổng tiền không hợp lệ'); q.total = q.subtotal; }
function render(q, customer) { return 'Chào ' + (customer.displayName || customer.tiktokUsername) + ', shop đã ghi nhận đơn của bạn:\n' + q.items.map(i => '- ' + i.label + ': ' + i.amount.toLocaleString('vi-VN') + 'đ').join('\n') + '\nTổng tiền hàng: ' + q.total.toLocaleString('vi-VN') + 'đ (' + q.shippingNote + ').\nBạn kiểm tra và xác nhận thông tin nhận hàng giúp shop nhé.'; }
function create(uid, customer, order) {
    if (!customers.getCustomerById(uid, customer.id)) fail('Không tìm thấy khách hàng', 404);
    const data = read(uid); const items = itemsFrom((order.items || []).map(i => ({label: i.text || i.productName, amount: i.price, sourceItemId: i.id})));
    if (data.quotes.some(q => q.customerId === customer.id && (q.status === 'draft' || (q.status === 'approved' && data.deliveries.some(d => d.quoteId === q.id && ['ready', 'queued', 'sending', 'needs_check'].includes(d.status)))))) fail('Khách đã có báo giá chưa gửi hoặc cần kiểm tra', 409);
    const q = { id: 'qte_' + crypto.randomUUID(), version: 1, customerId: customer.id, status: 'draft', items, shippingNote: order.shippingNote === undefined ? 'chưa gồm phí vận chuyển' : String(order.shippingNote).trim().slice(0, 300), currency: 'VND', createdAt: new Date().toISOString(), createdBy: uid }; totals(q); data.quotes.unshift(q);
    if (process.env.NOTIFY_ENABLED === 'true') {
        data.notifications.push({ eventId: crypto.randomUUID(), eventType: 'quote.pending_approval', occurredAt: q.createdAt, tenantId: crypto.createHash('sha256').update(String(uid)).digest('hex'), summary: { count: 1, label: '1 báo giá chờ duyệt' }, attempts: 0, status: 'queued' });
    }
    write(uid, data); return q;
}
function checkVersion(q, version) {
    if (!Number.isSafeInteger(version) || version !== q.version) fail('Báo giá đã thay đổi. Tải lại trước khi tiếp tục.', 409);
}
function editable(data, id) {
    if (data.deliveries.some(d => d.quoteId === id && ['sending', 'needs_check'].includes(d.status))) fail('Cần kiểm tra kết quả gửi trước khi sửa hoặc xóa', 409);
}
function remove(uid, id, version) {
    const data = read(uid), q = get(data, id);
    checkVersion(q, version); editable(data, id);
    // Keep delivery audit records, but revoke queued work before removing its quote.
    data.deliveries.filter(d => d.quoteId === id && ['ready', 'queued', 'dispatch_failed'].includes(d.status)).forEach(d => { d.status = 'cancelled'; });
    data.quotes = data.quotes.filter(item => item.id !== id);
    write(uid, data); return { success: true };
}
function patch(uid, id, body) {
    const data = read(uid), q = get(data, id);
    checkVersion(q, body.version);
    editable(data, id);
    if (data.quotes.some(other => other.id !== id && other.customerId === q.customerId && (other.status === 'draft' || data.deliveries.some(d => d.quoteId === other.id && ['ready', 'queued', 'sending', 'needs_check'].includes(d.status))))) fail('Khách đã có báo giá chưa gửi hoặc cần kiểm tra', 409);
    const nextItems = itemsFrom(body.items || q.items); const nextNote = body.shippingNote === undefined ? q.shippingNote : String(body.shippingNote).trim().slice(0, 300);
    q.previousVersions = q.previousVersions || [];
    const { previousVersions, ...snapshot } = q;
    previousVersions.push(snapshot);
    q.version++;
    data.deliveries.filter(d => d.quoteId === id && ['ready', 'queued', 'dispatch_failed'].includes(d.status)).forEach(d => { d.status = 'cancelled'; });
    delete q.approvedAt; delete q.approvedBy;
    q.items = nextItems; q.shippingNote = nextNote; q.status = 'draft'; totals(q); write(uid, data); return q;
}
function approve(uid, id, channel, text, autoName, version) {
    const data = read(uid), q = get(data, id);
    checkVersion(q, version); const customer = customers.getCustomerById(uid, q.customerId); if (!customer) fail('Khách hàng không còn tồn tại');
    if (customer.consent?.quoteMessages === 'denied' || customer.consent?.optedOutAt) fail('Khách đã từ chối nhận tin');
    if (!['zalo','tiktok'].includes(channel)) fail('Kênh không hợp lệ');
    if (channel === 'zalo' && !String(customer.contact?.zaloPhone || customer.phone || '').trim()) fail('Khách chưa có số điện thoại Zalo');
    if (channel === 'tiktok' && !customer.tiktokUsername) fail('Khách chưa có tên TikTok');
    const existing = data.deliveries.find(d => d.quoteId === id && d.quoteVersion === q.version && d.channel === channel);
    if (existing) return existing;
    if (q.status !== 'draft') fail('Báo giá không ở trạng thái nháp');
    if (!q.total) fail('Tổng tiền bằng 0');
    const renderedText = String(text || render(q, customer)).trim(); if (!renderedText || renderedText.length > 10000) fail('Nội dung không hợp lệ');
    q.status = 'approved'; q.approvedAt = new Date().toISOString(); q.approvedBy = uid;
    const d = { deliveryId: 'dlv_' + crypto.randomUUID(), idempotencyKey: uid + ':' + id + ':v' + q.version + ':' + channel, quoteId: id, quoteVersion: q.version, channel, status: 'ready', readyAt: q.approvedAt, renderedText, adapter: 'manual' };
    if (autoName !== undefined) {
        const phone = String(customer.contact?.zaloPhone || customer.phone || '').replace(/[\s().-]/g, '');
        const allowed = String(process.env.ZALO_TEST_PHONES || '').split(',').map(x => x.trim()).filter(Boolean);
        const name = String(autoName || '').trim();
        if (process.env.ZALO_WEB_EXPERIMENTAL !== 'true' || channel !== 'zalo' || !allowed.includes(phone) || !name || name.length > 100) fail('Chỉ được gửi tự động tới số thử đã cấu hình và có tên Zalo');
        if (customer.consent?.quoteMessages !== 'granted' || customer.consent?.optedOutAt) fail('Khách chưa đồng ý nhận báo giá');
        d.status = 'queued'; d.adapter = 'zalo_web_experimental'; d.zaloName = name; d.dispatchAttempts = 0; d.eventId = crypto.randomUUID();
    }
    data.deliveries.unshift(d); write(uid, data); return d;
}
function delivery(uid, id, action, reason) {
    const data = read(uid), d = data.deliveries.find(x => x.deliveryId === id); if (!d) fail('Không tìm thấy mục gửi', 404);
    if (d.status === action) return d; if (!['ready', 'needs_check'].includes(d.status) || !['sent','skipped'].includes(action)) fail('Trạng thái không hợp lệ', 409);
    const q = get(data, d.quoteId), customer = customers.getCustomerById(uid, q.customerId);
    if (action === 'sent' && (!customer || customer.consent?.quoteMessages === 'denied' || customer.consent?.optedOutAt)) fail('Khách đã từ chối hoặc không còn tồn tại');
    if (action === 'skipped' && !String(reason || '').trim()) fail('Cần nhập lý do bỏ qua'); d.status = action;
    if (action === 'sent') { d.sentAt = new Date().toISOString(); d.sentBy = uid; } else d.skipReason = String(reason).trim().slice(0, 200); write(uid, data); return d;
}
// Claim is persisted before browser interaction so a crash never causes an automatic retry.
function claimZalo(uid, id, allowedPhones) {
    const data = read(uid), d = data.deliveries.find(item => item.deliveryId === id);
    if (!d) fail('Không tìm thấy mục gửi', 404);
    if (d.status !== 'queued' || d.channel !== 'zalo' || d.adapter !== 'zalo_web_experimental') fail('Mục gửi không sẵn sàng', 409);
    const q = get(data, d.quoteId), c = customers.getCustomerById(uid, q.customerId);
    if (q.status !== 'approved' || q.version !== d.quoteVersion) fail('Phiên bản báo giá đã thay đổi', 409);
    if (!c || c.consent?.quoteMessages !== 'granted' || c.consent?.optedOutAt) fail('Khách chưa đồng ý nhận báo giá');
    const phone = String(c.contact?.zaloPhone || c.phone || '').replace(/[\s().-]/g, '');
    if (!/^\+?\d{9,15}$/.test(phone) || !allowedPhones.includes(phone)) fail('Số điện thoại chưa có trong danh sách thử');
    d.status = 'sending'; d.adapter = 'zalo_web_experimental'; d.startedAt = new Date().toISOString();
    write(uid, data); return { delivery: d, phone };
}
function markZaloNeedsCheck(uid, id) {
    const data = read(uid), d = data.deliveries.find(item => item.deliveryId === id);
    if (!d || d.status !== 'sending' || d.adapter !== 'zalo_web_experimental') fail('Trạng thái không hợp lệ', 409);
    d.status = 'needs_check'; d.updatedAt = new Date().toISOString(); write(uid, data); return d;
}
function findZaloEvent(tenantId, eventId, deliveryId) {
    if (!/^[a-f0-9]{64}$/.test(tenantId || '') || !/^dlv_[0-9a-f-]{36}$/i.test(deliveryId || '')) fail('Sự kiện không hợp lệ');
    const target = path.join(ROOT, tenantId + '.json');
    if (!fs.existsSync(target)) fail('Không tìm thấy yêu cầu', 404);
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    const d = (data.deliveries || []).find(item => item.deliveryId === deliveryId && item.eventId === eventId);
    const q = d && (data.quotes || []).find(item => item.id === d.quoteId);
    if (!q || !q.createdBy || crypto.createHash('sha256').update(String(q.createdBy)).digest('hex') !== tenantId) fail('Không tìm thấy yêu cầu', 404);
    return { uid: q.createdBy, delivery: d, quote: q };
}
function recoverZaloSending() {
    if (!fs.existsSync(ROOT)) return;
    for (const name of fs.readdirSync(ROOT).filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
        const target = path.join(ROOT, name);
        try {
            const data = JSON.parse(fs.readFileSync(target, 'utf8'));
            let changed = false;
            for (const d of data.deliveries || []) if (d.status === 'sending' && d.adapter === 'zalo_web_experimental') { d.status = 'needs_check'; d.updatedAt = new Date().toISOString(); changed = true; }
            if (changed) writeFile(target, data);
        } catch (e) { console.error('Không thể phục hồi hàng chờ Zalo:', e.message); }
    }
}
function cancel(uid, id, version) { const data = read(uid), q = get(data, id); checkVersion(q, version); if (data.deliveries.some(d => d.quoteId === id && ['sending', 'needs_check'].includes(d.status))) fail('Cần kiểm tra kết quả gửi trước khi hủy', 409); if (data.deliveries.some(d => d.quoteId === id && d.quoteVersion === q.version && d.status === 'sent')) fail('Báo giá đã gửi không thể hủy'); q.status = 'cancelled'; q.version++; data.deliveries.filter(d => d.quoteId === id && ['ready', 'queued'].includes(d.status)).forEach(d => { d.status = 'cancelled'; }); write(uid, data); return q; }
module.exports = { read, write, create, patch, approve, delivery, cancel, remove, render, claimZalo, markZaloNeedsCheck, findZaloEvent, recoverZaloSending, ROOT };
