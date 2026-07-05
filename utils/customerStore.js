/**
 * Customer Store — per-user SQLite storage.
 * API tương thích ngược với JSON file version.
 */

const { getDb } = require('./db');
const { cleanDisplayText, normalizeDisplayText, normalizeTextForDisplay } = require('./displayName');

const CUSTOMER_FIELDS = [
    'tiktokUsername', 'displayName', 'phone', 'province', 'district', 'ward',
    'addressDetail', 'addressNote', 'postalCode', 'customerCode', 'deliveryNote',
    'defaultWeightKg', 'allowTryOn', 'viewOnlyNoTry', 'partialDelivery'
];

const SNAKE_TO_CAMEL = {
    tiktok_username: 'tiktokUsername', display_name: 'displayName', phone: 'phone',
    province: 'province', district: 'district', ward: 'ward',
    address_detail: 'addressDetail', address_note: 'addressNote',
    postal_code: 'postalCode', customer_code: 'customerCode',
    delivery_note: 'deliveryNote', default_weight_kg: 'defaultWeightKg',
    allow_try_on: 'allowTryOn', view_only_no_try: 'viewOnlyNoTry',
    partial_delivery: 'partialDelivery', id: 'id', user_id: 'userId',
    created_at: 'createdAt', updated_at: 'updatedAt'
};

function rowToCustomer(row) {
    if (!row) return null;
    const c = {};
    for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL)) {
        c[camel] = row[snake] !== undefined ? row[snake] : '';
    }
    c.displayName = cleanDisplayText(c.displayName);
    c.tiktokUsername = normalizeTikTokUsername(c.tiktokUsername);
    return c;
}

function normalizeTikTokUsername(username) {
    return normalizeDisplayText(username).replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
}

function listCustomers(userId, query = '') {
    const q = normalizeTextForDisplay(query).toLowerCase();
    if (!q) {
        return getDb().prepare('SELECT * FROM customers WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(rowToCustomer);
    }
    const like = `%${q}%`;
    return getDb().prepare(
        'SELECT * FROM customers WHERE user_id = ? AND (LOWER(display_name) LIKE ? OR LOWER(tiktok_username) LIKE ? OR LOWER(phone) LIKE ?) ORDER BY created_at DESC'
    ).all(userId, like, like, like).map(rowToCustomer);
}

function getCustomerById(userId, customerId) {
    return rowToCustomer(getDb().prepare('SELECT * FROM customers WHERE id = ? AND user_id = ?').get(customerId, userId));
}

function findCustomerByTikTok(userId, tiktokUsername) {
    const normalized = normalizeTikTokUsername(tiktokUsername);
    if (!normalized) return null;
    return rowToCustomer(getDb().prepare('SELECT * FROM customers WHERE user_id = ? AND LOWER(tiktok_username) = ?').get(userId, normalized));
}

function readUserCustomers(userId) {
    return getDb().prepare('SELECT * FROM customers WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(rowToCustomer);
}

function writeUserCustomers(userId, customers) {
    const db = getDb();
    db.prepare('DELETE FROM customers WHERE user_id = ?').run(userId);
    const stmt = db.prepare(`
        INSERT INTO customers (id, user_id, tiktok_username, display_name, phone, province, district, ward, address_detail, address_note, postal_code, customer_code, delivery_note, default_weight_kg, allow_try_on, view_only_no_try, partial_delivery, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAll = db.transaction((items) => {
        for (const c of items) {
            stmt.run(
                c.id || `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                userId,
                c.tiktokUsername || '',
                c.displayName || '',
                c.phone || '', c.province || '', c.district || '', c.ward || '',
                c.addressDetail || '', c.addressNote || '', c.postalCode || '',
                c.customerCode || '', c.deliveryNote || '', c.defaultWeightKg || '',
                c.allowTryOn || '', c.viewOnlyNoTry || '', c.partialDelivery || '',
                c.createdAt || new Date().toISOString(),
                c.updatedAt || new Date().toISOString()
            );
        }
    });
    insertAll(customers);
}

function pickCustomerFields(data) {
    return CUSTOMER_FIELDS.reduce((result, field) => {
        if (Object.prototype.hasOwnProperty.call(data || {}, field)) {
            if (field === 'displayName') {
                result[field] = cleanDisplayText(data[field]);
            } else if (field === 'tiktokUsername') {
                result[field] = normalizeTikTokUsername(data[field]);
            } else {
                result[field] = typeof data[field] === 'string' ? normalizeDisplayText(data[field]) : data[field];
            }
        }
        return result;
    }, {});
}

function createCustomer(userId, data = {}) {
    const db = getDb();
    const now = new Date().toISOString();
    const id = `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fields = pickCustomerFields(data);
    db.prepare(`
        INSERT INTO customers (id, user_id, tiktok_username, display_name, phone, province, district, ward, address_detail, address_note, postal_code, customer_code, delivery_note, default_weight_kg, allow_try_on, view_only_no_try, partial_delivery, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id, userId,
        fields.tiktokUsername || '', fields.displayName || '',
        fields.phone || '', fields.province || '', fields.district || '', fields.ward || '',
        fields.addressDetail || '', fields.addressNote || '', fields.postalCode || '',
        fields.customerCode || '', fields.deliveryNote || '', fields.defaultWeightKg || '',
        fields.allowTryOn || '', fields.viewOnlyNoTry || '', fields.partialDelivery || '',
        now, now
    );
    return getCustomerById(userId, id);
}

function updateCustomer(userId, customerId, patch = {}) {
    const existing = getDb().prepare('SELECT id FROM customers WHERE id = ? AND user_id = ?').get(customerId, userId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const fields = pickCustomerFields(patch);
    const setClauses = ['updated_at = ?'];
    const values = [now];
    for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL)) {
        if (fields[camel] !== undefined && camel !== 'id' && camel !== 'userId' && camel !== 'createdAt' && camel !== 'updatedAt') {
            setClauses.push(`${snake} = ?`);
            values.push(fields[camel]);
        }
    }
    values.push(customerId, userId);
    getDb().prepare(`UPDATE customers SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    return getCustomerById(userId, customerId);
}

function deleteCustomer(userId, customerId) {
    const result = getDb().prepare('DELETE FROM customers WHERE id = ? AND user_id = ?').run(customerId, userId);
    return result.changes > 0;
}

module.exports = {
    readUserCustomers,
    writeUserCustomers,
    listCustomers,
    getCustomerById,
    findCustomerByTikTok,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    normalizeTikTokUsername,
    getUserCustomerFile: () => ''
};
