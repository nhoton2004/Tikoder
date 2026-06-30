/**
 * Live Handler — Xử lý logic TikTok Live và Socket.io events
 * Tất cả các sự kiện socket liên quan đến live stream, chat, đơn hàng, in bill
 * đều được xử lý tại đây.
 */
const { WebcastPushConnection, SignConfig } = require('tiktok-live-connector');
const path = require('path');
const fs = require('fs');
const { cleanDisplayText, normalizeDisplayText } = require('../utils/displayName');

const liveRuntimeByUser = new Map();
const CHAT_BUFFER_LIMIT = 300;

function getLiveRuntime(userId) {
    if (!liveRuntimeByUser.has(userId)) {
        liveRuntimeByUser.set(userId, {
            userId,
            tiktokConnection: null,
            confirmedOrders: {},
            currentBroadcasterId: '',
            processedMsgIds: new Set(),
            chatBufferByBroadcaster: new Map(),
            sockets: new Set()
        });
    }
    return liveRuntimeByUser.get(userId);
}

function setupLiveHandler(io, ctx) {
    const {
        printBill, printDetailedBill, emitToUser, getUserRoom,
        saveSessionDataForUser, sanitizeConfirmedOrders, parsePrice,
        displayFallbackFromUsername, customerStore
    } = ctx;

    io.on('connection', (socket) => {
        const sessionUser = socket.request.session?.user;
        const userId = sessionUser?.uid;
        if (!userId) return socket.disconnect(true);

        const runtime = getLiveRuntime(userId);
        runtime.sockets.add(socket.id);
        socket.join(getUserRoom(userId));

        socket.emit('system-config', { printerInterface: ctx.printerInterface, tiktokSignApiKey: ctx.tiktokSignApiKey });

        socket.on('disconnect', () => {
            runtime.sockets.delete(socket.id);
            if (runtime.sockets.size === 0 && runtime.tiktokConnection) {
                // Đặt Grace Period 2 phút trước khi ngắt TikTok Live
                runtime.gracePeriodTimer = setTimeout(() => {
                    if (runtime.sockets.size > 0) return; // User đã reconnect thành công
                    console.log(`>>> Grace period expired for user ${userId}. Disconnecting TikTok Live.`);
                    try { runtime.tiktokConnection.disconnect(); } catch (e) {}
                    runtime.tiktokConnection = null;
                    
                    // Tự động lưu phiên vào Lịch sử
                    ctx.saveSessionDataForUser(userId);
                    ctx.internalSaveLiveSession(userId, runtime);
                }, 2 * 60 * 1000); // 2 phút
            }
        });

        socket.on('update-settings', (data) => {
            if (data.printerInterface !== undefined) {
                ctx.initPrinter(data.printerInterface);
            }
            if (data.tiktokSignApiKey !== undefined) {
                ctx.tiktokSignApiKey = data.tiktokSignApiKey;
                SignConfig.apiKey = data.tiktokSignApiKey;
                ctx.saveConfig();
            }
            socket.emit('system-status', "Đã cập nhật cấu hình hệ thống!");
        });

        socket.on('get-chat-buffer', ({ broadcasterId } = {}) => {
            const id = customerStore.normalizeTikTokUsername(broadcasterId);
            if (!id) return socket.emit('chat-buffer', { broadcasterId: '', comments: [] });
            const comments = runtime.chatBufferByBroadcaster.get(id) || [];
            socket.emit('chat-buffer', { broadcasterId: id, comments });
        });

        socket.on('start-live', (payload) => {
            const uniqueId = typeof payload === 'string' ? payload : (payload?.uniqueId || '');
            const clientSessionId = typeof payload === 'object' ? payload?.sessionId : null;

            const broadcasterId = customerStore.normalizeTikTokUsername(uniqueId);
            if (!broadcasterId) return socket.emit('status', { connected: false, error: 'TikTok ID không hợp lệ', broadcasterId: '' });

            // Huỷ Grace Period nếu đang chờ reconnect
            if (runtime.gracePeriodTimer) {
                clearTimeout(runtime.gracePeriodTimer);
                runtime.gracePeriodTimer = null;
                console.log(`>>> Grace period cancelled. User reconnected for user ${userId}.`);
            }

            // Kiểm tra xem có phải tiếp tục phiên cũ không
            const isContinuation = clientSessionId &&
                                   clientSessionId === runtime.sessionId &&
                                   broadcasterId === runtime.currentBroadcasterId;

            if (runtime.tiktokConnection) {
                try { runtime.tiktokConnection.disconnect(); } catch (e) {}
                runtime.tiktokConnection = null;
            }

            runtime.currentBroadcasterId = broadcasterId;

            if (isContinuation) {
                console.log(`>>> Resuming existing session ${runtime.sessionId} for user ${userId}`);
            } else {
                // Tự động lưu session cũ nếu đang có session khác hoạt động và có đơn hàng
                if (runtime.sessionId && Object.keys(runtime.confirmedOrders || {}).length > 0) {
                    ctx.saveSessionDataForUser(userId);
                    ctx.internalSaveLiveSession(userId, runtime);
                }
                
                // Khởi tạo phiên mới hoàn toàn
                runtime.sessionId = ctx.generateSessionId(broadcasterId);
                runtime.sessionStartedAt = new Date().toISOString();
                runtime.processedMsgIds.clear();
                
                // Thử load file ngày hôm nay hoặc hôm qua trước
                const fileName = ctx.getSessionFileName(userId, broadcasterId, null);
                if (fs.existsSync(fileName)) {
                    runtime.confirmedOrders = sanitizeConfirmedOrders(JSON.parse(fs.readFileSync(fileName)));
                } else {
                    runtime.confirmedOrders = {};
                }
            }

            // Gửi session-info về client
            socket.emit('session-info', {
                sessionId: runtime.sessionId,
                broadcasterId,
                startedAt: runtime.sessionStartedAt,
                isContinuation
            });

            emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);

            const userConnection = new WebcastPushConnection(broadcasterId);
            runtime.tiktokConnection = userConnection;

            userConnection.connect().then(state => {
                if (runtime.tiktokConnection !== userConnection) return;
                emitToUser(userId, 'status', { connected: true, roomId: state.roomId, broadcasterId });
            }).catch(err => {
                if (runtime.tiktokConnection !== userConnection) return;
                let errorMessage = "Lỗi không xác định";
                if (err && (err.name === 'SignatureRateLimitError' || (err.message && err.message.includes('rate_limit')))) {
                    errorMessage = "Đại ca ơi, TikTok nó chặn rồi (Rate Limit)! Đợi xíu tầm 1-2 phút rồi thử lại nhé.";
                } else if (err && err.message && err.message.includes('Unexpected server response: 200')) {
                    errorMessage = "Kết nối bị từ chối (200). Đại ca thử lại phát nữa xem!";
                } else {
                    errorMessage = (err && err.message) ? err.message : (err ? err.toString() : "Lỗi kết nối TikTok");
                }
                emitToUser(userId, 'status', { connected: false, error: errorMessage, broadcasterId });
            });

            userConnection.on('chat', (data) => {
                if (runtime.tiktokConnection !== userConnection) return;
                if (runtime.processedMsgIds.has(data.msgId)) return;
                runtime.processedMsgIds.add(data.msgId);
                setTimeout(() => runtime.processedMsgIds.delete(data.msgId), 120000);

                const commenterUsername = customerStore.normalizeTikTokUsername(data.uniqueId || data.username || '');
                const nickname = cleanDisplayText(data.nickname || data.displayName || '');
                const commentText = normalizeDisplayText(data.comment || '');
                const chatPayload = {
                    ...data,
                    broadcasterId,
                    uniqueId: commenterUsername || normalizeDisplayText(data.uniqueId || data.username || ''),
                    username: commenterUsername || normalizeDisplayText(data.username || data.uniqueId || ''),
                    nickname,
                    comment: commentText,
                    msgId: data.msgId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    suggestedPrice: parsePrice(commentText),
                    timestamp: Date.now()
                };

                const currentBuffer = runtime.chatBufferByBroadcaster.get(broadcasterId) || [];
                currentBuffer.push(chatPayload);
                if (currentBuffer.length > CHAT_BUFFER_LIMIT) currentBuffer.shift();
                runtime.chatBufferByBroadcaster.set(broadcasterId, currentBuffer);

                emitToUser(userId, 'raw-chat', chatPayload);
            });

            // Lắng nghe sự kiện stream kết thúc (khách xuống live)
            userConnection.on('streamEnd', (data) => {
                if (runtime.tiktokConnection !== userConnection) return;
                console.log(`>>> Stream ended for broadcaster: ${broadcasterId} (user: ${userId})`);

                // Auto-save dữ liệu phiên vào file history
                saveSessionDataForUser(userId);
                ctx.internalSaveLiveSession(userId, runtime);

                // Thông báo về client để auto-save và cập nhật UI, xoá session ID
                emitToUser(userId, 'live-ended', { broadcasterId, reason: data?.action || 'ended', clearSession: true });

                // Ngắt kết nối TikTok
                try { userConnection.disconnect(); } catch (e) {}
                if (runtime.tiktokConnection === userConnection) {
                    runtime.tiktokConnection = null;
                }
            });

            // Lắng nghe lỗi kết nối bất ngờ
            userConnection.on('disconnected', () => {
                if (runtime.tiktokConnection !== userConnection) return;
                emitToUser(userId, 'status', { connected: false, error: 'Mất kết nối với TikTok Live', broadcasterId });
            });
        }); // end socket.on('start-live')

        socket.on('confirm-item', (data) => {
            const username = customerStore.normalizeTikTokUsername(data.uniqueId || data.username || '');
            if (!username) return;
            const nickname = cleanDisplayText(data.nickname || data.displayName || '') || displayFallbackFromUsername(username) || username;
            const profilePictureUrl = normalizeDisplayText(data.profilePictureUrl || '');
            const comment = normalizeDisplayText(data.comment || '');
            const price = Number(data.price || 0);
            if (!runtime.confirmedOrders[username]) {
                runtime.confirmedOrders[username] = { username, nickname, profilePictureUrl, items: [], total: 0 };
            }
            const newItem = { id: Date.now() + Math.random(), text: comment, price, time: new Date().toLocaleTimeString('vi-VN') };
            runtime.confirmedOrders[username].items.push(newItem);
            runtime.confirmedOrders[username].total += price;
            saveSessionDataForUser(userId);
            emitToUser(userId, 'order-confirmed', runtime.confirmedOrders[username]);
            printBill(newItem, runtime.confirmedOrders[username], userId);
        });

        socket.on('replace-confirmed-orders', (payload = {}) => {
            runtime.confirmedOrders = sanitizeConfirmedOrders(payload.orders || {});
            const broadcasterId = customerStore.normalizeTikTokUsername(payload.broadcasterId || '');
            if (broadcasterId) {
                runtime.currentBroadcasterId = broadcasterId;
                saveSessionDataForUser(userId);
            }
            emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);
        });

        socket.on('delete-customer', (username) => {
            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            if (runtime.confirmedOrders[normalizedUsername]) {
                delete runtime.confirmedOrders[normalizedUsername];
                saveSessionDataForUser(userId);
                emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);
            }
        });

        socket.on('delete-item', ({ username, itemId }) => {
            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            if (runtime.confirmedOrders[normalizedUsername]) {
                const index = runtime.confirmedOrders[normalizedUsername].items.findIndex(i => i.id === itemId);
                if (index > -1) {
                    runtime.confirmedOrders[normalizedUsername].total -= runtime.confirmedOrders[normalizedUsername].items[index].price;
                    runtime.confirmedOrders[normalizedUsername].items.splice(index, 1);
                    if (runtime.confirmedOrders[normalizedUsername].items.length === 0) delete runtime.confirmedOrders[normalizedUsername];
                    saveSessionDataForUser(userId);
                    emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);
                }
            }
        });

        socket.on('edit-item', ({ username, itemId, text, price }) => {
            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            if (runtime.confirmedOrders[normalizedUsername]) {
                const item = runtime.confirmedOrders[normalizedUsername].items.find(i => i.id === itemId);
                if (item) {
                    const newPrice = Number(price);
                    runtime.confirmedOrders[normalizedUsername].total = runtime.confirmedOrders[normalizedUsername].total - Number(item.price || 0) + (Number.isFinite(newPrice) ? newPrice : Number(item.price || 0));
                    item.text = normalizeDisplayText(text || item.text || '');
                    if (Number.isFinite(newPrice)) item.price = newPrice;
                    saveSessionDataForUser(userId);
                    emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);
                }
            }
        });

        socket.on('edit-item-price', ({ username, itemId, newPrice }) => {
            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            if (runtime.confirmedOrders[normalizedUsername]) {
                const item = runtime.confirmedOrders[normalizedUsername].items.find(i => i.id === itemId);
                if (item) {
                    runtime.confirmedOrders[normalizedUsername].total = runtime.confirmedOrders[normalizedUsername].total - item.price + newPrice;
                    item.price = newPrice;
                    saveSessionDataForUser(userId);
                    emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);
                }
            }
        });

        socket.on('reprint-item', ({ username, itemId }) => {
            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            if (runtime.confirmedOrders[normalizedUsername]) {
                const item = runtime.confirmedOrders[normalizedUsername].items.find(i => i.id === itemId);
                if (item) printBill(item, runtime.confirmedOrders[normalizedUsername], userId);
            }
        });

        socket.on('reprint-total', (username) => {
            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            if (runtime.confirmedOrders[normalizedUsername]) {
                printDetailedBill(runtime.confirmedOrders[normalizedUsername], userId);
            }
        });

        socket.on('get-history-list', () => {
            const historyDir = path.join(ctx.HISTORY_ROOT_DIR, ctx.safeStorageId(userId));
            if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
            const userFiles = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter(f => f.endsWith('.json')) : [];

            const historyList = userFiles.map(f => {
                const stats = fs.statSync(path.join(historyDir, f));
                return { fileName: f, mtime: stats.mtime };
            });

            historyList.sort((a, b) => b.mtime - a.mtime);
            socket.emit('history-list', historyList);
        });

        socket.on('load-history-file', (fileName) => {
            const rawFileName = String(fileName || '');
            const isSharedFile = rawFileName.startsWith('shared:');
            const targetName = isSharedFile ? rawFileName.replace(/^shared:/, '') : rawFileName;
            const safeFileName = ctx.safeLegacyHistoryFileName(targetName);
            if (!safeFileName) return;
            const historyDir = isSharedFile ? ctx.HISTORY_ROOT_DIR : path.join(ctx.HISTORY_ROOT_DIR, ctx.safeStorageId(userId));
            const filePath = path.join(historyDir, safeFileName);
            if (!fs.existsSync(filePath)) return;
            runtime.confirmedOrders = sanitizeConfirmedOrders(JSON.parse(fs.readFileSync(filePath)));
            const match = safeFileName.match(/^(\d{4})-(\d{2})-(\d{2})_(.+)\.json$/);
            if (match) {
                runtime.currentBroadcasterId = customerStore.normalizeTikTokUsername(match[4]);
            }
            socket.emit('history-data', { fileName: isSharedFile ? `shared:${safeFileName}` : safeFileName, data: runtime.confirmedOrders });
        });
    });
}

module.exports = { setupLiveHandler, getLiveRuntime };
