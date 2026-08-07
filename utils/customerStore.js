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

function normalizePhone(phone) {
    if (!phone) return '';
    let cleaned = String(phone).trim().replace(/[\s\.\-\(\)]/g, '');
    if (cleaned.startsWith('+84')) {
        cleaned = '0' + cleaned.slice(3);
    } else if (cleaned.startsWith('84') && cleaned.length > 9) {
        cleaned = '0' + cleaned.slice(2);
    }
    return cleaned.replace(/[^\d\+]/g, '');
}

function findCustomerByPhone(userId, phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    return rowToCustomer(getDb().prepare('SELECT * FROM customers WHERE user_id = ? AND phone = ?').get(userId, normalized));
}

function findCustomerByCode(userId, code) {
    const normalized = normalizeDisplayText(code);
    if (!normalized) return null;
    return rowToCustomer(getDb().prepare('SELECT * FROM customers WHERE user_id = ? AND customer_code = ?').get(userId, normalized));
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

function parseTikTokUsernames(input) {
    if (!input) return [];
    if (Array.isArray(input)) {
        return Array.from(new Set(input.map(h => normalizeTikTokUsername(h)).filter(Boolean)));
    }
    return Array.from(new Set(String(input).split(/[\s,;]+/).map(h => normalizeTikTokUsername(h)).filter(Boolean)));
}

function findCustomerByTikTok(userId, tiktokUsername) {
    const normalized = normalizeTikTokUsername(tiktokUsername);
    if (!normalized) return null;
    const exact = getDb().prepare('SELECT * FROM customers WHERE user_id = ? AND LOWER(tiktok_username) = ?').get(userId, normalized);
    if (exact) return rowToCustomer(exact);

    const candidates = getDb().prepare('SELECT * FROM customers WHERE user_id = ? AND LOWER(tiktok_username) LIKE ?').all(userId, `%${normalized}%`);
    for (const row of candidates) {
        const handles = parseTikTokUsernames(row.tiktok_username);
        if (handles.includes(normalized)) {
            return rowToCustomer(row);
        }
    }
    return null;
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
                const list = parseTikTokUsernames(data[field]);
                result[field] = list.map(u => `@${u}`).join(', ');
            } else if (field === 'phone') {
                result[field] = normalizePhone(data[field]);
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

    if (!fields.displayName) {
        throw new Error('Tên người nhận là bắt buộc.');
    }
    if (fields.tiktokUsername) {
        const existing = findCustomerByTikTok(userId, fields.tiktokUsername);
        if (existing) {
            throw new Error(`Tài khoản TikTok @${fields.tiktokUsername} đã tồn tại trên hệ thống.`);
        }
    }
    if (fields.phone) {
        if (fields.phone.length < 9 || fields.phone.length > 13 || /[^\d\+]/.test(fields.phone)) {
            throw new Error(`Số điện thoại không hợp lệ (phải có từ 9 đến 13 số).`);
        }
        const existing = findCustomerByPhone(userId, fields.phone);
        if (existing) {
            throw new Error(`Số điện thoại ${fields.phone} đã tồn tại cho khách hàng "${existing.displayName}".`);
        }
    }
    if (fields.customerCode) {
        const existing = findCustomerByCode(userId, fields.customerCode);
        if (existing) {
            throw new Error(`Mã khách hàng ${fields.customerCode} đã được sử dụng.`);
        }
    }

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
    const existingCust = getDb().prepare('SELECT id FROM customers WHERE id = ? AND user_id = ?').get(customerId, userId);
    if (!existingCust) return null;

    const now = new Date().toISOString();
    const fields = pickCustomerFields(patch);

    if (fields.displayName !== undefined && !fields.displayName) {
        throw new Error('Tên người nhận là bắt buộc.');
    }
    if (fields.tiktokUsername) {
        const existing = findCustomerByTikTok(userId, fields.tiktokUsername);
        if (existing && existing.id !== customerId) {
            throw new Error(`Tài khoản TikTok @${fields.tiktokUsername} đã tồn tại trên hệ thống.`);
        }
    }
    if (fields.phone) {
        if (fields.phone.length < 9 || fields.phone.length > 13 || /[^\d\+]/.test(fields.phone)) {
            throw new Error(`Số điện thoại không hợp lệ (phải có từ 9 đến 13 số).`);
        }
        const existing = findCustomerByPhone(userId, fields.phone);
        if (existing && existing.id !== customerId) {
            throw new Error(`Số điện thoại ${fields.phone} đã tồn tại cho khách hàng "${existing.displayName}".`);
        }
    }
    if (fields.customerCode) {
        const existing = findCustomerByCode(userId, fields.customerCode);
        if (existing && existing.id !== customerId) {
            throw new Error(`Mã khách hàng ${fields.customerCode} đã được sử dụng.`);
        }
    }

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

function mergeCustomers(userId, primaryCustomerId, secondaryCustomerIds) {
    const db = getDb();
    const primary = getCustomerById(userId, primaryCustomerId);
    if (!primary) {
        throw new Error('Không tìm thấy khách hàng chính.');
    }

    if (!Array.isArray(secondaryCustomerIds) || secondaryCustomerIds.length === 0) {
        throw new Error('Danh sách khách hàng phụ cần gộp không được để trống.');
    }

    const secondaryCustomers = secondaryCustomerIds
        .filter(id => id !== primaryCustomerId)
        .map(id => getCustomerById(userId, id))
        .filter(Boolean);

    if (secondaryCustomers.length === 0) {
        throw new Error('Không tìm thấy các khách hàng phụ để gộp.');
    }

    // 1. Gộp tất cả các tài khoản TikTok username duy nhất
    const allUsernames = new Set(parseTikTokUsernames(primary.tiktokUsername));
    secondaryCustomers.forEach(c => {
        parseTikTokUsernames(c.tiktokUsername).forEach(u => allUsernames.add(u));
    });
    const combinedTikTok = Array.from(allUsernames).map(u => `@${u}`).join(', ');

    // 2. Điền bù các trường thông tin còn thiếu từ khách phụ sang khách chính
    const newPhone = primary.phone || secondaryCustomers.find(c => Boolean(c.phone))?.phone || '';
    const newProvince = primary.province || secondaryCustomers.find(c => Boolean(c.province))?.province || '';
    const newDistrict = primary.district || secondaryCustomers.find(c => Boolean(c.district))?.district || '';
    const newWard = primary.ward || secondaryCustomers.find(c => Boolean(c.ward))?.ward || '';
    const newAddressDetail = primary.addressDetail || secondaryCustomers.find(c => Boolean(c.addressDetail))?.addressDetail || '';
    
    const notes = [primary.addressNote, ...secondaryCustomers.map(c => c.addressNote)].filter(Boolean);
    const newAddressNote = Array.from(new Set(notes)).join('; ');

    const now = new Date().toISOString();

    db.prepare(`
        UPDATE customers 
        SET tiktok_username = ?, phone = ?, province = ?, district = ?, ward = ?, address_detail = ?, address_note = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
    `).run(
        combinedTikTok, newPhone, newProvince, newDistrict, newWard, newAddressDetail, newAddressNote,
        now, primaryCustomerId, userId
    );

    // 3. Xóa các bản ghi khách hàng phụ
    const deleteStmt = db.prepare('DELETE FROM customers WHERE id = ? AND user_id = ?');
    secondaryCustomers.forEach(c => {
        deleteStmt.run(c.id, userId);
    });

    return getCustomerById(userId, primaryCustomerId);
}

module.exports = {
    readUserCustomers,
    writeUserCustomers,
    listCustomers,
    getCustomerById,
    findCustomerByTikTok,
    findCustomerByPhone,
    findCustomerByCode,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    mergeCustomers,
    parseTikTokUsernames,
    normalizeTikTokUsername,
    normalizePhone,
    getUserCustomerFile: () => ''
};
