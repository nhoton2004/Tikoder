/**
 * Live Session Store — lưu trữ lịch sử phiên live theo từng user (JSON file)
 * Mỗi user có 1 file riêng: data/live-sessions/{userId}.json
 */

const fs = require('fs');
const path = require('path');

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
        return data.sessions || [];
    } catch (e) {
        console.error(`Lỗi đọc file sessions của user ${userId}:`, e.message);
        return [];
    }
}

function writeUserSessions(userId, sessions) {
    const filePath = getUserSessionFile(userId);
    ensureDir();
    fs.writeFileSync(filePath, JSON.stringify({ sessions }, null, 2), 'utf-8');
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
            customer.items.forEach(item => {
                flat.push({
                    id: `order_${item.id || Date.now() + Math.random()}`,
                    customerName: customer.nickname || '',
                    customerUsername: customer.username || '',
                    profilePictureUrl: customer.profilePictureUrl || '',
                    productName: item.text || '',
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
            id: o.id || `order_${Date.now() + Math.random()}`
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
        id: generateSessionId(),
        userId,
        type: data.type || 'live_session',
        liveName: data.liveName || `Phiên live ${new Date().toLocaleDateString('vi-VN')}`,
        tiktokUsername: data.tiktokUsername || '',
        startedAt: data.startedAt || now,
        endedAt: data.endedAt || now,
        createdAt: now,
        orders,
        summary
    };

    if (Array.isArray(data.sourceSessionIds)) {
        newSession.sourceSessionIds = data.sourceSessionIds;
    }

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
        const key = o.customerUsername || o.customerName || 'unknown';
        if (!customerMap[key]) {
            customerMap[key] = {
                customerName: o.customerName,
                customerUsername: o.customerUsername,
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

module.exports = {
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
