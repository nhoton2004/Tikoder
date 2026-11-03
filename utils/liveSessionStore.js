/**
 * Live Session Store — lưu trữ lịch sử phiên live theo từng user (JSON file)
 * Mỗi user có 1 file riêng: data/live-sessions/{userId}.json
 */

const fs = require('fs');
const path = require('path');
const { cleanDisplayText, normalizeDisplayName, normalizeDisplayText } = require('./displayName');

const DATA_DIR = path.join(__dirname, '..', 'data', 'live-sessions');

// Đảm bảo thư mục tồn tại
function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

function getUserSessionFile(userId) {
    ensureDir();
    return path.join(DATA_DIR, `${userId}.json`);
}

function readUserSessions(userId) {
    const filePath = getUserSessionFile(userId);
    if (!fs.existsSync(filePath)) return [];
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (!Array.isArray(data.sessions)) throw new Error('Định dạng lịch sử không hợp lệ');
        return data.sessions;
    } catch (e) {
        throw new Error(`Không thể đọc lịch sử của user ${userId}: ${e.message}`);
    }
}

function writeUserSessions(userId, sessions) {
    const filePath = getUserSessionFile(userId);
    ensureDir();
    const temporaryPath = `${filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ sessions }, null, 2), 'utf-8');
    fs.renameSync(temporaryPath, filePath);
}

/**
 * Tính summary từ danh sách orders
 * orders ở đây là mảng phẳng hoặc confirmedOrders object từ app hiện tại
 */
function calculateSessionSummary(orders) {
    let totalOrders = 0;
    let totalQuantity = 0;
    let totalRevenue = 0;

    if (Array.isArray(orders)) {
        totalOrders = orders.length;
        orders.forEach(o => {
            totalQuantity += (o.quantity || 1);
            totalRevenue += (o.total || o.price || 0);
        });
    } else if (typeof orders === 'object' && orders !== null) {
        // confirmedOrders format: { tiktokUsername: { items: [...], total: N } }
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

/**
 * Tính tổng theo sản phẩm (product summary)
 */
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

/**
 * Chuyển confirmedOrders (object) thành mảng orders phẳng để lưu
 */
function flattenConfirmedOrders(confirmedOrders) {
    const flat = [];
    Object.values(confirmedOrders).forEach(customer => {
        if (customer.items && Array.isArray(customer.items)) {
            const username = normalizeDisplayText(customer.username || '');
            const customerName = cleanDisplayText(customer.nickname || customer.displayName || '') || username;
            customer.items.forEach(item => {
                flat.push({
                    id: item.id || `order_${Date.now() + Math.random()}`,
                    customerName,
                    requestId: item.requestId || '',
                    sourceMessageId: item.sourceMessageId || '',
                    sourceBroadcasterId: item.sourceBroadcasterId || '',
                    customerUsername: username,
                    profilePictureUrl: customer.profilePictureUrl || '',
                    productName: normalizeDisplayText(item.text || ''),
                    quantity: 1,
                    price: item.price || 0,
                    total: item.price || 0,
                    note: '',
                    time: item.time || '',
                    createdAt: item.createdAt || null
                });
            });
        }
    });
    return flat;
}

function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

/**
 * Tạo phiên live mới cho user
 */
function createLiveSession(userId, data) {
    const sessions = readUserSessions(userId);

    // Chuyển confirmedOrders sang mảng phẳng nếu cần
    let orders = data.orders;
    if (orders && !Array.isArray(orders)) {
        orders = flattenConfirmedOrders(orders);
    } else if (Array.isArray(orders)) {
        // Đảm bảo mỗi order có id
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
        ? { ...calculatedSummary, ...data.summary }
        : calculatedSummary;
    const now = new Date().toISOString();

    const newSession = {
        id: data.id || generateSessionId(),
        userId,
        type: data.type || 'live_session',
        liveName: data.liveName || `Phiên live ${new Date().toLocaleDateString('vi-VN')}`,
        tiktokUsername: data.tiktokUsername || '',
        startedAt: data.startedAt || now,
        endedAt: data.endedAt === null ? null : (data.endedAt || now),
        createdAt: now,
        orders,
        summary
    };

    if (Array.isArray(data.sourceSessionIds)) {
        newSession.sourceSessionIds = data.sourceSessionIds;
    }

    if (sessions.some(session => session.id === newSession.id)) {
        throw new Error('ID phiên live đã tồn tại');
    }
    if (Array.isArray(data.segments)) newSession.segments = data.segments;
    sessions.unshift(newSession); // Mới nhất lên đầu
    writeUserSessions(userId, sessions);

    return newSession;
}

/**
 * Lấy 1 phiên live theo ID (chỉ của user)
 */
function getLiveSessionById(userId, sessionId) {
    const sessions = readUserSessions(userId);
    return sessions.find(s => s.id === sessionId) || null;
}

/**
 * Xóa 1 phiên live
 */
function deleteLiveSession(userId, sessionId) {
    let sessions = readUserSessions(userId);
    const index = sessions.findIndex(s => s.id === sessionId);
    if (index === -1) return false;
    sessions.splice(index, 1);
    writeUserSessions(userId, sessions);
    return true;
}

/**
 * Gộp nhiều phiên live → trả kết quả (không lưu)
 */
function mergeLiveSessions(userId, sessionIds) {
    const sessions = readUserSessions(userId);
    const selected = sessions.filter(s => sessionIds.includes(s.id));

    if (selected.length === 0) return null;

    const mergedOrders = [];
    const seenOrderIds = new Set();

    selected.forEach(session => {
        (session.orders || []).forEach(order => {
            // Tránh trùng order id
            if (order.id && seenOrderIds.has(order.id)) return;
            if (order.id) seenOrderIds.add(order.id);
            mergedOrders.push({ ...order, fromSession: session.liveName });
        });
    });

    const summary = calculateSessionSummary(mergedOrders);
    const productSummary = calculateProductSummary(mergedOrders);

    // Nhóm theo khách hàng
    const customerMap = {};
    mergedOrders.forEach(o => {
        const customerUsername = normalizeDisplayText(o.customerUsername || '');
        const customerName = normalizeDisplayName(o.customerName || '', customerUsername ? `@${customerUsername}` : undefined);
        const key = customerUsername || customerName || 'unknown';
        if (!customerMap[key]) {
            customerMap[key] = {
                customerName,
                customerUsername,
                profilePictureUrl: o.profilePictureUrl,
                orders: [],
                total: 0
            };
        }
        customerMap[key].orders.push(o);
        customerMap[key].total += (o.total || o.price || 0);
    });

    return {
        selectedSessions: selected.map(s => ({
            id: s.id,
            liveName: s.liveName,
            tiktokUsername: s.tiktokUsername,
            startedAt: s.startedAt,
            summary: s.summary
        })),
        summary: {
            totalSessions: selected.length,
            ...summary
        },
        mergedOrders,
        productSummary,
        customerSummary: Object.values(customerMap).sort((a, b) => b.total - a.total)
    };
}

function uniqueOrdersById(orders) {
    const seen = new Set();
    return (orders || []).filter(order => {
        const id = order?.id;
        if (id === undefined || id === null || seen.has(String(id))) return false;
        seen.add(String(id));
        return true;
    });
}

function rebuildSessionOrders(session) {
    return uniqueOrdersById((session.segments || []).flatMap(segment => segment.orders || []));
}

/** Update only an existing active history. Orders are the current run snapshot. */
function updateLiveSession(userId, sessionId, data) {
    const sessions = readUserSessions(userId);
    const session = sessions.find(s => s.id === sessionId);
    if (!session || session.endedAt || session.type !== 'live_session') {
        throw new Error('Không có phiên live đang hoạt động');
    }
    session.segments = Array.isArray(session.segments) ? session.segments : [];
    if (!session.segments.length) {
        session.segments.push({ startedAt: session.startedAt, endedAt: null, orders: session.orders || [] });
    }
    const segment = session.segments[session.segments.length - 1];
    if (data.orders !== undefined) {
        segment.orders = Array.isArray(data.orders) ? data.orders : flattenConfirmedOrders(data.orders);
        segment.summary = calculateSessionSummary(segment.orders);
        session.orders = rebuildSessionOrders(session);
        session.summary = calculateSessionSummary(session.orders);
    }
    if (data.endedAt) {
        session.endedAt = data.endedAt;
        if (!segment.endedAt) segment.endedAt = data.endedAt;
    }
    writeUserSessions(userId, sessions);
    return session;
}

/** One history, multiple runs. Closed runs keep immutable order snapshots.
 * Top-level orders are the cumulative history; each segment stores only its own run.
 */
function startLiveSession(userId, { broadcasterId, resumeSessionId, liveName, startedAt }) {
    const now = startedAt || new Date().toISOString();
    const segment = { startedAt: now, endedAt: null, orders: [], summary: calculateSessionSummary([]) };
    if (!resumeSessionId) {
        const created = createLiveSession(userId, {
            liveName, tiktokUsername: broadcasterId, startedAt: now, endedAt: null,
            orders: [], segments: [segment]
        });
        return { ...created, currentSegmentOrders: [] };
    }
    const sessions = readUserSessions(userId);
    const session = sessions.find(s => s.id === resumeSessionId);
    if (!session || session.tiktokUsername !== broadcasterId || session.type !== 'live_session') {
        throw new Error('Lịch sử không thuộc tài khoản hoặc chủ live này');
    }
    session.segments = session.segments || [];
    if (!session.segments.length || !session.endedAt) {
        const previous = session.segments[session.segments.length - 1];
        if (previous && !previous.endedAt) {
            previous.interruptedAt = now;
            previous.orders = previous.orders || session.orders || [];
            previous.summary = calculateSessionSummary(previous.orders);
        } else if (!previous) {
            session.segments.push({ startedAt: session.startedAt, endedAt: session.endedAt,
                ...(!session.endedAt ? { interruptedAt: now } : {}),
                orders: session.orders || [], summary: session.summary });
        }
    }
    // Older records stored cumulative snapshots in each segment. Convert each to
    // that run's delta by stable order ID so a resumed runtime starts empty.
    // Older records may have a top-level order absent from every segment snapshot.
    // Preserve it in the last historical segment before rebuilding the cumulative list.
    if (session.segments.length && Array.isArray(session.orders)) {
        const knownIds = new Set(session.segments.flatMap(prior => prior.orders || []).map(order => String(order?.id ?? '')));
        const missing = session.orders.filter(order => order?.id !== undefined && !knownIds.has(String(order.id)));
        session.segments[session.segments.length - 1].orders.push(...missing);
    }
    const seen = new Set();
    for (const prior of session.segments) {
        const snapshot = Array.isArray(prior.orders) ? prior.orders : [];
        prior.orders = snapshot.filter(order => {
            const key = String(order?.id ?? '');
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        prior.summary = calculateSessionSummary(prior.orders);
    }
    session.orders = rebuildSessionOrders(session);
    session.summary = calculateSessionSummary(session.orders);
    session.segments.push(segment);
    session.endedAt = null;
    session.lastStartedAt = now;
    sessions.splice(sessions.indexOf(session), 1);
    sessions.unshift(session);
    writeUserSessions(userId, sessions);
    return { ...session, currentSegmentOrders: [] };
}

module.exports = {
    startLiveSession,
    updateLiveSession,
    readUserSessions,
    writeUserSessions,
    createLiveSession,
    getLiveSessionById,
    deleteLiveSession,
    mergeLiveSessions,
    calculateSessionSummary,
    calculateProductSummary,
    flattenConfirmedOrders,
    getUserSessionFile
};
