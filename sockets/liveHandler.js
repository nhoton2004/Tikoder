/**
 * Live Handler — Xử lý logic TikTok Live và Socket.io events
 * Tất cả các sự kiện socket liên quan đến live stream, chat, đơn hàng, in bill
 * đều được xử lý tại đây.
 */
const { WebcastPushConnection, SignConfig } = require('tiktok-live-connector');
const path = require('path');
const fs = require('fs');
const { cleanDisplayText, normalizeDisplayText } = require('../utils/displayName');
const liveSessionStore = require('../utils/liveSessionStore');
const ChatConfirm = require('../public/js/chat-confirm');

const liveRuntimeByUser = new Map();
const CHAT_BUFFER_LIMIT = 300;

function getLiveRuntime(userId) {
    if (!liveRuntimeByUser.has(userId)) {
        liveRuntimeByUser.set(userId, {
            userId,
            tiktokConnection: null,
            confirmedOrders: {},
            manualConfirmedOrders: {}, // Cách ly cho mục Đơn hàng thủ công
            activeLoadedSessionId: null, // Session ID đang load ở mục Đơn hàng
            currentBroadcasterId: '',
            sessionId: null,
            sessionStartedAt: null,
            gracePeriodTimer: null,
            processedMsgIds: new Set(),
            chatBufferByBroadcaster: new Map(),
            chatSeqByBroadcaster: new Map(), // Sequence per broadcaster cho fallback msgId
            sockets: new Set(),
            recentConfirmKeys: new Map() // Lưu dedup key -> timestamp
        });
    }
    return liveRuntimeByUser.get(userId);
}

/**
 * Xử lý 1 comment chat đến: gán msgId ổn định, dedup theo stableMsgId,
 * đẩy vào buffer và broadcast raw-chat về client.
 */
function processIncomingChat(runtime, ctx, userConnection, broadcasterId, userId, data) {
    const {
        emitToUser, parsePrice, customerStore
    } = ctx;
    const clean = data;

    // Gán msgId ổn định + sequence fallback
    const seqMap = runtime.chatSeqByBroadcaster;
    let seq = seqMap.get(broadcasterId) || 0;
    seq += 1;
    seqMap.set(broadcasterId, seq);

    const stableMsg = {
        ...clean,
        uniqueId: clean.uniqueId || clean.username || '',
        username: clean.username || clean.uniqueId || '',
        nickname: clean.nickname || clean.displayName || '',
        comment: clean.comment || clean.text || '',
        createTime: clean.createTime || clean.timestamp || Date.now(),
        seq
    };
    const stableMsgId = ChatConfirm.ensureChatMessageId(stableMsg);

    // Dedup theo stableMsgId (không dùng raw msgId có thể rỗng/"0")
    if (runtime.processedMsgIds.has(stableMsgId)) return;
    runtime.processedMsgIds.add(stableMsgId);
    setTimeout(() => runtime.processedMsgIds.delete(stableMsgId), 120000);
    if (typeof runtime.resetIdleTimer === 'function') runtime.resetIdleTimer();

    const commenterUsername = customerStore.normalizeTikTokUsername(clean.uniqueId || clean.username || '');
    const nickname = cleanDisplayText(clean.nickname || clean.displayName || '');
    const commentText = normalizeDisplayText(clean.comment || '');
    const chatPayload = {
        ...clean,
        broadcasterId,
        uniqueId: commenterUsername || normalizeDisplayText(clean.uniqueId || clean.username || ''),
        username: commenterUsername || normalizeDisplayText(clean.username || clean.uniqueId || ''),
        nickname,
        comment: commentText,
        msgId: stableMsgId,
        sourceMsgId: stableMsgId,
        suggestedPrice: parsePrice(commentText),
        timestamp: Date.now()
    };

    const currentBuffer = runtime.chatBufferByBroadcaster.get(broadcasterId) || [];
    currentBuffer.push(chatPayload);
    if (currentBuffer.length > CHAT_BUFFER_LIMIT) currentBuffer.shift();
    runtime.chatBufferByBroadcaster.set(broadcasterId, currentBuffer);

    emitToUser(userId, 'raw-chat', chatPayload);
}

/**
 * Debounce flush DB: chờ 3 giây sau thao tác cuối mới ghi vào SQLite.
 * Giảm thải ghi đĩa trong khi vẫn đảm bảo dữ liệu được cập nhật.
 */
function scheduleDebouncedSave(userId, runtime, ctx) {
    if (runtime.saveDebouncedTimer) clearTimeout(runtime.saveDebouncedTimer);
    runtime.saveDebouncedTimer = setTimeout(() => {
        ctx.flushSessionToDb(userId, runtime);
        // Nếu đang load session lịch sử/thủ công, sync ngược về session gốc
        if (runtime.activeLoadedSessionId) {
            ctx.syncSessionOrders(userId, runtime.activeLoadedSessionId, runtime.manualConfirmedOrders);
        }
        runtime.saveDebouncedTimer = null;
    }, 1500); // 1.5s debounce — đủ nhanh cho cảm giác real-time
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

        // Auto-restore confirmed orders on reconnect (tablet -> laptop sync)
        const isLiveActive = !!runtime.tiktokConnection || !!runtime.gracePeriodTimer;
        if (isLiveActive) {
            if (Object.keys(runtime.confirmedOrders || {}).length > 0) {
                socket.emit('all-confirmed-orders', runtime.confirmedOrders);
            } else if (runtime.currentBroadcasterId) {
                // Thử load lại từ file ngày hôm nay (sau server crash/restart)
                const todayFile = ctx.getSessionFileName(userId, runtime.currentBroadcasterId, null);
                if (fs.existsSync(todayFile)) {
                    runtime.confirmedOrders = sanitizeConfirmedOrders(JSON.parse(fs.readFileSync(todayFile)));
                    if (Object.keys(runtime.confirmedOrders).length > 0) {
                        console.log(`>>> Auto-restored ${Object.keys(runtime.confirmedOrders).length} live orders after restart for user ${userId}`);
                        socket.emit('all-confirmed-orders', runtime.confirmedOrders);
                    }
                }
            }
        }

        // Đồng bộ manual confirmed orders cho client vừa reconnect
        socket.emit('manual-all-confirmed-orders', {
            data: runtime.manualConfirmedOrders || {},
            sessionId: runtime.activeLoadedSessionId || null
        });

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

                    // Flush lần cuối vào DB và lưu JSON backup
                    if (runtime.saveDebouncedTimer) {
                        clearTimeout(runtime.saveDebouncedTimer);
                        runtime.saveDebouncedTimer = null;
                    }
                    ctx.saveSessionDataForUser(userId);
                    ctx.flushSessionToDb(userId, runtime);
                    runtime.confirmedOrders = {};
                    runtime.currentDbSessionId = null;
                    runtime.currentBroadcasterId = null;
                    emitToUser(userId, 'all-confirmed-orders', {});
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
            socket.emit('system-config', { printerInterface: ctx.printerInterface, tiktokSignApiKey: ctx.tiktokSignApiKey });
        });

        socket.on('test-printer', async (payload = {}) => {
            const iface = payload.interface || ctx.printerInterface;
            try {
                if (iface && iface !== ctx.printerInterface) {
                    ctx.initPrinter(iface);
                }
                if (!ctx.printer) {
                    socket.emit('printer-test-result', { ok: false, message: 'Máy in chưa sẵn sàng. Kiểm tra cấu hình / driver.' });
                    return;
                }
                const connected = await ctx.printer.isPrinterConnected();
                if (!connected) {
                    socket.emit('printer-test-result', { ok: false, message: `Không kết nối được: ${iface}` });
                    return;
                }
                // In bill test ngắn
                ctx.printer.clear();
                ctx.printer.alignCenter();
                ctx.printer.println('TEST PRINTER OK');
                ctx.printer.println(String(iface || ''));
                ctx.printer.cut();
                await ctx.printer.execute();
                socket.emit('printer-test-result', { ok: true, message: `Kết nối OK: ${iface}` });
            } catch (err) {
                console.error('>>> test-printer failed:', err.message);
                socket.emit('printer-test-result', { ok: false, message: err.message || 'Lỗi test máy in' });
            }
        });

        socket.on('get-chat-buffer', ({ broadcasterId } = {}) => {
            const id = customerStore.normalizeTikTokUsername(broadcasterId);
            if (!id) return socket.emit('chat-buffer', { broadcasterId: '', comments: [] });
            const comments = runtime.chatBufferByBroadcaster.get(id) || [];
            socket.emit('chat-buffer', { broadcasterId: id, comments });
        });

        socket.on('stop-live', () => {
            console.log(`>>> Stop live requested by user ${userId}`);
            const oldBroadcasterId = runtime.currentBroadcasterId;
            if (runtime.tiktokConnection) {
                try { runtime.tiktokConnection.disconnect(); } catch (e) {}
                runtime.tiktokConnection = null;
            }
            // Flush and notify
            if (runtime.saveDebouncedTimer) {
                clearTimeout(runtime.saveDebouncedTimer);
                runtime.saveDebouncedTimer = null;
            }
            ctx.saveSessionDataForUser(userId);
            ctx.flushSessionToDb(userId, runtime);
            
            runtime.confirmedOrders = {};
            runtime.currentDbSessionId = null;
            runtime.currentBroadcasterId = null;
            emitToUser(userId, 'all-confirmed-orders', {});
            
            // Dọn session ID khỏi client khi người dùng chủ động ngắt kết nối
            emitToUser(userId, 'live-ended', { broadcasterId: oldBroadcasterId, reason: 'user_stopped', clearSession: true });
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
            let isContinuation = false;
            if (clientSessionId) {
                if (clientSessionId === runtime.sessionId && broadcasterId === runtime.currentBroadcasterId) {
                    isContinuation = true;
                } else {
                    // Thử khôi phục từ DB nếu server restart hoặc mất đồng bộ RAM
                    try {
                        const existingSession = liveSessionStore.getLiveSessionById(userId, clientSessionId);
                        if (existingSession) {
                            console.log(`>>> [Live] Khôi phục thành công phiên ${clientSessionId} từ DB cho user ${userId}`);
                            runtime.sessionId = clientSessionId;
                            runtime.currentDbSessionId = clientSessionId;
                            runtime.currentBroadcasterId = existingSession.tiktokUsername || broadcasterId;
                            runtime.sessionStartedAt = existingSession.startedAt;

                            // Khôi phục danh sách đơn chốt về RAM (dạng object key-value theo username)
                            const restoredOrders = {};
                            (existingSession.orders || []).forEach(o => {
                                const resolvedUsername = o.customerUsername || o.customerName || 'unknown';
                                const usernameKey = customerStore.normalizeTikTokUsername(resolvedUsername) || resolvedUsername;
                                if (!restoredOrders[usernameKey]) {
                                    restoredOrders[usernameKey] = {
                                        username: usernameKey,
                                        nickname: o.customerName || usernameKey,
                                        profilePictureUrl: o.profilePictureUrl || '',
                                        items: [],
                                        total: 0
                                    };
                                }
                                const itemPrice = Number(o.price || 0);
                                restoredOrders[usernameKey].items.push({
                                    id: o.id,
                                    text: o.productName,
                                    price: itemPrice,
                                    time: o.time || '',
                                    createdAt: o.createdAt
                                });
                                restoredOrders[usernameKey].total += itemPrice;
                            });
                            runtime.confirmedOrders = restoredOrders;
                            isContinuation = true;
                        }
                    } catch (err) {
                        console.error('>>> [LỖI] Khôi phục phiên từ DB thất bại:', err.message);
                    }
                }
            }

            if (runtime.tiktokConnection) {
                try { runtime.tiktokConnection.disconnect(); } catch (e) {}
                runtime.tiktokConnection = null;
            }

            runtime.currentBroadcasterId = broadcasterId;

            // Hủy bỏ các timer cũ (không có autoSaveTimer nữa)
            if (runtime.idleTimer) {
                clearTimeout(runtime.idleTimer);
                runtime.idleTimer = null;
            }
            if (runtime.saveDebouncedTimer) {
                clearTimeout(runtime.saveDebouncedTimer);
                runtime.saveDebouncedTimer = null;
            }

            const resetIdleTimer = () => {
                if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
                runtime.idleTimer = setTimeout(() => {
                    console.log(`>>> Idle timeout expired for user ${userId}. Ending live.`);
                    try { runtime.tiktokConnection.disconnect(); } catch (e) {}
                    runtime.tiktokConnection = null;
                    // Flush lần cuối vào DB
                    if (runtime.saveDebouncedTimer) {
                        clearTimeout(runtime.saveDebouncedTimer);
                        runtime.saveDebouncedTimer = null;
                    }
                    saveSessionDataForUser(userId);
                    ctx.flushSessionToDb(userId, runtime);
                    emitToUser(userId, 'live-ended', { broadcasterId, reason: 'idle_10m', clearSession: true });
                }, 10 * 60 * 1000);
            };

            const userConnection = new WebcastPushConnection(broadcasterId);
            runtime.tiktokConnection = userConnection;

            if (isContinuation) {
                console.log(`>>> Resuming existing session ${runtime.sessionId} for user ${userId}`);
            } else {
                // Flush phiên cũ nếu đang có session khác hoạt động và có đơn hàng
                if (runtime.sessionId && Object.keys(runtime.confirmedOrders || {}).length > 0) {
                    ctx.saveSessionDataForUser(userId);
                    ctx.flushSessionToDb(userId, runtime);
                    runtime.currentDbSessionId = null; // Reset để initLiveSession tạo mới
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

            userConnection.connect().then(state => {
                if (runtime.tiktokConnection !== userConnection) return;
                emitToUser(userId, 'status', { connected: true, roomId: state.roomId, broadcasterId });
                // Gửi lại danh sách đơn hàng đã khôi phục để đảm bảo client đồng bộ
                emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);
                // Tạo session record trong DB ngay khi connect thành công (chỉ 1 lần)
                if (!isContinuation) {
                    ctx.initLiveSession(userId, runtime, broadcasterId);
                }
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
                processIncomingChat(runtime, ctx, userConnection, broadcasterId, userId, data);
            });

            // Lắng nghe sự kiện stream kết thúc (khách xuống live)
            userConnection.on('streamEnd', (data) => {
                if (runtime.tiktokConnection !== userConnection) return;
                console.log(`>>> Stream ended for broadcaster: ${broadcasterId} (user: ${userId})`);

                // Flush lần cuối vào DB và lưu JSON backup
                if (runtime.saveDebouncedTimer) {
                    clearTimeout(runtime.saveDebouncedTimer);
                    runtime.saveDebouncedTimer = null;
                }
                saveSessionDataForUser(userId);
                ctx.flushSessionToDb(userId, runtime);

                 // Thông báo về client và ngắt kết nối TikTok
                 emitToUser(userId, 'live-ended', { broadcasterId, reason: data?.action || 'ended', clearSession: false });

                try { userConnection.disconnect(); } catch (e) {}
                if (runtime.tiktokConnection === userConnection) {
                    runtime.tiktokConnection = null;
                }
            });

            // Start idle từ lúc connect TikTok thành công
            if (typeof runtime.resetIdleTimer === 'function') runtime.resetIdleTimer();

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
            const isManual = !!data.isManual;
            const sourceMsgId = data.sourceMsgId || data.msgId || '';

            const target = isManual ? 'manualConfirmedOrders' : 'confirmedOrders';

            // Chặn bấm đúp: bỏ qua nếu trùng cả username, nội dung comment và giá trong vòng 1.2 giây
            if (!runtime.recentConfirmKeys) {
                runtime.recentConfirmKeys = new Map();
            }
            const dedupKey = `${username}|${comment}|${price}|${isManual}`;
            const lastTime = runtime.recentConfirmKeys.get(dedupKey);
            const now = Date.now();
            if (lastTime && (now - lastTime) < 1200) {
                console.log(`>>> [Dedup] Bỏ qua confirm-item trùng lặp cho ${username}: "${comment}" - ${price}đ (isManual: ${isManual})`);
                if (runtime[target][username]) {
                    emitToUser(userId, isManual ? 'manual-order-confirmed' : 'order-confirmed', runtime[target][username]);
                }
                return;
            }
            runtime.recentConfirmKeys.set(dedupKey, now);

            // Cleanup các key cũ hơn 10 giây để tránh phình bộ nhớ
            for (const [k, t] of runtime.recentConfirmKeys.entries()) {
                if (now - t > 10000) {
                    runtime.recentConfirmKeys.delete(k);
                }
            }

            if (!runtime[target][username]) {
                runtime[target][username] = { username, nickname, profilePictureUrl, items: [], total: 0 };
            }
            const nowIso = new Date().toISOString();
            const newItem = { 
                id: Date.now() + Math.random(), 
                text: comment, 
                price, 
                time: new Date().toLocaleTimeString('vi-VN'), 
                createdAt: nowIso,
                printed: true,
                printedAt: nowIso,
                sourceMsgId
            };
            runtime[target][username].items.push(newItem);
            runtime[target][username].total += price;

            if (!isManual) {
                // Live: Lưu JSON ngay, flush DB sau 1.5s
                saveSessionDataForUser(userId);
                scheduleDebouncedSave(userId, runtime, ctx);
                emitToUser(userId, 'order-confirmed', { ...runtime[target][username], sourceMsgId, item: newItem, itemId: String(newItem.id) });
                printBill(newItem, runtime[target][username], userId);
            } else {
                // Manual: flush DB sau 1.5s (syncSessionOrders sẽ ghi đè)
                scheduleDebouncedSave(userId, runtime, ctx);
                emitToUser(userId, 'manual-order-confirmed', { ...runtime[target][username], sourceMsgId, item: newItem, itemId: String(newItem.id) });
                printBill(newItem, runtime[target][username], userId);
            }
        });

        socket.on('replace-confirmed-orders', (payload = {}) => {
            const isManual = !!payload.isManual;
            const target = isManual ? 'manualConfirmedOrders' : 'confirmedOrders';

            runtime[target] = sanitizeConfirmedOrders(payload.orders || {});
            
            if (!isManual) {
                const broadcasterId = customerStore.normalizeTikTokUsername(payload.broadcasterId || '');
                if (broadcasterId) {
                    runtime.currentBroadcasterId = broadcasterId;
                    saveSessionDataForUser(userId);
                }
                emitToUser(userId, 'all-confirmed-orders', runtime[target]);
            } else {
                emitToUser(userId, 'manual-all-confirmed-orders', {
                    data: runtime[target],
                    sessionId: runtime.activeLoadedSessionId
                });
            }
        });

        socket.on('delete-customer', (payload) => {
            const username = typeof payload === 'string' ? payload : (payload?.username || '');
            const isManual = typeof payload === 'object' ? !!payload.isManual : false;
            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            const target = isManual ? 'manualConfirmedOrders' : 'confirmedOrders';

            if (runtime[target][normalizedUsername]) {
                delete runtime[target][normalizedUsername];
                if (!isManual) {
                    saveSessionDataForUser(userId);
                    scheduleDebouncedSave(userId, runtime, ctx);
                    emitToUser(userId, 'order-customer-deleted', { username: normalizedUsername });
                } else {
                    scheduleDebouncedSave(userId, runtime, ctx);
                    emitToUser(userId, 'manual-order-customer-deleted', { username: normalizedUsername });
                }
            }
        });

        socket.on('delete-item', (payload) => {
            const username = payload?.username || '';
            const itemId = payload?.itemId;
            const isManual = !!payload?.isManual;
            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            const target = isManual ? 'manualConfirmedOrders' : 'confirmedOrders';

            if (runtime[target][normalizedUsername]) {
                const index = runtime[target][normalizedUsername].items.findIndex(i => String(i.id) === String(itemId));
                if (index > -1) {
                    runtime[target][normalizedUsername].total -= runtime[target][normalizedUsername].items[index].price;
                    runtime[target][normalizedUsername].items.splice(index, 1);
                    if (runtime[target][normalizedUsername].items.length === 0) delete runtime[target][normalizedUsername];
                    
                    if (!isManual) {
                        saveSessionDataForUser(userId);
                        scheduleDebouncedSave(userId, runtime, ctx);
                        emitToUser(userId, 'order-item-deleted', { username: normalizedUsername, itemId });
                    } else {
                        scheduleDebouncedSave(userId, runtime, ctx);
                        emitToUser(userId, 'manual-order-item-deleted', { username: normalizedUsername, itemId });
                    }
                }
            }
        });

        socket.on('edit-item', (payload) => {
            const username = payload?.username || '';
            const itemId = payload?.itemId;
            const text = payload?.text || '';
            const price = payload?.price;
            const isManual = !!payload?.isManual;

            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            const target = isManual ? 'manualConfirmedOrders' : 'confirmedOrders';

            if (runtime[target][normalizedUsername]) {
                const item = runtime[target][normalizedUsername].items.find(i => String(i.id) === String(itemId));
                if (item) {
                    const newPrice = Number(price);
                    runtime[target][normalizedUsername].total = runtime[target][normalizedUsername].total - Number(item.price || 0) + (Number.isFinite(newPrice) ? newPrice : Number(item.price || 0));
                    item.text = normalizeDisplayText(text || item.text || '');
                    if (Number.isFinite(newPrice)) item.price = newPrice;
                    
                    if (!isManual) {
                        saveSessionDataForUser(userId);
                        scheduleDebouncedSave(userId, runtime, ctx);
                        emitToUser(userId, 'order-confirmed', runtime[target][normalizedUsername]);
                    } else {
                        scheduleDebouncedSave(userId, runtime, ctx);
                        emitToUser(userId, 'manual-order-confirmed', runtime[target][normalizedUsername]);
                    }
                }
            }
        });

        socket.on('edit-item-price', (payload) => {
            const username = payload?.username || '';
            const itemId = payload?.itemId;
            const newPrice = Number(payload?.newPrice || 0);
            const isManual = !!payload?.isManual;

            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            const target = isManual ? 'manualConfirmedOrders' : 'confirmedOrders';

            if (runtime[target][normalizedUsername]) {
                const item = runtime[target][normalizedUsername].items.find(i => String(i.id) === String(itemId));
                if (item) {
                    runtime[target][normalizedUsername].total = runtime[target][normalizedUsername].total - item.price + newPrice;
                    item.price = newPrice;
                    
                    if (!isManual) {
                        saveSessionDataForUser(userId);
                        scheduleDebouncedSave(userId, runtime, ctx);
                        emitToUser(userId, 'order-confirmed', runtime[target][normalizedUsername]);
                    } else {
                        scheduleDebouncedSave(userId, runtime, ctx);
                        emitToUser(userId, 'manual-order-confirmed', runtime[target][normalizedUsername]);
                    }
                }
            }
        });

        socket.on('reprint-item', (payload) => {
            const username = payload?.username || '';
            const itemId = payload?.itemId;
            const isManual = !!payload?.isManual;
            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            const target = isManual ? 'manualConfirmedOrders' : 'confirmedOrders';

            if (runtime[target][normalizedUsername]) {
                const item = runtime[target][normalizedUsername].items.find(i => String(i.id) === String(itemId));
                if (item) {
                    const printNowIso = new Date().toISOString();
                    item.printed = true;
                    item.printedAt = printNowIso;
                    printBill(item, runtime[target][normalizedUsername], userId);
                    if (!isManual) {
                        saveSessionDataForUser(userId);
                        scheduleDebouncedSave(userId, runtime, ctx);
                        emitToUser(userId, 'order-confirmed', runtime[target][normalizedUsername]);
                    } else {
                        scheduleDebouncedSave(userId, runtime, ctx);
                        emitToUser(userId, 'manual-order-confirmed', runtime[target][normalizedUsername]);
                    }
                }
            }
        });

        socket.on('reprint-total', (payload) => {
            const username = typeof payload === 'string' ? payload : (payload?.username || '');
            const isManual = typeof payload === 'object' ? !!payload.isManual : false;
            const normalizedUsername = customerStore.normalizeTikTokUsername(username);
            const target = isManual ? 'manualConfirmedOrders' : 'confirmedOrders';

            if (runtime[target][normalizedUsername]) {
                const printNowIso = new Date().toISOString();
                (runtime[target][normalizedUsername].items || []).forEach(i => {
                    i.printed = true;
                    i.printedAt = printNowIso;
                });
                printDetailedBill(runtime[target][normalizedUsername], userId);
                if (!isManual) {
                    saveSessionDataForUser(userId);
                    scheduleDebouncedSave(userId, runtime, ctx);
                    emitToUser(userId, 'order-confirmed', runtime[target][normalizedUsername]);
                } else {
                    scheduleDebouncedSave(userId, runtime, ctx);
                    emitToUser(userId, 'manual-order-confirmed', runtime[target][normalizedUsername]);
                }
            }
        });

        socket.on('get-history-list', () => {
            const safeId = ctx.safeStorageId(userId);
            const historyDir = path.join(ctx.HISTORY_ROOT_DIR, safeId);
            if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
            const userFiles = fs.readdirSync(historyDir).filter(f => f.endsWith('.json'));

            const historyList = userFiles.map(f => {
                const stats = fs.statSync(path.join(historyDir, f));
                return { fileName: f, mtime: stats.mtime };
            }).sort((a, b) => b.mtime - a.mtime);

            socket.emit('history-list', historyList);

            if (historyList.length > 0) {
                socket.emit('load-history-file', historyList[0].fileName);
            }
        });

         // Set active session khi user load đơn từ lịch sử
         socket.on('set-active-session', ({ sessionId } = {}) => {
             runtime.activeLoadedSessionId = sessionId || null;
             if (sessionId) {
                 console.log(`>>> User ${userId} đang làm việc với session manual: ${sessionId}`);
             }
         });

         // Tự động phục hồi trạng thái phiên làm việc khi reconnect/F5
         socket.on('restore-live-session', ({ sessionId } = {}) => {
             if (!sessionId) return;
             try {
                 const existingSession = liveSessionStore.getLiveSessionById(userId, sessionId);
                 if (existingSession) {
                     console.log(`>>> [Live] Tự động khôi phục phiên active ${sessionId} từ DB cho user ${userId}`);
                     runtime.sessionId = sessionId;
                     runtime.currentDbSessionId = sessionId;
                     runtime.sessionStartedAt = existingSession.startedAt;
                     if (existingSession.tiktokUsername) {
                         runtime.currentBroadcasterId = existingSession.tiktokUsername;
                     }

                     // Khôi phục danh sách đơn chốt về RAM
                     const restoredOrders = {};
                     (existingSession.orders || []).forEach(o => {
                         const resolvedUsername = o.customerUsername || o.customerName || 'unknown';
                         const usernameKey = customerStore.normalizeTikTokUsername(resolvedUsername) || resolvedUsername;
                         if (!restoredOrders[usernameKey]) {
                             restoredOrders[usernameKey] = {
                                 username: usernameKey,
                                 nickname: o.customerName || usernameKey,
                                 profilePictureUrl: o.profilePictureUrl || '',
                                 items: [],
                                 total: 0
                             };
                         }
                         const itemPrice = Number(o.price || 0);
                         restoredOrders[usernameKey].items.push({
                             id: o.id,
                             text: o.productName,
                             price: itemPrice,
                             time: o.time || '',
                             createdAt: o.createdAt
                         });
                         restoredOrders[usernameKey].total += itemPrice;
                     });
                     runtime.confirmedOrders = restoredOrders;

                     // Gửi lại danh sách đơn hàng đã khôi phục
                     socket.emit('all-confirmed-orders', runtime.confirmedOrders);
                     socket.emit('session-info', {
                         sessionId: runtime.sessionId,
                         broadcasterId: runtime.currentBroadcasterId,
                         startedAt: runtime.sessionStartedAt,
                         isContinuation: true
                     });
                 }
             } catch (err) {
                 console.error('>>> [LỖI] Tự động khôi phục phiên live thất bại:', err.message);
             }
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
            const rawData = JSON.parse(fs.readFileSync(filePath));
            
            // Cập nhật riêng cho manual session
            runtime.manualConfirmedOrders = sanitizeConfirmedOrders(rawData);
            runtime.activeLoadedSessionId = isSharedFile ? `legacy:shared:${safeFileName}` : `legacy:${safeFileName}`;
            
            const match = safeFileName.match(/^(\d{4})-(\d{2})-(\d{2})_(.+)\.json$/);
            if (match) {
                // Giữ nguyên broadcasterId nếu cần thiết cho config
                runtime.currentBroadcasterId = customerStore.normalizeTikTokUsername(match[4]);
            }
            
            socket.emit('manual-history-data', { 
                fileName: isSharedFile ? `shared:${safeFileName}` : safeFileName, 
                data: runtime.manualConfirmedOrders,
                sessionId: runtime.activeLoadedSessionId
            });
        });

        // Trả về runtime.confirmedOrders từ memory, không đọc disk
        socket.on('get-current-orders', () => {
            socket.emit('all-confirmed-orders', runtime.confirmedOrders);
        });
    });
}

module.exports = { setupLiveHandler, getLiveRuntime, liveRuntimeByUser };
