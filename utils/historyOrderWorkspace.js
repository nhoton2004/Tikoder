const crypto = require('crypto');
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function revision(orders) { return crypto.createHash('sha256').update(JSON.stringify(orders)).digest('hex'); }
function checkVersion(orders, expected) {
    if (typeof expected !== 'string' || expected !== revision(orders)) fail('Lịch sử đã thay đổi. Tải lại lịch sử trước khi tiếp tục.', 409);
}
function mutate(orders, body, normalizeUsername) {
    checkVersion(orders, body.revision);
    const username = normalizeUsername(body.username);
    if (!username || ['__proto__', 'constructor', 'prototype'].includes(username)) fail('Tên khách không hợp lệ');
    const next = orders.map(order => ({ ...order }));
    const matches = order => normalizeUsername(order.customerUsername) === username;
    if (body.action === 'delete-customer') {
        if (!next.some(matches)) fail('Không tìm thấy khách', 404);
        return next.filter(order => !matches(order));
    }
    if (body.action === 'add') {
        const existing = next.find(matches);
        next.push({ id: 'order_' + crypto.randomUUID(), customerUsername: username,
            customerName: existing?.customerName || username, profilePictureUrl: existing?.profilePictureUrl || '',
            productName: label(body.text), price: amount(body.price), total: amount(body.price), quantity: 1,
            createdAt: new Date().toISOString(), time: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) });
        return next;
    }
    const index = next.findIndex(order => matches(order) && String(order.id) === String(body.itemId));
    if (index < 0) fail('Không tìm thấy món', 404);
    if (body.action === 'delete') next.splice(index, 1);
    else if (body.action === 'edit') Object.assign(next[index], { productName: label(body.text), price: amount(body.price), total: amount(body.price), quantity: 1 });
    else fail('Thao tác không hợp lệ');
    return next;
}
function label(value) { const text = String(value || '').trim(); if (!text || text.length > 300) fail('Tên món không hợp lệ'); return text; }
function amount(value) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) fail('Số tiền không hợp lệ'); return number; }
module.exports = { revision, checkVersion, mutate, fail };
