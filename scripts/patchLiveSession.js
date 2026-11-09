/**
 * Patch script v2: Fix live session history logic
 * Run: node scripts/patchLiveSession.js
 */

const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let src = fs.readFileSync(serverPath, 'utf8');

// Normalize line endings to LF for matching, then we'll preserve original
const CRLF = src.includes('\r\n');
let s = src.replace(/\r\n/g, '\n');

let patchCount = 0;

function patch(description, searchStr, replaceStr) {
    const search = searchStr.replace(/\r\n/g, '\n');
    const replace = replaceStr.replace(/\r\n/g, '\n');
    if (s.includes(search)) {
        s = s.replace(search, replace);
        console.log(`  ✅ ${description}`);
        patchCount++;
    } else {
        console.error(`  ❌ NOT FOUND: ${description}`);
        // Show nearby context
        const words = search.trim().split('\n')[0];
        const idx = s.indexOf(words.trim().substring(0, 40));
        if (idx >= 0) {
            console.log('  Context found at char', idx, ':', JSON.stringify(s.substring(idx, idx + 100)));
        }
        process.exit(1);
    }
}

console.log('\n🔧 Patching server.js...\n');

// ============================================================
// PATCH 1: Sua getSessionFileName
// ============================================================
patch(
    'getSessionFileName: add sessionId param + use id instead of date',
    `function getSessionFileName(userId, broadcasterId) {
    const date = new Date().toISOString().split('T')[0];
    const safeBroadcasterId = customerStore.normalizeTikTokUsername(broadcasterId) || 'unknown';
    return path.join(getUserHistoryDir(userId), \`\${date}_\${safeBroadcasterId}.json\`);
}`,
    `function getSessionFileName(userId, broadcasterId, sessionId) {
    const safeBroadcasterId = customerStore.normalizeTikTokUsername(broadcasterId) || 'unknown';
    const id = sessionId || ('sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
    return path.join(getUserHistoryDir(userId), \`\${id}_\${safeBroadcasterId}.json\`);
}`
);

// ============================================================
// PATCH 2: Sua createEmptyLiveRuntime
// ============================================================
patch(
    'createEmptyLiveRuntime: add currentSessionId + currentSessionStartedAt',
    `function createEmptyLiveRuntime(userId) {
    return {
        userId,
        tiktokConnection: null,
        confirmedOrders: {},
        currentBroadcasterId: '',
        processedMsgIds: new Set(),
        chatBufferByBroadcaster: new Map(),
        sockets: new Set()
    };
}`,
    `function createEmptyLiveRuntime(userId) {
    return {
        userId,
        tiktokConnection: null,
        confirmedOrders: {},
        currentBroadcasterId: '',
        currentSessionId: null,
        currentSessionStartedAt: null,
        processedMsgIds: new Set(),
        chatBufferByBroadcaster: new Map(),
        sockets: new Set()
    };
}`
);

// ============================================================
// PATCH 3: Sua resetLiveRuntime
// ============================================================
patch(
    'resetLiveRuntime: reset new fields',
    `    runtime.tiktokConnection = null;
    runtime.confirmedOrders = {};
    runtime.currentBroadcasterId = '';
    runtime.processedMsgIds.clear();
    runtime.chatBufferByBroadcaster.clear();
    runtime.sockets.clear();
    liveRuntimeByUser.delete(userId);
}`,
    `    runtime.tiktokConnection = null;
    runtime.confirmedOrders = {};
    runtime.currentBroadcasterId = '';
    runtime.currentSessionId = null;
    runtime.currentSessionStartedAt = null;
    runtime.processedMsgIds.clear();
    runtime.chatBufferByBroadcaster.clear();
    runtime.sockets.clear();
    liveRuntimeByUser.delete(userId);
}`
);

// ============================================================
// PATCH 4: Sua saveSessionDataForUser truyen sessionId
// ============================================================
patch(
    'saveSessionDataForUser: pass sessionId',
    `function saveSessionDataForUser(userId) {
    const runtime = getLiveRuntime(userId);
    if (!runtime.currentBroadcasterId) return;
    const fileName = getSessionFileName(userId, runtime.currentBroadcasterId);
    runtime.confirmedOrders = sanitizeConfirmedOrders(runtime.confirmedOrders);
    fs.writeFileSync(fileName, JSON.stringify(runtime.confirmedOrders, null, 2));
}`,
    `function saveSessionDataForUser(userId) {
    const runtime = getLiveRuntime(userId);
    if (!runtime.currentBroadcasterId) return;
    const fileName = getSessionFileName(userId, runtime.currentBroadcasterId, runtime.currentSessionId);
    runtime.confirmedOrders = sanitizeConfirmedOrders(runtime.confirmedOrders);
    fs.writeFileSync(fileName, JSON.stringify(runtime.confirmedOrders, null, 2));
}`
);

// ============================================================
// PATCH 5: Them helper functions truoc "if (fs.existsSync(CONFIG_FILE))"
// ============================================================
patch(
    'Add helper functions: formatLiveName, generateRuntimeSessionId, rebuildConfirmedOrders',
    `if (fs.existsSync(CONFIG_FILE)) {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE));`,
    `function formatLiveName(broadcasterId, startedAt) {
    const d = startedAt ? new Date(startedAt) : new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())].join('-');
    const time = [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(':');
    return \`\${date} \${time}_\${broadcasterId}\`;
}

function generateRuntimeSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

function rebuildConfirmedOrders(ordersArray) {
    const result = {};
    (ordersArray || []).forEach(order => {
        const username = order.customerUsername || order.tiktokUsername || '';
        if (!username) return;
        if (!result[username]) {
            result[username] = {
                username,
                nickname: order.customerName || username,
                profilePictureUrl: order.profilePictureUrl || '',
                items: [],
                total: 0
            };
        }
        const item = {
            id: order.id || (Date.now() + Math.random()),
            text: order.productName || order.text || '',
            price: order.price || order.total || 0,
            time: order.time || '',
            requestId: order.requestId || '',
            sourceMessageId: order.sourceMessageId || '',
            sourceBroadcasterId: order.sourceBroadcasterId || ''
        };
        result[username].items.push(item);
        result[username].total += item.price;
    });
    return result;
}

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE));`
);

// ============================================================
// PATCH 6: Sua event start-live
// ============================================================
patch(
    'start-live: support resumeSessionId + ask-resume-session',
    `    socket.on('start-live', (uniqueId) => {
        const broadcasterId = customerStore.normalizeTikTokUsername(uniqueId);
        if (!broadcasterId) {
            return socket.emit('status', { connected: false, error: 'TikTok ID không hợp lệ', broadcasterId: '' });
        }

        if (runtime.tiktokConnection) {
            try { runtime.tiktokConnection.disconnect(); } catch (e) {}
            runtime.tiktokConnection = null;
        }

        runtime.currentBroadcasterId = broadcasterId;
        runtime.processedMsgIds.clear();

        const fileName = getSessionFileName(userId, broadcasterId);
        if (fs.existsSync(fileName)) {
            runtime.confirmedOrders = sanitizeConfirmedOrders(JSON.parse(fs.readFileSync(fileName)));
        } else {
            runtime.confirmedOrders = {};
        }
        emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);`,
    `    socket.on('start-live', (payload) => {
        // payload co the la string (backward compatible) hoac object { uniqueId, resumeSessionId }
        const rawId = typeof payload === 'string' ? payload : payload?.uniqueId;
        // undefined = chua quyet dinh, null = tao moi, string = resume session cu
        const resumeSessionId = (typeof payload === 'object' && payload !== null)
            ? payload.resumeSessionId
            : undefined;

        const broadcasterId = customerStore.normalizeTikTokUsername(rawId);
        if (!broadcasterId) {
            return socket.emit('status', { connected: false, error: 'TikTok ID không hợp lệ', broadcasterId: '' });
        }

        if (runtime.tiktokConnection) {
            try { runtime.tiktokConnection.disconnect(); } catch (e) {}
            runtime.tiktokConnection = null;
        }

        // Neu chua co quyet dinh (resumeSessionId === undefined), kiem tra session chua ket thuc
        if (resumeSessionId === undefined) {
            const allSessions = liveSessionStore.readUserSessions(userId);
            const lastSession = allSessions.find(s =>
                s.tiktokUsername === broadcasterId && !s.endedAt
            );
            if (lastSession) {
                return socket.emit('ask-resume-session', {
                    broadcasterId,
                    session: {
                        id: lastSession.id,
                        liveName: lastSession.liveName,
                        startedAt: lastSession.startedAt,
                        summary: lastSession.summary || { totalOrders: 0, totalRevenue: 0 }
                    }
                });
            }
        }

        const now = new Date();

        if (resumeSessionId) {
            // Resume phien cu
            const oldSession = liveSessionStore.getLiveSessionById(userId, resumeSessionId);
            if (oldSession) {
                runtime.confirmedOrders = rebuildConfirmedOrders(oldSession.orders || []);
                runtime.currentSessionId = resumeSessionId;
                runtime.currentSessionStartedAt = oldSession.startedAt || now.toISOString();
            } else {
                runtime.confirmedOrders = {};
                runtime.currentSessionId = generateRuntimeSessionId();
                runtime.currentSessionStartedAt = now.toISOString();
            }
        } else {
            // Tao session moi
            runtime.confirmedOrders = {};
            runtime.currentSessionId = generateRuntimeSessionId();
            runtime.currentSessionStartedAt = now.toISOString();
        }

        runtime.currentBroadcasterId = broadcasterId;
        runtime.processedMsgIds.clear();
        emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);`
);

// ============================================================
// PATCH 7: Them event end-live truoc confirm-item
// ============================================================
patch(
    'Add end-live event handler',
    `    socket.on('confirm-item', (data = {}, acknowledge) => {`,
    `    socket.on('end-live', () => {
        const now = new Date();
        const hasOrders = !!runtime.currentBroadcasterId &&
            Object.keys(runtime.confirmedOrders).length > 0 &&
            Object.values(runtime.confirmedOrders).some(c => (c.items || []).length > 0);

        if (runtime.tiktokConnection) {
            try { runtime.tiktokConnection.disconnect(); } catch (e) {}
            runtime.tiktokConnection = null;
        }

        const prevBroadcasterId = runtime.currentBroadcasterId;

        if (!hasOrders) {
            runtime.confirmedOrders = {};
            runtime.currentSessionId = null;
            runtime.currentSessionStartedAt = null;
            runtime.currentBroadcasterId = '';
            emitToUser(userId, 'all-confirmed-orders', {});
            emitToUser(userId, 'status', { connected: false, broadcasterId: prevBroadcasterId, error: '' });
            return socket.emit('session-ended', { saved: false });
        }

        try {
            const liveName = formatLiveName(runtime.currentBroadcasterId, runtime.currentSessionStartedAt);
            const sessionId = runtime.currentSessionId;

            // Neu session nay da duoc tao truoc (endedAt = null) thi xoa truoc khi tao lai
            if (sessionId) {
                const existing = liveSessionStore.getLiveSessionById(userId, sessionId);
                if (existing && !existing.endedAt) {
                    liveSessionStore.deleteLiveSession(userId, sessionId);
                }
            }

            const session = liveSessionStore.createLiveSession(userId, {
                id: sessionId || undefined,
                liveName,
                tiktokUsername: prevBroadcasterId,
                startedAt: runtime.currentSessionStartedAt || now.toISOString(),
                endedAt: now.toISOString(),
                orders: runtime.confirmedOrders
            });

            // Xoa file tam neu ton tai
            try {
                const tempFile = getSessionFileName(userId, prevBroadcasterId, sessionId);
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) {}

            runtime.confirmedOrders = {};
            runtime.currentSessionId = null;
            runtime.currentSessionStartedAt = null;
            runtime.currentBroadcasterId = '';

            emitToUser(userId, 'all-confirmed-orders', {});
            emitToUser(userId, 'status', { connected: false, broadcasterId: prevBroadcasterId, error: '' });
            console.log(\`>>> Da luu phien live "\${session.liveName}" cho user \${userId} (\${session.summary.totalOrders} don)\`);
            socket.emit('session-ended', { saved: true, session });
        } catch (error) {
            console.error('Loi luu phien live khi end-live:', error);
            socket.emit('session-ended', { saved: false, error: error.message });
        }
    });

    socket.on('confirm-item', (data = {}, acknowledge) => {`
);

// ============================================================
// Restore original line endings if needed
// ============================================================
if (CRLF) {
    s = s.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

console.log(`\n✨ All ${patchCount}/7 patches applied successfully!\n`);
fs.writeFileSync(serverPath, s, 'utf8');
console.log('📝 server.js saved.\n');
