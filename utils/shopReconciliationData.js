'use strict';

const fs = require('node:fs');
const path = require('node:path');
const customerStore = require('./customerStore');
const liveSessionStore = require('./liveSessionStore');

const SOURCE_PRIORITY = Object.freeze({ current_live: 0, live_session: 1, legacy_history: 2 });

function normalizeTikTokUsername(value) {
    return String(value || '').normalize('NFKC').trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
}

function timestampValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
    }
    return 0;
}

function selectLatestOrder(username, orders) {
    const target = normalizeTikTokUsername(username);
    if (!target || !Array.isArray(orders)) return null;
    const matches = orders.map(order => {
        const orderId = String(order?.orderId || order?.id || '').trim();
        const amount = Number(order?.amount ?? order?.total ?? order?.price);
        const orderedAt = timestampValue(order?.orderedAt ?? order?.timestamp ?? order?.createdAt);
        if (normalizeTikTokUsername(order?.customerUsername ?? order?.username) !== target || !orderId || !Number.isFinite(amount) || amount <= 0) return null;
        return {
            username: target,
            orderId,
            amount,
            orderedAt,
            source: Object.hasOwn(SOURCE_PRIORITY, order?.source) ? order.source : 'legacy_history'
        };
    }).filter(Boolean);
    matches.sort((left, right) =>
        right.orderedAt - left.orderedAt ||
        SOURCE_PRIORITY[left.source] - SOURCE_PRIORITY[right.source] ||
        right.orderId.localeCompare(left.orderId, 'en')
    );
    return matches[0] || null;
}

function buildCustomerOrderSnapshot({ customer, order } = {}) {
    if (!customer) return null;
    const username = normalizeTikTokUsername(customer.tiktokUsername || order?.username);
    if (!username) return null;
    const orderId = String(order?.orderId || '').trim();
    const amount = Number(order?.amount);
    const latestOrder = orderId && Number.isFinite(amount) && amount > 0 ? {
        orderId,
        amount,
        orderedAt: timestampValue(order.orderedAt),
        source: String(order.source || 'legacy_history')
    } : null;
    return {
        username,
        displayName: String(customer.displayName || '').trim() || `@${username}`,
        latestOrder
    };
}

function historyTimestamp(datePart, timePart) {
    const date = String(datePart || '').match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
    if (!date) return timestampValue(timePart);
    const time = /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(timePart || ''))
        ? (String(timePart).length === 5 ? `${timePart}:00` : timePart)
        : '00:00:00';
    const parsed = Date.parse(`${date}T${time}+07:00`);
    return Number.isFinite(parsed) ? parsed : 0;
}

function collectUserOrders(userId, options = {}) {
    const sessions = (options.readUserSessions || liveSessionStore.readUserSessions)(userId);
    const records = [];
    for (const session of sessions || []) {
        for (const order of Array.isArray(session.orders) ? session.orders : []) {
            records.push({
                customerUsername: order.customerUsername || order.tiktokUsername,
                orderId: order.id,
                amount: order.total || order.price,
                orderedAt: order.createdAt || order.time || session.createdAt || session.startedAt,
                source: 'live_session'
            });
        }
    }

    const customerFile = (options.getUserCustomerFile || customerStore.getUserCustomerFile)(userId);
    const safeUserId = path.basename(customerFile, '.json');
    const historyDir = path.join(options.historyRoot || path.join(__dirname, '..', 'history'), safeUserId);
    if (fs.existsSync(historyDir)) {
        for (const fileName of fs.readdirSync(historyDir).filter(name => name.endsWith('.json'))) {
            const fileDate = fileName.match(/^(\d{4}-\d{2}-\d{2})_/)?.[1] || '';
            const parsed = JSON.parse(fs.readFileSync(path.join(historyDir, fileName), 'utf8'));
            for (const customer of Object.values(parsed || {})) {
                const username = customer.username || customer.tiktokUsername;
                for (const item of Array.isArray(customer.items) ? customer.items : []) {
                    records.push({
                        customerUsername: username,
                        orderId: item.id,
                        amount: item.total || item.price,
                        orderedAt: historyTimestamp(fileDate, item.time),
                        source: 'legacy_history'
                    });
                }
            }
        }
    }
    return records;
}

function findCustomerLatestOrder(userId, username, options = {}) {
    const normalized = normalizeTikTokUsername(username);
    if (!normalized) return null;
    const customer = (options.findCustomerByTikTok || customerStore.findCustomerByTikTok)(userId, normalized);
    if (!customer) return null;
    const orders = (options.collectUserOrders || collectUserOrders)(userId, options);
    const order = selectLatestOrder(normalized, orders);
    return buildCustomerOrderSnapshot({ customer, order });
}

module.exports = {
    normalizeTikTokUsername,
    selectLatestOrder,
    buildCustomerOrderSnapshot,
    collectUserOrders,
    findCustomerLatestOrder
};
