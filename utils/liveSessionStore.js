/**
 * Live Session Store — per-user SQLite storage.
 * API tương thích ngược với JSON file version.
 */

const { getDb } = require('./db');
const { cleanDisplayText, normalizeDisplayName, normalizeDisplayText } = require('./displayName');

// ── Field mapping ──────────────────────────────────────────────
function rowToSession(row) {
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        type: row.type || 'live_session',
        liveName: row.live_name || '',
        tiktokUsername: row.tiktok_username || '',
        startedAt: row.started_at || '',
        endedAt: row.ended_at || '',
        createdAt: row.created_at || '',
        status: row.status || 'ended',
        resumedAt: row.resumed_at || '',
        resumeCount: Number(row.resume_count || 0),
        lastActivityAt: row.last_activity_at || '',
        endedReason: row.ended_reason || '',
        revision: Number(row.revision || 0),
        summary: typeof row.summary === 'string' ? JSON.parse(row.summary || '{}') : (row.summary || {}),
        orders: []
    };
}

function rowToOrder(row) {
    if (!row) return null;
    return {
        id: row.id,
        customerName: row.customer_name || '',
        customerUsername: row.customer_username || '',
        profilePictureUrl: row.profile_picture_url || '',
        productName: row.product_name || '',
        quantity: row.quantity || 1,
        price: row.price || 0,
        total: row.total || 0,
        note: row.note || '',
        time: row.item_time || '',
        createdAt: row.created_at || ''
    };
}

// ── Public API ─────────────────────────────────────────────────

function readUserSessions(userId) {
    const db = getDb();
    const sessions = db.prepare('SELECT * FROM live_sessions WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    const getOrders = db.prepare('SELECT * FROM orders WHERE session_id = ? ORDER BY created_at');
    return sessions.map(s => {
        const session = rowToSession(s);
        session.orders = getOrders.all(s.id).map(rowToOrder);
        return session;
    });
}

function writeUserSessions(userId, sessions) {
    const db = getDb();
    const del = db.transaction(() => {
        db.prepare('DELETE FROM orders WHERE session_id IN (SELECT id FROM live_sessions WHERE user_id = ?)').run(userId);
        db.prepare('DELETE FROM live_sessions WHERE user_id = ?').run(userId);
    });
    del();
    for (const s of sessions) {
        createLiveSession(userId, s);
    }
}

function calculateSessionSummary(orders) {
    let totalOrders = 0, totalQuantity = 0, totalRevenue = 0;
    if (Array.isArray(orders)) {
        totalOrders = orders.length;
        orders.forEach(o => {
            totalQuantity += (o.quantity || 1);
            totalRevenue += (o.total || o.price || 0);
        });
    } else if (typeof orders === 'object' && orders !== null) {
        Object.values(orders).forEach(customer => {
            if (customer.items && Array.isArray(customer.items)) {
                totalOrders += customer.items.length;
                customer.items.forEach(item => {
                    totalQuantity += 1;
                    totalRevenue += (item.price || 0);
                });
            }
        });
    }
    return { totalOrders, totalQuantity, totalRevenue };
}

function calculateProductSummary(orders) {
    const productMap = {};
    const processItem = (item) => {
        const name = item.text || item.productName || 'Không rõ';
        if (!productMap[name]) {
            productMap[name] = { productName: name, totalQuantity: 0, totalOrders: 0, totalRevenue: 0 };
        }
        productMap[name].totalOrders += 1;
        productMap[name].totalQuantity += (item.quantity || 1);
        productMap[name].totalRevenue += (item.price || item.total || 0);
    };
    if (Array.isArray(orders)) {
        orders.forEach(processItem);
    } else if (typeof orders === 'object' && orders !== null) {
        Object.values(orders).forEach(customer => {
            if (customer.items && Array.isArray(customer.items)) {
                customer.items.forEach(processItem);
            }
        });
    }
    return Object.values(productMap).sort((a, b) => b.totalRevenue - a.totalRevenue);
}

function flattenConfirmedOrders(confirmedOrders) {
    const flat = [];
    Object.values(confirmedOrders).forEach(customer => {
        if (customer.items && Array.isArray(customer.items)) {
            const username = normalizeDisplayText(customer.username || '');
            const customerName = cleanDisplayText(customer.nickname || customer.displayName || '') || username;
            customer.items.forEach(item => {
                flat.push({
                    id: `order_${item.id || Date.now() + Math.random()}`,
                    customerName,
                    customerUsername: username,
                    profilePictureUrl: customer.profilePictureUrl || '',
                    productName: normalizeDisplayText(item.text || ''),
                    quantity: 1,
                    price: item.price || 0,
                    total: item.price || 0,
                    note: '',
                    time: item.time || '',
                    createdAt: new Date().toISOString()
                });
            });
        }
    });
    return flat;
}

function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

function createLiveSession(userId, data) {
    let orders = data.orders;
    if (orders && !Array.isArray(orders)) {
        orders = flattenConfirmedOrders(orders);
    } else if (Array.isArray(orders)) {
        orders = orders.map(o => ({
            ...o,
            id: o.id || `order_${Date.now() + Math.random()}`,
            customerUsername: normalizeDisplayText(o.customerUsername || o.tiktokUsername || ''),
            customerName: cleanDisplayText(o.customerName || o.nickname || '') || normalizeDisplayText(o.customerUsername || o.tiktokUsername || ''),
            productName: normalizeDisplayText(o.productName || o.text || '')
        }));
    } else {
        orders = [];
    }

    const calculatedSummary = calculateSessionSummary(orders);
    const summary = data.summary && typeof data.summary === 'object'
        ? { ...data.summary, ...calculatedSummary }
        : calculatedSummary;
    const now = new Date().toISOString();
    const id = data.id || generateSessionId();

    const db = getDb();

    const orderStmt = db.prepare(`
        INSERT INTO orders (id, session_id, user_id, customer_name, customer_username, profile_picture_url, product_name, quantity, price, total, note, item_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const finalSummary = db.transaction(() => {
        db.prepare(`
            INSERT INTO live_sessions (id, user_id, type, live_name, tiktok_username, started_at, ended_at, created_at, summary, status, resumed_at, resume_count, last_activity_at, ended_reason, revision)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, userId,
            data.type || 'live_session',
            data.liveName || `Phiên live ${new Date().toLocaleDateString('vi-VN')}`,
            data.tiktokUsername || '',
            data.startedAt || now,
            data.endedAt || null,
            now,
            JSON.stringify(summary),
            data.status || 'live',
            data.resumedAt || null,
            Number(data.resumeCount || 0),
            data.lastActivityAt || now,
            data.endedReason || null,
            Number(data.revision || 0)
        );

        for (const o of orders) {
            const newOrderId = `order_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            orderStmt.run(
                newOrderId,
                id, userId,
                o.customerName || '', o.customerUsername || '',
                o.profilePictureUrl || '', o.productName || '',
                o.quantity || 1, o.price || 0, o.total || 0,
                o.note || '', o.time || '', o.createdAt || now
            );
        }

        console.log(`>>> createLiveSession: đã insert ${orders.length} orders cho session ${id}`);

        const actualOrders = db.prepare('SELECT * FROM orders WHERE session_id = ?').all(id);

        console.log(`>>> createLiveSession: verify — session ${id} có ${actualOrders.length} orders trong DB`);
        if (actualOrders.length !== orders.length) {
            console.error(`>>> CẢNH BÁO: Số order insert (${orders.length}) khác số order thực tế trong DB (${actualOrders.length}) — có thể do PRIMARY KEY conflict`);
        }

        const actualSummary = calculateSessionSummary(actualOrders.map(row => ({
            quantity: row.quantity,
            price: row.price,
            total: row.total
        })));
        const mergedSummary = { ...summary, ...actualSummary };
        if (Array.isArray(data.sourceSessionIds)) {
            mergedSummary.sourceSessionIds = data.sourceSessionIds;
        }
        db.prepare('UPDATE live_sessions SET summary = ? WHERE id = ?').run(JSON.stringify(mergedSummary), id);
        return mergedSummary;
    })();

    return getLiveSessionById(userId, id);
}

function getLiveSessionById(userId, sessionId) {
    const db = getDb();
    const sessionRow = db.prepare('SELECT * FROM live_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);

    if (!sessionRow) return null;

    const orders = db.prepare('SELECT * FROM orders WHERE session_id = ? ORDER BY created_at').all(sessionId);
    const session = rowToSession(sessionRow);
    session.orders = orders.map(rowToOrder);
    return session;
}

function deleteLiveSession(userId, sessionId) {
    const db = getDb();
    db.prepare('DELETE FROM orders WHERE session_id = ?').run(sessionId);
    const result = db.prepare('DELETE FROM live_sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
    return result.changes > 0;
}

// ⚠️ DEPRECATED/UNUSED: Hàm này giữ nguyên order.id gốc khi merge, có thể gây 
// PRIMARY KEY conflict nếu dùng để lưu trực tiếp vào DB. Dùng 
// mergeVisibleLiveSessionsWithLegacy (server.js) + createLiveSession thay thế.
function mergeLiveSessions(userId, sessionIds) {
    const sessions = sessionIds.map(id => getLiveSessionById(userId, id)).filter(Boolean);
    if (sessions.length === 0) return null;

    const mergedOrders = [];
    const seenOrderIds = new Set();
    sessions.forEach(session => {
        (session.orders || []).forEach(order => {
            if (order.id && seenOrderIds.has(order.id)) return;
            if (order.id) seenOrderIds.add(order.id);
            mergedOrders.push({ ...order, fromSession: session.liveName });
        });
    });

    const summary = calculateSessionSummary(mergedOrders);
    const productSummary = calculateProductSummary(mergedOrders);

    const customerMap = {};
    mergedOrders.forEach(o => {
        const customerUsername = normalizeDisplayText(o.customerUsername || '');
        const customerName = normalizeDisplayName(o.customerName || '', customerUsername ? `@${customerUsername}` : undefined);
        const key = customerUsername || customerName || 'unknown';
        if (!customerMap[key]) {
            customerMap[key] = {
                customerName, customerUsername,
                profilePictureUrl: o.profilePictureUrl, orders: [], total: 0
            };
        }
        customerMap[key].orders.push(o);
        customerMap[key].total += (o.total || o.price || 0);
    });

    return {
        selectedSessions: sessions.map(s => ({
            id: s.id, liveName: s.liveName, tiktokUsername: s.tiktokUsername,
            startedAt: s.startedAt, summary: s.summary
        })),
        summary: { totalSessions: sessions.length, ...summary },
        mergedOrders, productSummary,
        customerSummary: Object.values(customerMap).sort((a, b) => b.total - a.total)
    };
}

function getUserSessionFile(userId) {
    return '';
}

/**
 * Cập nhật session đã có: xóa orders cũ và insert lại orders mới.
 * Dùng cho sync sau mỗi thao tác thêm/sửa/xóa khi user đang chỉnh sửa session lịch sử.
 */
function updateLiveSession(userId, sessionId, patch) {
    const db = getDb();
    const existing = db.prepare('SELECT id, revision FROM live_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
    if (!existing) throw new Error(`Session ${sessionId} không tồn tại hoặc không thuộc user ${userId}`);

    const requestedRevision = Number.isFinite(Number(patch.revision)) ? Number(patch.revision) : null;
    if (requestedRevision !== null && requestedRevision < Number(existing.revision || 0)) {
        return getLiveSessionById(userId, sessionId);
    }
    const revision = requestedRevision === null ? Number(existing.revision || 0) + 1 : requestedRevision;
    const now = new Date().toISOString();
    const metadata = {
        status: patch.status,
        endedAt: patch.endedAt,
        endedReason: patch.endedReason,
        lastActivityAt: patch.lastActivityAt || now,
        resumedAt: patch.resumedAt,
        resumeCount: patch.resumeCount
    };

    let orders = patch.orders;
    if (!orders) {
        // Không cập nhật orders nếu không truyền vào
        if (patch.summary) {
            db.prepare(`
                UPDATE live_sessions
                SET summary = ?, status = COALESCE(?, status), ended_at = COALESCE(?, ended_at),
                    ended_reason = COALESCE(?, ended_reason), last_activity_at = ?,
                    resumed_at = COALESCE(?, resumed_at), resume_count = COALESCE(?, resume_count), revision = ?
                WHERE id = ? AND user_id = ?
            `).run(JSON.stringify(patch.summary), metadata.status || null, metadata.endedAt || null,
                metadata.endedReason || null, metadata.lastActivityAt, metadata.resumedAt || null,
                metadata.resumeCount ?? null, revision, sessionId, userId);
        }
        return getLiveSessionById(userId, sessionId);
    }

    if (!Array.isArray(orders)) {
        orders = flattenConfirmedOrders(orders);
    }

    const calculatedSummary = calculateSessionSummary(orders);
    const summary = patch.summary
        ? { ...patch.summary, ...calculatedSummary }
        : calculatedSummary;

    const orderStmt = db.prepare(`
        INSERT INTO orders (id, session_id, user_id, customer_name, customer_username, profile_picture_url, product_name, quantity, price, total, note, item_time, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
        // Xóa orders cũ của session này
        db.prepare('DELETE FROM orders WHERE session_id = ?').run(sessionId);
        // Insert orders mới
        for (const o of orders) {
            const newOrderId = `order_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            orderStmt.run(
                newOrderId, sessionId, userId,
                o.customerName || '', o.customerUsername || '',
                o.profilePictureUrl || '', o.productName || '',
                o.quantity || 1, o.price || 0, o.total || o.price || 0,
                o.note || '', o.time || '', o.createdAt || now
            );
        }
        db.prepare(`
            UPDATE live_sessions
            SET summary = ?, status = COALESCE(?, status), ended_at = COALESCE(?, ended_at),
                ended_reason = COALESCE(?, ended_reason), last_activity_at = ?,
                resumed_at = COALESCE(?, resumed_at), resume_count = COALESCE(?, resume_count), revision = ?
            WHERE id = ? AND user_id = ?
        `).run(JSON.stringify(summary), metadata.status || null, metadata.endedAt || null,
            metadata.endedReason || null, metadata.lastActivityAt, metadata.resumedAt || null,
            metadata.resumeCount ?? null, revision, sessionId, userId);
    })();

    return getLiveSessionById(userId, sessionId);
}

/**
 * Upsert session: nếu sessionId đã tồn tại thì update, không thì create mới.
 * Trả về { session, isNew }
 */
function upsertLiveSession(userId, sessionId, data) {
    const db = getDb();
    const existing = sessionId
        ? db.prepare('SELECT id FROM live_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId)
        : null;

    if (existing) {
        const session = updateLiveSession(userId, sessionId, data);
        return { session, isNew: false };
    }
    const session = createLiveSession(userId, data);
    return { session, isNew: true };
}

function renameLiveSession(userId, sessionId, newName) {
    const db = getDb();
    const result = db.prepare(
        'UPDATE live_sessions SET live_name = ? WHERE id = ? AND user_id = ?'
    ).run(newName, sessionId, userId);
    return result.changes > 0;
}

module.exports = {
    readUserSessions,
    writeUserSessions,
    createLiveSession,
    updateLiveSession,
    upsertLiveSession,
    getLiveSessionById,
    deleteLiveSession,
    mergeLiveSessions,
    calculateSessionSummary,
    calculateProductSummary,
    flattenConfirmedOrders,
    getUserSessionFile,
    rowToSession,
    rowToOrder,
    renameLiveSession
};

