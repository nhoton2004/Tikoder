/**
 * SQLite Database Layer — thay thế JSON file storage
 * Dùng better-sqlite3 cho sync API cực nhanh
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DB_DIR, 'tiktok-order.db');

let db;

function getDb() {
    if (!db) {
        if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
        db = new Database(DB_FILE);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        initTables();
    }
    return db;
}

function initTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            tiktok_username TEXT DEFAULT '',
            display_name TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            province TEXT DEFAULT '',
            district TEXT DEFAULT '',
            ward TEXT DEFAULT '',
            address_detail TEXT DEFAULT '',
            address_note TEXT DEFAULT '',
            postal_code TEXT DEFAULT '',
            customer_code TEXT DEFAULT '',
            delivery_note TEXT DEFAULT '',
            default_weight_kg TEXT DEFAULT '',
            allow_try_on TEXT DEFAULT '',
            view_only_no_try TEXT DEFAULT '',
            partial_delivery TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
        CREATE INDEX IF NOT EXISTS idx_customers_tiktok ON customers(user_id, tiktok_username);

        CREATE TABLE IF NOT EXISTS live_sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            type TEXT DEFAULT 'live_session',
            live_name TEXT DEFAULT '',
            tiktok_username TEXT DEFAULT '',
            started_at TEXT,
            ended_at TEXT,
            created_at TEXT NOT NULL,
            summary TEXT DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON live_sessions(user_id);

        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            customer_name TEXT DEFAULT '',
            customer_username TEXT DEFAULT '',
            profile_picture_url TEXT DEFAULT '',
            product_name TEXT DEFAULT '',
            quantity INTEGER DEFAULT 1,
            price REAL DEFAULT 0,
            total REAL DEFAULT 0,
            note TEXT DEFAULT '',
            item_time TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES live_sessions(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);
        CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(user_id, customer_username);
        CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON orders(user_id, customer_username, created_at);

        CREATE TABLE IF NOT EXISTS debts (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            customer_username TEXT NOT NULL,
            customer_name TEXT DEFAULT '',
            amount REAL NOT NULL DEFAULT 0,
            note TEXT DEFAULT '',
            status TEXT DEFAULT 'unpaid',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_debts_user ON debts(user_id);
        CREATE INDEX IF NOT EXISTS idx_debts_customer ON debts(user_id, customer_username);
    `);
}

// ==================== CUSTOMER OPERATIONS ====================

function dbCreateCustomer(userId, data = {}) {
    const now = new Date().toISOString();
    const id = `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stmt = getDb().prepare(`
        INSERT INTO customers (id, user_id, tiktok_username, display_name, phone, province, district, ward, address_detail, address_note, postal_code, customer_code, delivery_note, default_weight_kg, allow_try_on, view_only_no_try, partial_delivery, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        id, userId,
        data.tiktokUsername || '',
        data.displayName || '',
        data.phone || '',
        data.province || '',
        data.district || '',
        data.ward || '',
        data.addressDetail || '',
        data.addressNote || '',
        data.postalCode || '',
        data.customerCode || '',
        data.deliveryNote || '',
        data.defaultWeightKg || '',
        data.allowTryOn || '',
        data.viewOnlyNoTry || '',
        data.partialDelivery || '',
        now, now
    );
    return dbGetCustomerById(userId, id);
}

function dbGetCustomerById(userId, customerId) {
    return getDb().prepare('SELECT * FROM customers WHERE id = ? AND user_id = ?').get(customerId, userId);
}

function dbFindCustomerByTikTok(userId, tiktokUsername) {
    const normalized = (tiktokUsername || '').replace(/^@+/, '').replace(/\s+/g, '').toLowerCase();
    if (!normalized) return null;
    return getDb().prepare('SELECT * FROM customers WHERE user_id = ? AND LOWER(tiktok_username) = ?').get(userId, normalized);
}

function dbListCustomers(userId, query = '') {
    if (!query) {
        return getDb().prepare('SELECT * FROM customers WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    }
    const q = `%${query.toLowerCase()}%`;
    return getDb().prepare('SELECT * FROM customers WHERE user_id = ? AND (LOWER(display_name) LIKE ? OR LOWER(tiktok_username) LIKE ? OR LOWER(phone) LIKE ?) ORDER BY created_at DESC').all(userId, q, q, q);
}

function dbUpdateCustomer(userId, customerId, patch = {}) {
    const existing = dbGetCustomerById(userId, customerId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const fields = ['tiktok_username', 'display_name', 'phone', 'province', 'district', 'ward', 'address_detail', 'address_note', 'postal_code', 'customer_code', 'delivery_note', 'default_weight_kg', 'allow_try_on', 'view_only_no_try', 'partial_delivery'];
    const setClauses = [];
    const values = [];

    fields.forEach(f => {
        const snake = f.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
        if (patch[f] !== undefined) {
            setClauses.push(`${snake} = ?`);
            values.push(patch[f]);
        }
    });

    if (setClauses.length === 0) return existing;

    setClauses.push('updated_at = ?');
    values.push(now);
    values.push(customerId, userId);

    getDb().prepare(`UPDATE customers SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    return dbGetCustomerById(userId, customerId);
}

function dbDeleteCustomer(userId, customerId) {
    const result = getDb().prepare('DELETE FROM customers WHERE id = ? AND user_id = ?').run(customerId, userId);
    return result.changes > 0;
}

// ==================== LIVE SESSION OPERATIONS ====================

function dbCreateLiveSession(userId, data = {}) {
    const now = new Date().toISOString();
    const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const orders = Array.isArray(data.orders) ? data.orders : [];
    const summary = calculateSessionSummary(orders);

    const stmt = getDb().prepare(`
        INSERT INTO live_sessions (id, user_id, type, live_name, tiktok_username, started_at, ended_at, created_at, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        id, userId,
        data.type || 'live_session',
        data.liveName || `Phiên live ${new Date().toLocaleDateString('vi-VN')}`,
        data.tiktokUsername || '',
        data.startedAt || now,
        data.endedAt || now,
        now,
        JSON.stringify(summary)
    );

    // Insert orders
    const orderStmt = getDb().prepare(`
        INSERT INTO orders (id, session_id, user_id, customer_name, customer_username, profile_picture_url, product_name, quantity, price, total, note, item_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOrders = getDb().transaction((orders) => {
        for (const o of orders) {
            orderStmt.run(
                o.id || `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                id, userId,
                o.customerName || '',
                o.customerUsername || '',
                o.profilePictureUrl || '',
                o.productName || '',
                o.quantity || 1,
                o.price || 0,
                o.total || 0,
                o.note || '',
                o.itemTime || '',
                o.createdAt || now
            );
        }
    });
    insertOrders(orders);

    return dbGetLiveSessionById(userId, id);
}

function dbGetLiveSessionById(userId, sessionId) {
    const session = getDb().prepare('SELECT * FROM live_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
    if (!session) return null;
    session.orders = getDb().prepare('SELECT * FROM orders WHERE session_id = ? ORDER BY created_at').all(sessionId);
    session.summary = JSON.parse(session.summary || '{}');
    return session;
}

function dbListLiveSessions(userId) {
    return getDb().prepare('SELECT * FROM live_sessions WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function dbDeleteLiveSession(userId, sessionId) {
    const result = getDb().prepare('DELETE FROM live_sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
    return result.changes > 0;
}

// ==================== DEBT OPERATIONS ====================

function dbCreateDebt(userId, data = {}) {
    const now = new Date().toISOString();
    const id = `debt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    getDb().prepare(`
        INSERT INTO debts (id, user_id, customer_username, customer_name, amount, note, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, data.customerUsername || '', data.customerName || '', data.amount || 0, data.note || '', data.status || 'unpaid', now, now);
    return getDb().prepare('SELECT * FROM debts WHERE id = ?').get(id);
}

function dbListDebts(userId, customerUsername = null) {
    if (customerUsername) {
        return getDb().prepare('SELECT * FROM debts WHERE user_id = ? AND customer_username = ? ORDER BY created_at DESC').all(userId, customerUsername);
    }
    return getDb().prepare('SELECT * FROM debts WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

function dbGetDebtSummary(userId, customerUsername) {
    return getDb().prepare('SELECT COALESCE(SUM(amount), 0) as total_debt FROM debts WHERE user_id = ? AND customer_username = ? AND status = ?').get(userId, customerUsername, 'unpaid');
}

function dbUpdateDebt(userId, debtId, patch = {}) {
    const existing = getDb().prepare('SELECT * FROM debts WHERE id = ? AND user_id = ?').get(debtId, userId);
    if (!existing) return null;
    const now = new Date().toISOString();
    const fields = ['customer_username', 'customer_name', 'amount', 'note', 'status'];
    const setClauses = [];
    const values = [];
    fields.forEach(f => {
        if (patch[f] !== undefined) {
            setClauses.push(`${f} = ?`);
            values.push(patch[f]);
        }
    });
    if (setClauses.length === 0) return existing;
    setClauses.push('updated_at = ?');
    values.push(now, debtId, userId);
    getDb().prepare(`UPDATE debts SET ${setClauses.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    return getDb().prepare('SELECT * FROM debts WHERE id = ?').get(debtId);
}

function dbDeleteDebt(userId, debtId) {
    const result = getDb().prepare('DELETE FROM debts WHERE id = ? AND user_id = ?').run(debtId, userId);
    return result.changes > 0;
}

// ==================== MIGRATION ====================

function migrateFromJson() {
    const customerDir = path.join(DB_DIR, 'customers');
    const sessionDir = path.join(DB_DIR, 'live-sessions');

    // Migrate customers
    if (fs.existsSync(customerDir)) {
        const files = fs.readdirSync(customerDir).filter(f => f.endsWith('.json'));
        const migrateCustomers = getDb().transaction((files) => {
            for (const file of files) {
                try {
                    const userId = file.replace(/\.json$/i, '');
                    const data = JSON.parse(fs.readFileSync(path.join(customerDir, file), 'utf-8'));
                    const customers = Array.isArray(data?.customers) ? data.customers : [];
                    for (const c of customers) {
                        const exists = getDb().prepare('SELECT id, phone, address_detail FROM customers WHERE id = ?').get(c.id);
                        if (exists) {
                            // Nếu trong DB chưa có SĐT/địa chỉ nhưng trong file JSON có thì cập nhật bổ sung
                            const hasNewPhone = !exists.phone && c.phone;
                            const hasNewAddress = !exists.address_detail && c.addressDetail;
                            if (hasNewPhone || hasNewAddress) {
                                getDb().prepare(`
                                    UPDATE customers
                                    SET phone = CASE WHEN phone = '' OR phone IS NULL THEN ? ELSE phone END,
                                        address_detail = CASE WHEN address_detail = '' OR address_detail IS NULL THEN ? ELSE address_detail END,
                                        updated_at = ?
                                    WHERE id = ?
                                `).run(c.phone || '', c.addressDetail || '', new Date().toISOString(), c.id);
                            }
                            continue;
                        }
                        getDb().prepare(`
                            INSERT OR IGNORE INTO customers (id, user_id, tiktok_username, display_name, phone, province, district, ward, address_detail, address_note, postal_code, customer_code, delivery_note, default_weight_kg, allow_try_on, view_only_no_try, partial_delivery, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            c.id, userId,
                            c.tiktokUsername || '',
                            c.displayName || '',
                            c.phone || '',
                            c.province || '',
                            c.district || '',
                            c.ward || '',
                            c.addressDetail || '',
                            c.addressNote || '',
                            c.postalCode || '',
                            c.customerCode || '',
                            c.deliveryNote || '',
                            c.defaultWeightKg || '',
                            c.allowTryOn || '',
                            c.viewOnlyNoTry || '',
                            c.partialDelivery || '',
                            c.createdAt || new Date().toISOString(),
                            c.updatedAt || new Date().toISOString()
                        );
                    }
                } catch (e) {
                    console.error(`Migrate customer file ${file} error:`, e.message);
                }
            }
        });
        migrateCustomers(files);
        console.log(`✅ Migrated ${files.length} customer files`);
    }

    // Migrate live sessions
    if (fs.existsSync(sessionDir)) {
        const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.json'));
        const migrateSessions = getDb().transaction((files) => {
            for (const file of files) {
                try {
                    const userId = file.replace(/\.json$/i, '');
                    const data = JSON.parse(fs.readFileSync(path.join(sessionDir, file), 'utf-8'));
                    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
                    for (const s of sessions) {
                        const exists = getDb().prepare('SELECT id FROM live_sessions WHERE id = ?').get(s.id);
                        if (exists) continue;
                        const orders = Array.isArray(s.orders) ? s.orders : [];
                        const summary = calculateSessionSummary(orders);
                        getDb().prepare(`
                            INSERT OR IGNORE INTO live_sessions (id, user_id, type, live_name, tiktok_username, started_at, ended_at, created_at, summary)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(
                            s.id, userId,
                            s.type || 'live_session',
                            s.liveName || '',
                            s.tiktokUsername || '',
                            s.startedAt || '',
                            s.endedAt || '',
                            s.createdAt || new Date().toISOString(),
                            JSON.stringify(s.summary || summary)
                        );
                        for (const o of orders) {
                            getDb().prepare(`
                                INSERT OR IGNORE INTO orders (id, session_id, user_id, customer_name, customer_username, profile_picture_url, product_name, quantity, price, total, note, item_time, created_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `).run(
                                o.id || `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                                s.id, userId,
                                o.customerName || '',
                                o.customerUsername || '',
                                o.profilePictureUrl || '',
                                o.productName || '',
                                o.quantity || 1,
                                o.price || 0,
                                o.total || 0,
                                o.note || '',
                                o.itemTime || '',
                                o.createdAt || new Date().toISOString()
                            );
                        }
                    }
                } catch (e) {
                    console.error(`Migrate session file ${file} error:`, e.message);
                }
            }
        });
        migrateSessions(files);
        console.log(`✅ Migrated ${files.length} session files`);
    }
}

// ==================== HELPERS ====================

function calculateSessionSummary(orders) {
    let totalOrders = 0, totalQuantity = 0, totalRevenue = 0;
    if (Array.isArray(orders)) {
        totalOrders = orders.length;
        orders.forEach(o => {
            totalQuantity += (o.quantity || 1);
            totalRevenue += (o.total || o.price || 0);
        });
    }
    return { totalOrders, totalQuantity, totalRevenue };
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

// ==================== REAL-TIME ORDER OPERATIONS ====================

// ⚠️ UNUSED: Hàm này hiện không được gọi ở đâu trong codebase.
function dbInsertOrder(userId, sessionId, order = {}) {
    const now = new Date().toISOString();
    const id = order.id || `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    getDb().prepare(`
        INSERT OR IGNORE INTO orders (id, session_id, user_id, customer_name, customer_username, profile_picture_url, product_name, quantity, price, total, note, item_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        id, sessionId, userId,
        order.customerName || '',
        order.customerUsername || '',
        order.profilePictureUrl || '',
        order.productName || '',
        order.quantity || 1,
        order.price || 0,
        order.total || 0,
        order.note || '',
        order.itemTime || order.time || '',
        order.createdAt || now
    );
    return id;
}

function dbGetOrdersByUserAndDateRange(userId, startDate, endDate) {
    return getDb().prepare(`
        SELECT o.* FROM orders o
        JOIN live_sessions s ON o.session_id = s.id
        WHERE o.user_id = ? AND o.created_at >= ? AND o.created_at < ?
        ORDER BY o.created_at
    `).all(userId, startDate, endDate);
}

function dbGetAllUserOrders(userId) {
    return getDb().prepare(`
        SELECT o.* FROM orders o
        JOIN live_sessions s ON o.session_id = s.id
        WHERE o.user_id = ?
        ORDER BY o.created_at
    `).all(userId);
}

function dbMigrateHistoryToSqlite() {
    const historyRoot = path.join(__dirname, '..', 'history');
    if (!fs.existsSync(historyRoot)) return;

    const entries = fs.readdirSync(historyRoot, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const userId = entry.name;
            const dir = path.join(historyRoot, userId);
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
                    const match = file.match(/^(\d{4}-\d{2}-\d{2})_(.+)\.json$/);
                    if (!match) continue;
                    const dateStr = match[1];
                    const broadcaster = match[2].replace(/\.json$/i, '');
                    const sessionId = `legacy_${userId}_${file.replace('.json', '')}`;
                    const exists = getDb().prepare('SELECT id FROM live_sessions WHERE id = ?').get(sessionId);
                    if (exists) continue;

                    const items = [];
                    Object.values(data).forEach(customer => {
                        const username = (customer.username || customer.tiktokUsername || '').replace(/^@+/, '');
                        const displayName = customer.nickname || customer.displayName || username;
                        if (customer.items && Array.isArray(customer.items)) {
                            customer.items.forEach(item => {
                                items.push({
                                    customerName: displayName,
                                    customerUsername: username,
                                    profilePictureUrl: customer.profilePictureUrl || '',
                                    productName: item.text || '',
                                    quantity: 1,
                                    price: item.price || 0,
                                    total: item.price || 0,
                                    time: item.time || '',
                                    createdAt: `${dateStr}T${(item.time || '00:00:00')}.000Z`
                                });
                            });
                        }
                    });

                    if (items.length === 0) continue;
                    const summary = calculateSessionSummary(items);
                    getDb().prepare(`
                        INSERT OR IGNORE INTO live_sessions (id, user_id, type, live_name, tiktok_username, started_at, ended_at, created_at, summary)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(sessionId, userId, 'legacy_history', file.replace('.json', ''), broadcaster, `${dateStr}T00:00:00.000Z`, `${dateStr}T23:59:59.000Z`, `${dateStr}T00:00:00.000Z`, JSON.stringify(summary));

                    const orderStmt = getDb().prepare(`
                        INSERT OR IGNORE INTO orders (id, session_id, user_id, customer_name, customer_username, profile_picture_url, product_name, quantity, price, total, note, item_time, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);
                    for (const item of items) {
                        orderStmt.run(
                            `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                            sessionId, userId,
                            item.customerName, item.customerUsername,
                            item.profilePictureUrl || '', item.productName,
                            item.quantity, item.price, item.total,
                            '', item.time, item.createdAt
                        );
                    }
                } catch (e) {
                    console.error(`Migrate history file ${file} error:`, e.message);
                }
            }
        }
    }
}

module.exports = {
    getDb,
    migrateFromJson,
    closeDb,
    // Customers
    dbCreateCustomer,
    dbGetCustomerById,
    dbFindCustomerByTikTok,
    dbListCustomers,
    dbUpdateCustomer,
    dbDeleteCustomer,
    // Sessions
    dbCreateLiveSession,
    dbGetLiveSessionById,
    dbListLiveSessions,
    dbDeleteLiveSession,
    // Orders
    dbInsertOrder,
    dbGetOrdersByUserAndDateRange,
    dbGetAllUserOrders,
    // Debts
    dbCreateDebt,
    dbListDebts,
    dbGetDebtSummary,
    dbUpdateDebt,
    dbDeleteDebt,
    // Migration
    dbMigrateHistoryToSqlite,
};
