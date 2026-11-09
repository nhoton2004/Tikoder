require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection, SignConfig } = require('tiktok-live-connector');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require("node-thermal-printer");
const admin = require('firebase-admin');
const session = require('express-session');
const liveSessionStore = require('./utils/liveSessionStore');
const customerStore = require('./utils/customerStore');
const quoteQueue = require('./utils/quoteQueue');
const historyWorkspace = require('./utils/historyOrderWorkspace');
const n8nNotifications = require('./utils/n8nNotifications');
const n8nZaloDispatch = require('./utils/n8nZaloDispatch');
const zaloWeb = require('./utils/zaloWebExperimental');
const zaloAutoReply = require('./utils/zaloAutoReplyService').createService();
const zaloAutoReplyRoutes = require('./routes/zaloAutoReply');
const orderExcelExporter = require('./utils/orderExcelExporter');
const { cleanDisplayText, normalizeDisplayName, normalizeDisplayText } = require('./utils/displayName');
const adminRoutes = require('./routes/admin');

// DEV ONLY: Bật để bỏ qua đăng nhập Firebase trong môi trường local/dev.
// SECURITY: NEVER enable in production. Must be explicitly set AND in development environment.
const DEV_SKIP_AUTH = process.env.NODE_ENV === 'development' 
    && String(process.env.VITE_DEV_SKIP_AUTH || 'false').toLowerCase() === 'true';

if (DEV_SKIP_AUTH) {
    console.warn('⚠️  WARNING: DEV_SKIP_AUTH is ENABLED. This bypasses Firebase authentication.');
    console.warn('⚠️  This should NEVER be enabled in production.');
}
const DEV_USER = {
    uid: 'dev-user',
    email: 'dev@local.test',
    name: 'Dev User',
    displayName: 'Dev User',
    picture: '',
    provider: 'dev-bypass',
    role: 'admin',
    permissions: []
};

let serviceAccount;
try {
    serviceAccount = JSON.parse(fs.readFileSync(process.env.FIREBASE_CREDENTIALS_FILE || path.join(__dirname, 'firebase-service-account.json'), 'utf8'));
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin initialized.");
} catch (e) {
    if (process.env.NODE_ENV === 'production') throw new Error('Valid Firebase credentials are required in production');
    console.warn("Could not load firebase-service-account.json. Firebase Auth will fail.");
}

const app = express();
let shuttingDown = false;
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY.split(',').map(value => value.trim()).filter(Boolean));
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
const corsOptions = allowedOrigins.length ? { origin: allowedOrigins, credentials: true } : {};
app.use(cors(corsOptions));
app.get('/healthz', (_req, res) => res.status(shuttingDown ? 503 : 200).json({ status: shuttingDown ? 'stopping' : 'ok' }));
app.use((_req, res, next) => shuttingDown ? res.status(503).json({ error: 'Server is stopping' }) : next());
// Register signed raw-body callbacks before the global JSON parser.
app.use('/api/integrations/n8n/zalo-auto-reply', zaloAutoReplyRoutes.createIntegrationRouter(zaloAutoReply));
// n8n forwards the exact request bytes here for HMAC verification.
app.post('/api/integrations/n8n/verify', express.raw({ type: 'application/json', limit: '64kb' }), (req, res) => {
    const crypto = require('crypto');
    const secret = process.env.N8N_NOTIFY_SECRET;
    const timestamp = String(req.get('x-tikoder-timestamp') || '');
    const signature = String(req.get('x-tikoder-signature') || '');
    if (!secret || !Buffer.isBuffer(req.body) || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !/^sha256=[0-9a-f]{64}$/.test(signature)) return res.status(401).json({ error: 'Xác thực thất bại' });
    const expected = crypto.createHmac('sha256', secret).update(timestamp + '.').update(req.body).digest();
    const actual = Buffer.from(signature.slice(7), 'hex');
    if (!crypto.timingSafeEqual(expected, actual)) return res.status(401).json({ error: 'Xác thực thất bại' });
    try {
        const event = JSON.parse(req.body.toString('utf8'));
        if (!event.eventId || req.get('x-tikoder-event-id') !== event.eventId || !['quote.pending_approval', 'quote.send_requested'].includes(event.eventType)) return res.status(400).json({ error: 'Sự kiện không hợp lệ' });
        if (event.eventType === 'quote.send_requested') {
            if (process.env.ZALO_WEB_EXPERIMENTAL !== 'true' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.status(403).json({ error: 'Chế độ thử chỉ cho phép máy cục bộ' });
            let request;
            try { request = quoteQueue.findZaloEvent(event.tenantId, event.eventId, event.deliveryId); } catch (e) { return res.status(e.status || 400).json({ error: 'Không tìm thấy yêu cầu' }); }
            if (request.delivery.status !== 'queued') return res.json({ status: request.delivery.status });
            if (!zaloWeb.isOpen(request.uid)) return res.status(409).json({ error: 'Zalo Web chưa mở' });
            const allowed = String(process.env.ZALO_TEST_PHONES || '').split(',').map(x => x.trim()).filter(Boolean);
            let claimed;
            try { claimed = quoteQueue.claimZalo(request.uid, event.deliveryId, allowed); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
            res.status(202).json({ status: 'accepted', eventId: event.eventId });
            const guard = () => {
                const current = customerStore.getCustomerById(request.uid, request.quote.customerId);
                const phone = String(current?.contact?.zaloPhone || current?.phone || '').replace(/[\s().-]/g, '');
                if (!current || current.consent?.quoteMessages !== 'granted' || current.consent?.optedOutAt || phone !== claimed.phone) throw new Error('Thông tin khách đã thay đổi');
            };
            zaloWeb.send(request.uid, claimed.phone, claimed.delivery.zaloName, claimed.delivery.renderedText, guard)
                .catch(() => {})
                .finally(() => { try { quoteQueue.markZaloNeedsCheck(request.uid, event.deliveryId); } catch (_) {} });
            return;
        }
        res.json({ eventId: event.eventId, eventType: event.eventType, tenantId: event.tenantId, summary: event.summary, appUrl: event.appUrl });
    } catch (_) { res.status(400).json({ error: 'Sự kiện không hợp lệ' }); }
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// SECURITY: SESSION_SECRET is required in .env
if (!process.env.SESSION_SECRET) {
    console.error('❌ FATAL: SESSION_SECRET must be set in .env file');
    process.exit(1);
}
if (process.env.NODE_ENV === 'production' && (process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.startsWith('your_'))) {
    throw new Error('Production SESSION_SECRET must be a random secret of at least 32 characters');
}

const sessionStore = process.env.SESSION_STORE === 'sqlite'
    ? new (require('./utils/sqliteSessionStore').SqliteSessionStore)(path.resolve(process.env.SESSION_DB_PATH || path.join(__dirname, 'data', 'sessions.sqlite')), { ttl: Number(process.env.SESSION_TIMEOUT || 86400000) })
    : undefined;
if (sessionStore) sessionStore.on('error', error => console.error('Session store error:', error.message));
const sessionMiddleware = session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // HTTPS in production
        httpOnly: true,
        sameSite: 'strict',
        maxAge: null // Will be set dynamically based on rememberMe
    }
});
app.use(sessionMiddleware);

// DEV ONLY: tự inject session user giả để test nhanh không cần login.
function ensureDevSession(req, _res, next) {
    if (DEV_SKIP_AUTH && req.session && !req.session.user) {
        req.session.user = { ...DEV_USER };
    }
    next();
}
app.use(ensureDevSession);

app.get('/login', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/app');
    }
    if (DEV_SKIP_AUTH) {
        return res.redirect('/app');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get([
    '/',
    '/index.html',
    '/pricing',
    '/pricing.html',
    '/demo',
    '/demo.html',
    '/contact',
    '/contact.html'
], (_req, res) => {
    res.redirect('/login');
});

// --- Hàm kiểm tra email có quyền truy cập ---
function isEmailAllowed(email) {
    const allowRegister = (process.env.ALLOW_REGISTER || 'true').toLowerCase() === 'true';
    if (allowRegister) return true;

    // Nếu không cho đăng ký tự do, chỉ cho phép email trong danh sách admin
    const adminEmailsStr = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '';
    if (!adminEmailsStr) return true; // Nếu không cấu hình thì cho phép tất cả
    const adminEmails = adminEmailsStr.split(',').map(e => e.trim().toLowerCase());
    return adminEmails.includes(email.toLowerCase());
}

app.post('/sessionLogin', async (req, res) => {
    const idToken = req.body.idToken;
    const rememberMe = req.body.rememberMe === true; // Get rememberMe flag
    console.log(">>> Nhận yêu cầu đăng nhập, đang xác thực token...");
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const email = decodedToken.email;
        console.log(">>> Token hợp lệ! Email:", email, "| Provider:", decodedToken.firebase?.sign_in_provider, "| Role:", decodedToken.role || 'user');

        if (!isEmailAllowed(email)) {
            console.error(">>> LỖI: Email không có trong danh sách được phép.");
            return res.status(403).json({ message: 'Tài khoản này không có quyền truy cập' });
        }

        // Kiểm tra tài khoản có bị khóa không
        const userRecord = await admin.auth().getUser(decodedToken.uid);
        if (userRecord.disabled) {
            return res.status(403).json({ message: 'Tài khoản đã bị khóa. Vui lòng liên hệ Admin.' });
        }

        const providerPhoto = Array.isArray(userRecord.providerData)
            ? (userRecord.providerData.find(p => p?.providerId === 'google.com' && p?.photoURL)?.photoURL || '')
            : '';
        const displayName = userRecord.displayName || decodedToken.name || '';
        const picture = userRecord.photoURL || decodedToken.picture || providerPhoto || '';

        req.session.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            name: displayName,
            picture,
            provider: decodedToken.firebase?.sign_in_provider || '',
            role: decodedToken.role || 'user',
            permissions: decodedToken.permissions || []
        };
        
        // Set cookie maxAge based on rememberMe
        if (rememberMe) {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
            console.log(">>> Remember Me: Session will last 30 days");
        } else {
            req.session.cookie.maxAge = null; // Session cookie (expires on browser close)
            console.log(">>> Remember Me: Session cookie (browser close)");
        }
        
        console.log(">>> Đăng nhập thành công! Role:", req.session.user.role);
        res.json({ success: true });
    } catch (error) {
        console.error(">>> LỖI XÁC THỰC FIREBASE ADMIN:", error.message);
        res.status(401).json({ error: 'Xác thực thất bại: ' + error.message });
    }
});

// --- API kiểm tra user hiện tại ---
app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) {
        return res.json({ loggedIn: true, user: req.session.user, devSkipAuth: DEV_SKIP_AUTH });
    }
    res.json({ loggedIn: false, devSkipAuth: DEV_SKIP_AUTH });
});

app.post('/logout', (req, res) => {
    const userId = req.session?.user?.uid;
    req.session.destroy(() => {
        if (userId) {
            const userRoom = getUserRoom(userId);
            emitToUser(userId, 'all-confirmed-orders', {});
            emitToUser(userId, 'status', { connected: false, broadcasterId: '', error: '' });
            io.in(userRoom).fetchSockets().then(sockets => {
                sockets.forEach(sock => sock.disconnect(true));
            }).catch(() => {});
            // Logging out closes browser sockets, not the TikTok live run.
        }
        res.json({ success: true });
    });
});

const requireLogin = (req, res, next) => {
    const isPublicAsset =
        req.path.startsWith('/fonts/') ||
        req.path === '/favicon.ico' ||
        req.path === '/css/marketing-pages.css' ||
        req.path === '/js/marketing.js';
    if (isPublicAsset) return next();
    if (
        req.path === '/login' ||
        req.path === '/sessionLogin' ||
        req.path === '/api/me'
    ) return next();
    if (req.path === '/logout') return next();
    if (req.session && req.session.user) {
        return next();
    }
    // API requests trả 401, page requests redirect
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Chưa đăng nhập' });
    }
    res.redirect('/login');
};
app.use(requireLogin);

// ============================================================
// === API LỊCH SỬ PHIÊN LIVE (per-user, bảo mật theo uid) ===
// ============================================================

// Middleware kiểm tra đăng nhập cho API
const requireApiAuth = (req, res, next) => {
    if (!req.session || !req.session.user || !req.session.user.uid) {
        return res.status(401).json({ error: 'Chưa đăng nhập' });
    }
    next();
};

app.use('/api/zalo-auto-reply', zaloAutoReplyRoutes.createUiRouter(zaloAutoReply, requireApiAuth));

// Quote operations are synchronous, so each read-modify-write is serialized in this process.
app.use('/api/quotes', requireApiAuth, (req, res, next) => {
    if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.get('origin');
        if (!origin || origin !== req.protocol + '://' + req.get('host')) return res.status(403).json({ error: 'Origin không hợp lệ' });
    }
    next();
});
function quoteHandler(fn) { return (req, res) => { try { res.json(fn(req)); } catch (e) { if (!e.status) console.error('Lỗi báo giá:', e.message); res.status(e.status || 500).json({ error: e.status ? e.message : 'Không thể xử lý báo giá' }); } }; }
app.get('/api/quotes', quoteHandler(req => {
    const uid = req.session.user.uid, data = quoteQueue.read(uid);
    return { ...data, customers: customerStore.listCustomers(uid) };
}));
app.post('/api/quotes', quoteHandler(req => {
    const uid = req.session.user.uid, username = customerStore.normalizeTikTokUsername(req.body?.username);
    let order;
    if (req.body?.items !== undefined) {
        const customer = customerStore.getCustomerById(uid, req.body.customerId);
        if (!customer) historyWorkspace.fail('Không tìm thấy khách hàng', 404);
        const items = req.body.items;
        if (!Array.isArray(items)) historyWorkspace.fail('Danh sách món không hợp lệ');
        return { quote: quoteQueue.create(uid, customer, { items: items.map(i => ({ text: i.label, price: i.amount })), shippingNote: req.body.shippingNote }) };
    }
    if (req.body?.source) {
        const source = readHistoryWorkspace(req.session.user, req.body.source.sessionId);
        historyWorkspace.checkVersion(source.orders, req.body.source.revision);
        const selected = source.orders.filter(o => customerStore.normalizeTikTokUsername(o.customerUsername) === username);
        order = { nickname: selected[0]?.customerName, items: selected.map(o => ({ id: o.id, text: o.productName, price: o.total ?? o.price })) };
    } else order = getLiveRuntime(uid).confirmedOrders[username];
    if (!order || !order.items?.length) { const e = new Error('Không tìm thấy đơn đang hiển thị'); e.status = 404; throw e; }
    let customer = customerStore.findCustomerByTikTok(uid, username);
    if (!customer) customer = customerStore.createCustomer(uid, { tiktokUsername: username, displayName: order.nickname || username });
    return { quote: quoteQueue.create(uid, customer, order) };
}));
app.delete('/api/quotes/:id', quoteHandler(req => quoteQueue.remove(req.session.user.uid, req.params.id, req.body?.version)));
app.patch('/api/quotes/:id', quoteHandler(req => ({ quote: quoteQueue.patch(req.session.user.uid, req.params.id, req.body || {}) })));
app.post('/api/quotes/:id/approve', quoteHandler(req => {
    if (req.body?.autoName !== undefined && (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !zaloWeb.isOpen(req.session.user.uid))) { const e = new Error('Hãy mở Zalo Web thử nghiệm trên máy này trước'); e.status = 400; throw e; }
    return { delivery: quoteQueue.approve(req.session.user.uid, req.params.id, req.body?.channel, req.body?.text, req.body?.autoName, req.body?.version) };
}));
app.post('/api/quotes/:id/cancel', quoteHandler(req => ({ quote: quoteQueue.cancel(req.session.user.uid, req.params.id, req.body?.version) })));
app.post('/api/quotes/delivery/:id', quoteHandler(req => ({ delivery: quoteQueue.delivery(req.session.user.uid, req.params.id, req.body?.action, req.body?.reason) })));
function requireLocalZaloExperiment(req, res, next) {
    const remote = req.socket.remoteAddress;
    if (process.env.ZALO_WEB_EXPERIMENTAL !== 'true' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return res.status(403).json({ error: 'Chế độ thử Zalo chỉ dành cho máy cục bộ' });
    next();
}
app.post('/api/quotes/zalo/open', requireLocalZaloExperiment, async (req, res) => {
    try { await zaloWeb.open(req.session.user.uid); res.json({ success: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
});

function isAdminOrSuperAdmin(user) {
    const role = String(user?.role || '').toLowerCase();
    return role === 'admin' || role === 'super_admin';
}

function buildScopedLiveSessionId(ownerUserId, sessionId) {
    return `user:${encodeURIComponent(ownerUserId)}:${sessionId}`;
}

function parseScopedLiveSessionId(sessionId) {
    const match = String(sessionId || '').match(/^user:([^:]+):(.+)$/);
    if (!match) return null;
    return {
        ownerUserId: decodeURIComponent(match[1]),
        sessionId: match[2]
    };
}

function readAllStoredLiveSessions() {
    if (!fs.existsSync(LIVE_SESSIONS_DIR)) return [];
    return fs.readdirSync(LIVE_SESSIONS_DIR)
        .filter(fileName => fileName.endsWith('.json'))
        .flatMap(fileName => {
            const ownerUserId = fileName.replace(/\.json$/i, '');
            const fullPath = path.join(LIVE_SESSIONS_DIR, fileName);
            try {
                const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
                return sessions.map(session => ({
                    ...session,
                    ownerUserId: session.userId || ownerUserId,
                    rawSessionId: session.id
                }));
            } catch (error) {
                console.error(`Lỗi đọc file live session ${fileName}:`, error.message);
                return [];
            }
        });
}

function formatVisibleLiveSession(session, currentUser, includeOwnerScope = false) {
    const ownerUserId = session.ownerUserId || session.userId || currentUser.uid;
    const rawSessionId = session.rawSessionId || session.id;
    const scopedId = includeOwnerScope ? buildScopedLiveSessionId(ownerUserId, rawSessionId) : rawSessionId;
    return {
        ...session,
        id: scopedId,
        rawSessionId,
        ownerUserId,
        isAdminVisible: ownerUserId !== currentUser.uid,
        source: session.type === 'merged_session' ? 'merged_session' : 'live_session'
    };
}

function readVisibleStoredLiveSessions(currentUser) {
    const includeAllUsers = isAdminOrSuperAdmin(currentUser);
    const sessions = includeAllUsers
        ? readAllStoredLiveSessions()
        : liveSessionStore.readUserSessions(currentUser.uid).map(session => ({
            ...session,
            ownerUserId: currentUser.uid,
            rawSessionId: session.id
        }));
    return sessions.map(session => formatVisibleLiveSession(session, currentUser, includeAllUsers));
}

function getVisibleStoredLiveSession(currentUser, sessionId) {
    const scopedRef = parseScopedLiveSessionId(sessionId);
    if (scopedRef) {
        if (scopedRef.ownerUserId !== currentUser.uid && !isAdminOrSuperAdmin(currentUser)) {
            return null;
        }
        const session = liveSessionStore.getLiveSessionById(scopedRef.ownerUserId, scopedRef.sessionId);
        return session ? formatVisibleLiveSession({
            ...session,
            ownerUserId: scopedRef.ownerUserId,
            rawSessionId: session.id
        }, currentUser, isAdminOrSuperAdmin(currentUser)) : null;
    }

    const ownSession = liveSessionStore.getLiveSessionById(currentUser.uid, sessionId);
    if (ownSession) {
        return formatVisibleLiveSession({
            ...ownSession,
            ownerUserId: currentUser.uid,
            rawSessionId: ownSession.id
        }, currentUser, isAdminOrSuperAdmin(currentUser));
    }

    if (!isAdminOrSuperAdmin(currentUser)) return null;
    const matched = readAllStoredLiveSessions().find(session => session.rawSessionId === sessionId || session.id === sessionId);
    return matched ? formatVisibleLiveSession(matched, currentUser, true) : null;
}

function deleteVisibleStoredLiveSession(currentUser, sessionId) {
    const session = getVisibleStoredLiveSession(currentUser, sessionId);
    if (!session) return false;
    return liveSessionStore.deleteLiveSession(session.ownerUserId, session.rawSessionId || session.id);
}

// GET /api/live-sessions — Lấy danh sách phiên live của user (cả merged + live)
app.get('/api/live-sessions', requireApiAuth, (req, res) => {
    try {
        const user = req.session.user;
        const userId = user.uid;
        const includeSharedLegacy = isAdminOrSuperAdmin(user);
        const sessions = readVisibleStoredLiveSessions(user);
        // Trả về danh sách không kèm orders chi tiết (nhẹ hơn)
        // ⭐ KHÔNG FILTER - trả về tất cả sessions (cả merged_session + live_session)
        const list = sessions.map(s => ({
            id: s.id,
            rawSessionId: s.rawSessionId || s.id,
            source: s.source || (s.type === 'merged_session' ? 'merged_session' : 'live_session'),
            type: s.type || 'live_session',
            ownerUserId: s.ownerUserId || userId,
            isAdminVisible: Boolean(s.isAdminVisible),
            liveName: s.liveName,
            tiktokUsername: s.tiktokUsername,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            createdAt: s.createdAt,
            summary: s.summary,
            lastStartedAt: s.lastStartedAt,
            runCount: s.segments?.length || 1,
            // A session remains a single durable history even when it crosses
            // midnight.  The breakdown makes those calendar days visible.
            dailySummary: buildLiveSessionDailySummary(s)
        }));
        const legacyList = readLegacyHistorySessions(userId, {
            includeSharedLegacy,
            includeAllUserLegacy: isAdminOrSuperAdmin(user),
            includeOwnerScope: isAdminOrSuperAdmin(user)
        });
        const combinedList = [...list, ...legacyList].sort((a, b) => {
            const left = Date.parse(a.lastStartedAt || a.createdAt || a.startedAt || 0) || 0;
            const right = Date.parse(b.lastStartedAt || b.createdAt || b.startedAt || 0) || 0;
            return right - left;
        });
        res.json({ sessions: combinedList });
    } catch (error) {
        console.error('Lỗi lấy danh sách phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// POST /api/live-sessions/merged — Lưu kết quả gộp thành 1 phiên mới
app.post('/api/live-sessions/merged', requireApiAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const includeSharedLegacy = isAdminOrSuperAdmin(user);
        const includeAllUserLegacy = isAdminOrSuperAdmin(user);
        const { sessionIds } = req.body;

        if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
            return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 phiên' });
        }

        const result = mergeVisibleLiveSessionsWithLegacy(user, sessionIds, { includeSharedLegacy, includeAllUserLegacy });
        if (!result) {
            return res.status(404).json({ error: 'Không tìm thấy phiên live nào' });
        }

        const now = new Date();
        const liveName = `Phiên gộp ${now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`;
        const newSession = await liveSessionStore.createLiveSession(user.uid, {
            type: 'merged_session',
            liveName,
            tiktokUsername: '',
            startedAt: now.toISOString(),
            endedAt: now.toISOString(),
            sourceSessionIds: sessionIds,
            orders: result.mergedOrders,
            summary: result.summary
        });

        console.log(`>>> Đã lưu phiên gộp "${newSession.liveName}" cho user ${user.uid} (${newSession.summary.totalOrders} đơn)`);
        res.json({ success: true, session: newSession });
    } catch (error) {
        console.error('Lỗi lưu phiên gộp:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// POST /api/live-sessions — Tạo/lưu phiên live mới
app.post('/api/live-sessions', requireApiAuth, async (req, res) => {
    try {
        const userId = req.session.user.uid;
        const runtime = getLiveRuntime(userId);
        if (!runtime.currentSessionId) return res.status(409).json({ error: 'Hãy bắt đầu Live trước khi lưu' });

        const newSession = await liveSessionStore.serialize(userId, () => saveSessionDataForUser(userId));

        console.log(`>>> Đã lưu phiên live "${newSession.liveName}" cho user ${userId} (${newSession.summary.totalOrders} đơn)`);
        res.json({ success: true, session: newSession });
    } catch (error) {
        console.error('Lỗi tạo phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

function readHistoryWorkspace(user, sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) historyWorkspace.fail('Thiếu lịch sử', 400);
    const admin = isAdminOrSuperAdmin(user);
    const session = sessionId.startsWith('legacy:')
        ? getLegacyHistorySession(user.uid, sessionId, { includeSharedLegacy: admin, includeAllUserLegacy: admin })
        : getVisibleStoredLiveSession(user, sessionId);
    if (!session) historyWorkspace.fail('Không tìm thấy phiên live', 404);
    return { session, orders: session.orders || [] };
}

async function editHistoryWorkspace(user, sessionId, body) {
    const visible = readHistoryWorkspace(user, sessionId).session;
    const owner = visible.ownerUserId || user.uid;
    return liveSessionStore.serialize(owner, () => editHistoryWorkspaceQueued(user, sessionId, body));
}

async function editHistoryWorkspaceQueued(user, sessionId, body) {
    const { session, orders } = readHistoryWorkspace(user, sessionId);
    const meta = liveSessionStore.operationMeta('history-orders', body, session.rawSessionId || sessionId);
    if (!sessionId.startsWith('legacy:') && await liveSessionStore.isDuplicate(session.ownerUserId, meta)) return { session, orders, revision: historyWorkspace.revision(orders), duplicate: true };
    const next = historyWorkspace.mutate(orders, body, customerStore.normalizeTikTokUsername);
    if (sessionId.startsWith('legacy:')) {
        const ref = parseLegacySessionRef(sessionId);
        const fileName = safeLegacyHistoryFileName(ref.fileName);
        const directory = ref.scope === 'shared' ? HISTORY_ROOT_DIR : getUserHistoryDir(ref.ownerUserId || user.uid);
        const target = path.join(directory, fileName);
        const original = JSON.parse(fs.readFileSync(target, 'utf8'));
        const map = {};
        for (const order of next) {
            const username = order.customerUsername;
            if (!Object.hasOwn(map, username)) Object.defineProperty(map, username, { enumerable: true, writable: true, value: {
                ...(Object.values(original).find(c => customerStore.normalizeTikTokUsername(c.username) === username) || {}),
                username, nickname: order.customerName, profilePictureUrl: order.profilePictureUrl || '', items: [], total: 0
            } });
            const oldIndex = orders.findIndex(o => o.id === order.id && o.customerUsername === order.customerUsername);
            const oldItem = oldIndex < 0 ? {} : Object.values(original).flatMap(c => c.items || [])[oldIndex];
            map[username].items.push({ ...oldItem, id: oldItem?.id || order.id, historyOrderId: order.id, text: order.productName, price: order.total ?? order.price, time: order.time, createdAt: order.createdAt });
            map[username].total += order.total ?? order.price;
        }
        const temporary = target + '.tmp';
        try { fs.writeFileSync(temporary, JSON.stringify(map, null, 2), 'utf8'); fs.renameSync(temporary, target); }
        finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    } else {
        const owner = session.ownerUserId;
        const sessions = liveSessionStore.readUserSessions(owner);
        const stored = sessions.find(s => s.id === session.rawSessionId);
        stored.orders = next;
        stored.summary = liveSessionStore.calculateSessionSummary(next);
        stored.updatedAt = new Date().toISOString();
        stored.segments = Array.isArray(stored.segments) ? stored.segments : [];
        if (!stored.segments.length) stored.segments.push({ startedAt: stored.startedAt, endedAt: stored.endedAt, orders: [] });
        const byId = new Map(next.map(order => [String(order.id), order]));
        const assigned = new Set();
        for (const segment of stored.segments) {
            segment.orders = (segment.orders || []).filter(order => {
                const key = String(order.id);
                if (!byId.has(key) || assigned.has(key)) return false;
                assigned.add(key);
                return true;
            }).map(order => byId.get(String(order.id)));
        }
        const openSegments = stored.segments.filter(segment => !segment.endedAt && !segment.closedBySessionAt);
        if (!stored.endedAt && openSegments.length !== 1) historyWorkspace.fail('Segment đang mở không rõ ràng; hãy đối soát trước khi sửa', 409);
        const lastSegment = stored.endedAt ? stored.segments[stored.segments.length - 1] : openSegments[0];
        lastSegment.orders.push(...next.filter(order => !assigned.has(String(order.id))));
        for (const segment of stored.segments) segment.summary = liveSessionStore.calculateSessionSummary(segment.orders);
        stored.lastActivityAt = stored.updatedAt;
        await liveSessionStore.writeUserSessions(owner, sessions, { meta });
        // Only the exact selected active record is synchronized. Other live runs stay untouched.
        const runtime = liveRuntimeByUser.get(owner);
        if (runtime?.currentSessionId === stored.id) {
            runtime.confirmedOrders = rebuildConfirmedOrders(lastSegment.orders);
            try { emitToUser(owner, 'all-confirmed-orders', runtime.confirmedOrders); }
            catch (error) { console.error('Lịch sử đã commit, lỗi phát socket:', error.message); }
        }
    }
    const result = readHistoryWorkspace(user, sessionId);
    return { ...result, revision: historyWorkspace.revision(result.orders) };
}

app.patch('/api/live-sessions/:sessionId/orders', requireApiAuth, async (req, res) => {
    const origin = req.get('origin');
    if (!origin || origin !== req.protocol + '://' + req.get('host')) return res.status(403).json({ error: 'Origin không hợp lệ' });
    try { res.json(await editHistoryWorkspace(req.session.user, req.params.sessionId, req.body || {})); }
    catch (error) { res.status(error.status || 500).json({ error: error.status ? error.message : 'Không thể lưu lịch sử' }); }
});

// GET /api/live-sessions/:sessionId — Lấy chi tiết 1 phiên
app.get('/api/live-sessions/:sessionId', requireApiAuth, (req, res) => {
    try {
        const user = req.session.user;
        const userId = user.uid;
        const includeSharedLegacy = isAdminOrSuperAdmin(user);
        const includeAllUserLegacy = isAdminOrSuperAdmin(user);

        let session, orders;

        if (String(req.params.sessionId || '').startsWith('legacy:')) {
            session = getLegacyHistorySession(userId, req.params.sessionId, { includeSharedLegacy, includeAllUserLegacy });
            if (!session) {
                return res.status(404).json({ error: 'Không tìm thấy phiên live' });
            }
            orders = session.orders || [];
        } else {
            session = getVisibleStoredLiveSession(user, req.params.sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Không tìm thấy phiên live' });
            }
            // Orders are already stored in session.orders
            orders = session.orders || [];
        }

        res.json({ session, orders, revision: historyWorkspace.revision(orders), comments: [] }); // comments: [] - chưa lưu chi tiết
    } catch (error) {
        console.error('Lỗi lấy chi tiết phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// DELETE /api/live-sessions/:sessionId — Xóa phiên live
app.delete('/api/live-sessions/:sessionId', requireApiAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const userId = user.uid;
        const includeSharedLegacy = isAdminOrSuperAdmin(user);
        const includeAllUserLegacy = isAdminOrSuperAdmin(user);
        if (String(req.params.sessionId || '').startsWith('legacy:')) {
            const deleted = deleteLegacyHistorySession(userId, req.params.sessionId, { includeSharedLegacy, includeAllUserLegacy });
            if (!deleted) {
                return res.status(404).json({ error: 'Không tìm thấy phiên live' });
            }
            console.log(`>>> Đã xóa legacy history ${req.params.sessionId} bởi user ${userId}`);
            return res.json({ success: true });
        }

        const target = getVisibleStoredLiveSession(user, req.params.sessionId);
        if (target && !target.endedAt) return res.status(409).json({ error: 'Hãy kết thúc phiên trước khi xóa' });
        const deleted = await deleteVisibleStoredLiveSession(user, req.params.sessionId);
        if (!deleted) {
            return res.status(404).json({ error: 'Không tìm thấy phiên live' });
        }
        console.log(`>>> Đã xóa phiên live ${req.params.sessionId} bởi user ${userId}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi xóa phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// POST /api/live-sessions/merge-summary — Gộp nhiều phiên
app.post('/api/live-sessions/merge-summary', requireApiAuth, (req, res) => {
    try {
        const user = req.session.user;
        const includeSharedLegacy = isAdminOrSuperAdmin(user);
        const includeAllUserLegacy = isAdminOrSuperAdmin(user);
        const { sessionIds } = req.body;

        if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
            return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 phiên' });
        }

        const result = mergeVisibleLiveSessionsWithLegacy(user, sessionIds, { includeSharedLegacy, includeAllUserLegacy });
        if (!result) {
            return res.status(404).json({ error: 'Không tìm thấy phiên live nào' });
        }

        res.json(result);
    } catch (error) {
        console.error('Lỗi gộp phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// GET /api/overview — Tổng hợp dữ liệu thật cho dashboard tổng quan
app.get('/api/overview', requireApiAuth, (req, res) => {
    try {
        const range = normalizeOverviewRange(req.query.start, req.query.end);
        const result = buildOverviewDataset(req.session.user, range);
        res.json(result);
    } catch (error) {
        console.error('Lỗi tổng hợp overview:', error);
        res.status(500).json({ error: 'Lỗi server khi tải tổng quan' });
    }
});

// GET /api/orders — Danh sách đơn hàng phục vụ trang quản lý đơn
app.get('/api/orders', requireApiAuth, (req, res) => {
    try {
        const user = req.session.user;
        const filters = {
            q: String(req.query.q || '').trim(),
            status: String(req.query.status || 'all').trim().toLowerCase(),
            shop: String(req.query.shop || '').trim().toLowerCase(),
            start: String(req.query.start || '').trim(),
            end: String(req.query.end || '').trim()
        };
        const result = buildOrdersDataset(user, filters);
        res.json(result);
    } catch (error) {
        console.error('Lỗi tải danh sách đơn hàng:', error);
        res.status(500).json({ error: 'Lỗi server khi tải đơn hàng' });
    }
});

// ============================================================
// === API KHÁCH HÀNG (per-user) ===
// ============================================================
app.get('/api/customers', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const customers = customerStore.listCustomers(userId, req.query.q || '');
        res.json({ customers });
    } catch (error) {
        console.error('Lỗi lấy danh sách khách hàng:', error);
        res.status(500).json({ error: 'Lỗi server khi tải khách hàng' });
    }
});

app.post('/api/customers/import-from-history', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const existingCustomers = customerStore.readUserCustomers(userId);
        const existingTikToks = new Set(existingCustomers.map(c => customerStore.normalizeTikTokUsername(c.tiktokUsername)).filter(Boolean));
        const existingNames = new Set(existingCustomers.map(c => normalizeOrderCustomerName(c.displayName, c.tiktokUsername).toLowerCase()).filter(Boolean));
        const sessions = [
            ...liveSessionStore.readUserSessions(userId),
            ...readLegacyHistorySessions(userId)
        ];
        const candidates = new Map();

        sessions.forEach(session => {
            (session.orders || []).forEach(order => {
                const tiktokUsername = customerStore.normalizeTikTokUsername(order.customerUsername || order.tiktokUsername || '');
                const rawDisplayName = cleanDisplayText(order.customerName || order.nickname || '');
                if (!tiktokUsername && !rawDisplayName) return;
                const displayName = rawDisplayName || tiktokUsername;
                const displayKey = normalizeOrderCustomerName(rawDisplayName, tiktokUsername);

                const key = tiktokUsername || displayKey.toLowerCase();
                if (!candidates.has(key)) {
                    candidates.set(key, {
                        tiktokUsername,
                        displayName,
                        sourceSessions: new Set()
                    });
                }
                candidates.get(key).sourceSessions.add(session.liveName || session.id || '');
            });
        });

        const imported = [];
        const skipped = [];
        candidates.forEach(candidate => {
            const nameKey = normalizeOrderCustomerName(candidate.displayName, candidate.tiktokUsername).toLowerCase();
            const exists = candidate.tiktokUsername
                ? existingTikToks.has(candidate.tiktokUsername)
                : existingNames.has(nameKey);
            if (exists) {
                skipped.push({
                    tiktokUsername: candidate.tiktokUsername,
                    displayName: candidate.displayName
                });
                return;
            }

            const customer = customerStore.createCustomer(userId, {
                tiktokUsername: candidate.tiktokUsername,
                displayName: candidate.displayName
            });
            imported.push({
                ...customer,
                sourceSessions: Array.from(candidate.sourceSessions).filter(Boolean)
            });
            if (customer.tiktokUsername) existingTikToks.add(customer.tiktokUsername);
            if (customer.displayName) existingNames.add(String(customer.displayName).trim().toLowerCase());
        });

        res.json({
            success: true,
            imported,
            skipped,
            totalCandidates: candidates.size,
            totalSessions: sessions.length
        });
    } catch (error) {
        console.error('Lỗi import khách hàng từ lịch sử:', error);
        res.status(500).json({ error: 'Lỗi server khi import khách hàng từ lịch sử' });
    }
});

app.get('/api/customers/by-tiktok/:username', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const customer = customerStore.findCustomerByTikTok(userId, req.params.username);
        if (!customer) {
            return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
        }
        res.json({ customer });
    } catch (error) {
        console.error('Lỗi tìm khách hàng theo TikTok:', error);
        res.status(500).json({ error: 'Lỗi server khi tìm khách hàng' });
    }
});

app.get('/api/customers/:id', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const customer = customerStore.getCustomerById(userId, req.params.id);
        if (!customer) {
            return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
        }
        res.json({ customer });
    } catch (error) {
        console.error('Lỗi lấy chi tiết khách hàng:', error);
        res.status(500).json({ error: 'Lỗi server khi tải khách hàng' });
    }
});

app.post('/api/customers/:id/quote-consent', requireApiAuth, (req, res) => {
    const origin = req.get('origin');
    if (!origin || origin !== req.protocol + '://' + req.get('host')) return res.status(403).json({ error: 'Origin không hợp lệ' });
    const value = req.body?.quoteMessages;
    if (!['unknown', 'granted', 'denied'].includes(value)) return res.status(400).json({ error: 'Trạng thái đồng ý không hợp lệ' });
    try {
        const customer = customerStore.setQuoteConsent(req.session.user.uid, req.params.id, value);
        if (!customer) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
        res.json({ customer });
    } catch (error) { console.error('Lỗi cập nhật đồng ý:', error.message); res.status(500).json({ error: 'Không thể cập nhật trạng thái đồng ý' }); }
});

app.post('/api/customers', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        if (!String(req.body?.displayName || '').trim()) {
            return res.status(400).json({ error: 'Tên người nhận là bắt buộc' });
        }

        const customer = customerStore.createCustomer(userId, req.body || {});
        const warnings = [];
        if (!String(customer.phone || '').trim()) {
            warnings.push('Khách hàng chưa có số điện thoại');
        }
        res.status(201).json({ success: true, customer, warnings });
    } catch (error) {
        console.error('Lỗi tạo khách hàng:', error);
        res.status(500).json({ error: 'Lỗi server khi tạo khách hàng' });
    }
});

app.patch('/api/customers/:id', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const customer = customerStore.updateCustomer(userId, req.params.id, req.body || {});
        if (!customer) {
            return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
        }
        const warnings = [];
        if (!String(customer.phone || '').trim()) {
            warnings.push('Khách hàng chưa có số điện thoại');
        }
        res.json({ success: true, customer, warnings });
    } catch (error) {
        console.error('Lỗi cập nhật khách hàng:', error);
        res.status(500).json({ error: 'Lỗi server khi cập nhật khách hàng' });
    }
});

app.delete('/api/customers/:id', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const deleted = customerStore.deleteCustomer(userId, req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi xóa khách hàng:', error);
        res.status(500).json({ error: 'Lỗi server khi xóa khách hàng' });
    }
});

// ============================================================
// === XUẤT EXCEL ĐI ĐƠN ===
// ============================================================
app.post('/api/orders/export-delivery-excel', requireApiAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const userId = user.uid;
        const sessionIds = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
        const submittedOrders = Array.isArray(req.body?.orders) ? req.body.orders : [];
        const orders = [];

        sessionIds.forEach(sessionId => {
            const session = getVisibleStoredLiveSession(user, sessionId);
            if (!session) {
                console.warn(`Không tìm thấy phiên ${sessionId} khi export Excel cho user ${userId}`);
                return;
            }
            (session.orders || []).forEach(order => {
                orders.push({ ...order, fromSession: session.liveName });
            });
        });

        submittedOrders.forEach(order => orders.push(order));

        if (orders.length === 0) {
            return res.status(400).json({ error: 'Không có đơn hàng để xuất Excel' });
        }

        const result = await orderExcelExporter.exportDeliveryExcel({
            userId,
            orders,
            options: req.body?.options || {}
        });

        const missingHeader = Buffer.from(JSON.stringify(result.missingCustomers || []), 'utf-8').toString('base64');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.setHeader('X-Missing-Customers', missingHeader);
        res.setHeader('X-Missing-Customers-Count', String((result.missingCustomers || []).length));
        res.setHeader('X-Exported-Customers-Count', String(result.totalCustomers || 0));
        res.send(Buffer.from(result.buffer));
    } catch (error) {
        console.error('Lỗi xuất Excel đi đơn:', error);
        const status = error.code === 'TEMPLATE_NOT_FOUND' ? 500 : 500;
        res.status(status).json({ error: error.message || 'Lỗi server khi xuất Excel' });
    }
});

// ============================================================
// === EXPORT/BACKUP DỮ LIỆU ===
// ============================================================
app.get('/api/export-data', requireApiAuth, (req, res) => {
    try {
        const format = String(req.query.format || 'json').toLowerCase(); // json | csv | excel
        const scope = String(req.query.scope || 'mine').toLowerCase();   // mine | all
        const user = req.session.user;

        if (!['json', 'csv', 'excel'].includes(format)) {
            return res.status(400).json({ error: 'Định dạng không hợp lệ. Dùng: json/csv/excel' });
        }
        if (!['mine', 'all'].includes(scope)) {
            return res.status(400).json({ error: 'Phạm vi không hợp lệ. Dùng: mine/all' });
        }
        if (scope === 'all' && user.role !== 'admin' && user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Chỉ admin mới được export toàn bộ dữ liệu' });
        }

        const dataset = buildExportDataset(scope, user);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileBase = `backup-${scope}-${stamp}`;

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.json"`);
            return res.send(JSON.stringify(dataset, null, 2));
        }
        if (format === 'csv') {
            const csvText = toCsv(dataset.rows);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
            return res.send('\uFEFF' + csvText); // BOM để Excel hiển thị UTF-8 đúng
        }

        const excelXml = toExcelXml(dataset.rows);
        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xls"`);
        return res.send(excelXml);
    } catch (error) {
        console.error('Lỗi export dữ liệu:', error);
        res.status(500).json({ error: 'Lỗi server khi export dữ liệu' });
    }
});

// ============================================================
// === ADMIN PANEL ===
// ============================================================
app.get('/admin', (req, res) => {
    const user = req.session?.user;
    if (!user) return res.redirect('/login');
    if (user.role !== 'admin' && user.role !== 'super_admin') {
        return res.status(403).send(`
            <html><body style="font-family:Inter, 'Segoe UI', Roboto, Arial, 'Helvetica Neue', sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji';display:flex;align-items:center;justify-content:center;height:100vh;background:#f3f4f6;">
            <div style="text-align:center;"><h1 style="color:#ef4444;">⛔ Không có quyền truy cập</h1>
            <p>Tài khoản của bạn không có quyền vào trang Admin.</p>
            <a href="/app" style="color:#3b82f6;">← Quay về trang chính</a></div></body></html>`);
    }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use('/api/admin', adminRoutes);
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'app.html'));
});
app.get('/pricing', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pricing.html'));
});
app.get('/demo', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'demo.html'));
});
app.get('/contact', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });

io.engine.use(sessionMiddleware);
io.use((socket, next) => {
    if (socket.request.session && socket.request.session.user) {
        next();
    } else {
        next(new Error("Authentication error"));
    }
});

const HISTORY_ROOT_DIR = path.join(__dirname, 'history');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const LIVE_SESSIONS_DIR = path.join(__dirname, 'data', 'live-sessions');

let printerInterface = 'tcp://192.168.1.9'; 
let tiktokSignApiKey = '';
let shopName = '';
let printer = null;
const liveRuntimeByUser = new Map(); // { userId -> runtime state }
const CHAT_BUFFER_LIMIT = 300;

function safeStorageId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function getUserRoom(userId) {
    return `user:${userId}`;
}

function emitToUser(userId, eventName, payload) {
    io.to(getUserRoom(userId)).emit(eventName, payload);
}

function getUserHistoryDir(userId) {
    const dirPath = path.join(HISTORY_ROOT_DIR, safeStorageId(userId));
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
}

function getSessionFileName(userId, broadcasterId, sessionId) {
    const safeBroadcasterId = customerStore.normalizeTikTokUsername(broadcasterId) || 'unknown';
    const id = sessionId || ('sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8));
    return path.join(getUserHistoryDir(userId), `${id}_${safeBroadcasterId}.json`);
}

function createEmptyLiveRuntime(userId) {
    return {
        userId,
        tiktokConnection: null,
        confirmedOrders: {},
        currentBroadcasterId: '',
        currentSessionId: null,
        currentSessionStartedAt: null,
        selectionVersion: 0,
        connectionState: 'idle',
        processedMsgIds: new Set(),
        chatBufferByBroadcaster: new Map(),
        sockets: new Set()
    };
}

function getLiveRuntime(userId) {
    if (!liveRuntimeByUser.has(userId)) {
        liveRuntimeByUser.set(userId, createEmptyLiveRuntime(userId));
    }
    return liveRuntimeByUser.get(userId);
}

function resetLiveRuntime(userId) {
    const runtime = liveRuntimeByUser.get(userId);
    if (!runtime) return;
    if (runtime.tiktokConnection) {
        try { runtime.tiktokConnection.disconnect(); } catch (e) {}
    }
    runtime.tiktokConnection = null;
    runtime.confirmedOrders = {};
    runtime.currentBroadcasterId = '';
    runtime.currentSessionId = null;
    runtime.currentSessionStartedAt = null;
    runtime.processedMsgIds.clear();
    runtime.chatBufferByBroadcaster.clear();
    runtime.sockets.clear();
    liveRuntimeByUser.delete(userId);
}

function saveSessionDataForUser(userId, runtime = getLiveRuntime(userId), meta) {
    if (!runtime.currentSessionId) throw new Error('Hãy bắt đầu Live trước khi sửa đơn');
    return liveSessionStore.updateLiveSession(userId, runtime.currentSessionId, { orders: sanitizeConfirmedOrders(runtime.confirmedOrders), segmentStartedAt: runtime.currentSessionStartedAt, meta });
}

function formatLiveName(broadcasterId, startedAt) {
    const d = startedAt ? new Date(startedAt) : new Date();
    return `${d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}_${broadcasterId}`;
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
            ...order,
            id: order.id ?? (Date.now() + Math.random()),
            text: order.productName || order.text || '',
            price: order.total ?? order.price ?? 0,
            eventId: order.eventId || '', eventIdSource: order.eventIdSource || '',
            time: order.time || '',
            requestId: order.requestId || '',
            sourceMessageId: order.sourceMessageId || '',
            sourceBroadcasterId: order.sourceBroadcasterId || '',
            createdAt: order.createdAt || null
        };
        result[username].items.push(item);
        result[username].total += item.price;
    });
    return result;
}

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE));
        printerInterface = config.printerInterface || printerInterface;
        tiktokSignApiKey = config.tiktokSignApiKey || '';
        shopName = normalizeDisplayText(config.shopName || '');
        if (tiktokSignApiKey) {
            SignConfig.apiKey = tiktokSignApiKey;
        }
    } catch(e) {}
}

function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ shopName, printerInterface, tiktokSignApiKey }, null, 2));
}

function displayFallbackFromUsername(username) {
    const normalized = customerStore.normalizeTikTokUsername(username);
    return normalized ? `@${normalized}` : undefined;
}

function normalizeOrderCustomerName(name, username) {
    return normalizeDisplayName(name, displayFallbackFromUsername(username));
}

function sanitizeConfirmedOrders(orders) {
    return Object.values(orders || {}).reduce((result, customer) => {
        const username = customerStore.normalizeTikTokUsername(customer.username || customer.tiktokUsername || '');
        if (!username) return result;
        const nickname = cleanDisplayText(customer.nickname || customer.displayName || '') || displayFallbackFromUsername(username) || username;
        result[username] = {
            ...customer,
            username,
            nickname,
            profilePictureUrl: normalizeDisplayText(customer.profilePictureUrl || ''),
            items: Array.isArray(customer.items)
                ? customer.items.map(item => ({
                    ...item,
                    text: normalizeDisplayText(item.text || item.productName || '')
                }))
                : [],
            total: Number(customer.total || 0)
        };
        return result;
    }, {});
}

function initPrinter(newInterface) {
    printerInterface = newInterface;
    printer = new ThermalPrinter({
        type: PrinterTypes.EPSON,
        interface: printerInterface,
        characterSet: CharacterSet.TCVN_VIETNAMESE,
        removeSpecialCharacters: false,
        width: 48,
    });
    saveConfig();
}
initPrinter(printerInterface);

function removeVietnameseTones(str) {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
}

function formatThermalMoney(value) {
    return `${new Intl.NumberFormat('vi-VN').format(Number(value || 0))} D`;
}

function formatThermalItemTime(item) {
    const savedTime = normalizeDisplayText(item?.time || '');
    if (savedTime) return savedTime;
    const createdAt = normalizeDisplayText(item?.createdAt || '');
    if (!createdAt) return '';
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return createdAt;
    return date.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        day: '2-digit', month: '2-digit', year: 'numeric', hour12: false
    });
}

function wrapThermalText(value, width = 48) {
    const text = removeVietnameseTones(normalizeDisplayText(value)).replace(/\s+/g, ' ').trim();
    if (!text) return ['-'];
    const lines = [];
    let remaining = text;
    while (remaining.length > width) {
        let breakAt = remaining.lastIndexOf(' ', width);
        if (breakAt < 1) breakAt = width;
        lines.push(remaining.slice(0, breakAt).trim());
        remaining = remaining.slice(breakAt).trim();
    }
    if (remaining) lines.push(remaining);
    return lines;
}

function thermalItemLines(label, amount, width = 48) {
    const money = formatThermalMoney(amount);
    const labelWidth = Math.max(8, width - money.length - 2);
    const labelLines = wrapThermalText(label, labelWidth);
    return labelLines.map((line, index) => index === labelLines.length - 1
        ? `${line}${' '.repeat(Math.max(2, width - line.length - money.length))}${money}`
        : line);
}

function currentReceiptContext(userId, runtime) {
    const session = runtime?.currentSessionId
        ? liveSessionStore.getLiveSessionById(userId, runtime.currentSessionId)
        : null;
    return { sessionName: session?.liveName || '' };
}

async function printBill(item, order, userId, receiptContext = {}) {
    if (!printer) return;
    try {
        const displayName = normalizeOrderCustomerName(order.nickname, order.username);
        console.log(`>>> Đang đẩy lệnh in: ${displayName} - ${item.text}`);
        
        printer.clear();
        printer.alignCenter();
        printer.setTextNormal();
        if (shopName) {
            printer.bold(true);
            printer.println(removeVietnameseTones(shopName));
        }
        printer.bold(true);
        printer.println("PHIEU DON HANG");
        printer.bold(false);
        if (receiptContext.sessionName) {
            wrapThermalText(`Phien: ${receiptContext.sessionName}`).forEach(line => printer.println(line));
        }
        printer.println("------------------------------------------------");

        printer.alignLeft();
        printer.println("KHACH HANG");
        printer.setTextDoubleHeight();
        printer.bold(true);
        wrapThermalText(displayName).forEach(line => printer.println(line));
        printer.setTextNormal();
        printer.bold(false);
        wrapThermalText(`@${customerStore.normalizeTikTokUsername(order.username)}`).forEach(line => printer.println(line));
        printer.println("------------------------------------------------");
        thermalItemLines(item.text, item.price).forEach(line => printer.println(line));
        const itemTime = formatThermalItemTime(item);
        if (itemTime) {
            wrapThermalText(itemTime).forEach(line => printer.println(line));
        }
        printer.println("------------------------------------------------");
        printer.alignCenter();
        printer.setTextDoubleHeight();
        printer.setTextDoubleWidth();
        printer.bold(true);
        printer.println("TONG TIEN");
        printer.println(formatThermalMoney(item.price));
        printer.setTextNormal();
        printer.bold(false);
        printer.println("================================================");
        printer.alignCenter();
        printer.println(removeVietnameseTones("Cảm ơn bạn đã ủng hộ shop!"));
        printer.println(removeVietnameseTones("Hẹn gặp bạn ở live sau."));
        printer.println(removeVietnameseTones("Vui lòng đối chiếu thông tin đơn."));
        
        printer.cut();

        await printer.execute();
        console.log(">>> Đã nhả bill thành công!");
    } catch (error) {
        console.error("LỖI IN ẤN:", error);
        if (userId) {
            emitToUser(userId, 'printer-error', "Máy in phản hồi chậm hoặc rớt mạng. Hãy kiểm tra Wi-Fi máy in!");
        }
    }
}

async function printDetailedBill(order, userId, receiptContext = {}) {
    if (!printer) return;
    try {
        const displayName = normalizeOrderCustomerName(order.nickname, order.username);
        const items = Array.isArray(order.items) ? order.items : [];
        const total = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
        console.log(`>>> Đang in bill chi tiết cho khách: ${displayName}`);
        
        printer.clear();
        printer.alignCenter();
        printer.setTextNormal();
        if (shopName) {
            printer.bold(true);
            printer.println(removeVietnameseTones(shopName));
        }
        printer.bold(true);
        printer.println("PHIEU TONG DON");
        printer.bold(false);
        if (receiptContext.sessionName) {
            wrapThermalText(`Phien: ${receiptContext.sessionName}`).forEach(line => printer.println(line));
        }
        printer.println("------------------------------------------------");

        printer.alignLeft();
        printer.println("KHACH HANG");
        printer.setTextDoubleHeight();
        printer.bold(true);
        wrapThermalText(displayName).forEach(line => printer.println(line));
        
        printer.setTextNormal();
        printer.bold(false);
        wrapThermalText(`@${customerStore.normalizeTikTokUsername(order.username)}`).forEach(line => printer.println(line));
        printer.println("------------------------------------------------");
        printer.println("Noi dung                             Thanh tien");

        items.forEach((item) => {
            thermalItemLines(item.text, item.price).forEach(line => printer.println(line));
            const itemTime = formatThermalItemTime(item);
            if (itemTime) {
                wrapThermalText(itemTime).forEach(line => printer.println(line));
            }
        });

        printer.println("------------------------------------------------");
        printer.println(`So dong hang: ${items.length}`);
        printer.println("------------------------------------------------");

        printer.alignCenter();
        printer.setTextDoubleHeight();
        printer.setTextDoubleWidth();
        printer.bold(true);
        printer.println("TONG TIEN");
        printer.println(formatThermalMoney(total));
        
        printer.setTextNormal();
        printer.bold(false);
        printer.println("================================================");
        printer.alignCenter();
        printer.println(removeVietnameseTones("Cảm ơn bạn đã ủng hộ shop!"));
        printer.println(removeVietnameseTones("Hẹn gặp bạn ở live sau."));
        printer.println(removeVietnameseTones("Vui lòng đối chiếu thông tin đơn."));
        
        printer.cut();

        await printer.execute();
        console.log(">>> Đã nhả bill chi tiết thành công!");
    } catch (error) {
        console.error("LỖI IN CHI TIẾT:", error);
        if (userId) {
            emitToUser(userId, 'printer-error', "Lỗi in bill chi tiết!");
        }
    }
}

function parsePrice(text) {
    const regexWithUnit = /(\d+(?:\.\d+)?)\s*(k|ngàn|n|đ|vnd|vnđ)/gi;
    let match = regexWithUnit.exec(text);
    if (match) {
        let value = parseFloat(match[1].replace(/,/g, ''));
        let unit = match[2].toLowerCase();
        if (['k', 'n', 'ngàn'].includes(unit)) value *= 1000;
        return value;
    }
    const regexPureNumber = /\b(\d+)\b/g;
    let pureMatch; let lastNumber = 0;
    while ((pureMatch = regexPureNumber.exec(text)) !== null) { lastNumber = parseFloat(pureMatch[1]); }
    if (lastNumber > 0 && lastNumber < 1000) return lastNumber * 1000;
    if (lastNumber >= 1000) return lastNumber;
    return 0;
}

function escapeCsvValue(value) {
    const str = String(value ?? '');
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function readAllLiveSessionRows() {
    if (!fs.existsSync(LIVE_SESSIONS_DIR)) return { rows: [], files: 0 };
    const files = fs.readdirSync(LIVE_SESSIONS_DIR).filter(f => f.endsWith('.json'));
    const rows = [];

    files.forEach(fileName => {
        const userIdFromFile = fileName.replace(/\.json$/i, '');
        const fullPath = path.join(LIVE_SESSIONS_DIR, fileName);
        try {
            const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
            sessions.forEach(session => {
                const sessionUserId = session.userId || userIdFromFile || '';
                const orders = Array.isArray(session.orders) ? session.orders : [];
                if (orders.length === 0) {
                    rows.push({
                        source: 'live_session',
                        userId: sessionUserId,
                        sessionId: session.id || '',
                        sessionName: session.liveName || '',
                        sessionCreatedAt: session.createdAt || '',
                        sessionStartedAt: session.startedAt || '',
                        sessionEndedAt: session.endedAt || '',
                        sessionType: session.type || 'live_session',
                        tiktokUsername: session.tiktokUsername || '',
                        orderId: '',
                        eventId: '',
                        requestId: '',
                        sourceMessageId: '',
                        customerName: '',
                        customerUsername: '',
                        productName: '',
                        quantity: 0,
                        price: 0,
                        total: 0,
                        itemTime: ''
                    });
                    return;
                }
                orders.forEach(order => {
                    rows.push({
                        source: 'live_session',
                        userId: sessionUserId,
                        sessionId: session.id || '',
                        sessionName: session.liveName || '',
                        sessionCreatedAt: session.createdAt || '',
                        sessionStartedAt: session.startedAt || '',
                        sessionEndedAt: session.endedAt || '',
                        sessionType: session.type || 'live_session',
                        tiktokUsername: session.tiktokUsername || '',
                        orderId: order.id || '',
                        eventId: order.eventId || '',
                        requestId: order.requestId || '',
                        sourceMessageId: order.sourceMessageId || '',
                        customerName: normalizeOrderCustomerName(order.customerName || order.nickname || '', order.customerUsername || order.tiktokUsername || ''),
                        customerUsername: customerStore.normalizeTikTokUsername(order.customerUsername || order.tiktokUsername || ''),
                        productName: normalizeDisplayText(order.productName || order.text || ''),
                        quantity: Number(order.quantity || 1),
                        price: Number(order.price || 0),
                        total: Number(order.total || order.price || 0),
                        itemTime: order.time || '',
                        orderCreatedAt: order.createdAt || ''
                    });
                });
            });
        } catch (e) {
            console.error(`Lỗi đọc file live session ${fileName}:`, e.message);
        }
    });

    return { rows, files: files.length };
}

function readLegacyHistoryRows(userId, options = {}) {
    const includeSharedLegacy = Boolean(options.includeSharedLegacy);
    const historyDir = getUserHistoryDir(userId);
    const files = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter(f => f.endsWith('.json')) : [];
    const rows = [];

    files.forEach(fileName => {
        const fullPath = path.join(historyDir, fileName);
        try {
            const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            const users = Object.values(parsed || {});
            users.forEach(customer => {
                const items = Array.isArray(customer?.items) ? customer.items : [];
                if (items.length === 0) return;
                items.forEach(item => {
                    rows.push({
                        source: 'legacy_history',
                        userId,
                        historyFile: fileName,
                        historyDate: fileName.split('_')[0] || '',
                        sessionId: '',
                        sessionName: fileName.replace('.json', ''),
                        sessionCreatedAt: '',
                        tiktokUsername: '',
                        orderId: item.id || '',
                        customerName: normalizeOrderCustomerName(customer.nickname || customer.displayName || '', customer.username || customer.tiktokUsername || ''),
                        customerUsername: customerStore.normalizeTikTokUsername(customer.username || customer.tiktokUsername || ''),
                        productName: normalizeDisplayText(item.text || ''),
                        quantity: 1,
                        price: Number(item.price || 0),
                        total: Number(item.price || 0),
                        itemTime: item.time || '',
                        orderCreatedAt: ''
                    });
                });
            });
        } catch (e) {
            console.error(`Lỗi đọc file history ${fileName}:`, e.message);
        }
    });

    const RETENTION_DAYS = 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffKey = dateKeyFromTimestamp(cutoff.getTime());
    const activeRows = rows.filter((r) => !r.historyDate || r.historyDate >= cutoffKey);

    if (!includeSharedLegacy) {
        return { rows: activeRows, files: files.length };
    }

    const shared = readSharedLegacyHistoryRows();
    return {
        rows: [...activeRows, ...shared.rows],
        files: files.length + shared.files
    };
}

function readSharedLegacyHistoryRows() {
    if (!fs.existsSync(HISTORY_ROOT_DIR)) return { rows: [], files: 0 };
    const files = fs.readdirSync(HISTORY_ROOT_DIR)
        .filter(fileName => fileName.endsWith('.json'))
        .filter(fileName => safeLegacyHistoryFileName(fileName));
    const rows = [];

    files.forEach(fileName => {
        const fullPath = path.join(HISTORY_ROOT_DIR, fileName);
        try {
            const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            const users = Object.values(parsed || {});
            users.forEach(customer => {
                const items = Array.isArray(customer?.items) ? customer.items : [];
                if (items.length === 0) return;
                items.forEach(item => {
                    rows.push({
                        source: 'legacy_history',
                        userId: 'shared-admin-legacy',
                        historyFile: fileName,
                        historyDate: fileName.split('_')[0] || '',
                        sessionId: '',
                        sessionName: fileName.replace('.json', ''),
                        sessionCreatedAt: '',
                        tiktokUsername: '',
                        orderId: item.id || '',
                        customerName: normalizeOrderCustomerName(customer.nickname || customer.displayName || '', customer.username || customer.tiktokUsername || ''),
                        customerUsername: customerStore.normalizeTikTokUsername(customer.username || customer.tiktokUsername || ''),
                        productName: normalizeDisplayText(item.text || ''),
                        quantity: 1,
                        price: Number(item.price || 0),
                        total: Number(item.price || 0),
                        itemTime: item.time || '',
                        orderCreatedAt: ''
                    });
                });
            });
        } catch (error) {
            console.error(`Lỗi đọc shared legacy history ${fileName}:`, error.message);
        }
    });

    return { rows, files: files.length };
}

function parseLegacySessionRef(sessionId) {
    const raw = String(sessionId || '');
    const sharedMatch = raw.match(/^legacy:shared:(.+)$/);
    if (sharedMatch) return { scope: 'shared', fileName: sharedMatch[1] };
    const scopedUserMatch = raw.match(/^legacy:user:([^:]+):(.+)$/);
    if (scopedUserMatch) {
        return {
            scope: 'user',
            ownerUserId: decodeURIComponent(scopedUserMatch[1]),
            fileName: scopedUserMatch[2]
        };
    }
    const userMatch = raw.match(/^legacy:user:(.+)$/);
    if (userMatch) return { scope: 'user', fileName: userMatch[1] };
    const classicMatch = raw.match(/^legacy:(.+)$/);
    if (classicMatch) return { scope: 'user', fileName: classicMatch[1] };
    return { scope: 'user', fileName: raw };
}

function buildLegacySessionId(scope, fileName, ownerUserId = '') {
    if (scope === 'shared') return `legacy:shared:${fileName}`;
    return ownerUserId ? `legacy:user:${encodeURIComponent(ownerUserId)}:${fileName}` : `legacy:user:${fileName}`;
}

function readAllUserHistoryRows() {
    if (!fs.existsSync(HISTORY_ROOT_DIR)) return { rows: [], files: 0 };
    const entries = fs.readdirSync(HISTORY_ROOT_DIR, { withFileTypes: true });
    const userDirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);

    const rows = [];
    let files = 0;
    userDirs.forEach(userDirName => {
        const dirPath = path.join(HISTORY_ROOT_DIR, userDirName);
        const userFiles = fs.readdirSync(dirPath).filter(fileName => fileName.endsWith('.json'));
        files += userFiles.length;
        userFiles.forEach(fileName => {
            const fullPath = path.join(dirPath, fileName);
            try {
                const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
                const customers = Object.values(parsed || {});
                customers.forEach(customer => {
                    const items = Array.isArray(customer?.items) ? customer.items : [];
                    items.forEach(item => {
                        rows.push({
                            source: 'legacy_history',
                            userId: userDirName,
                            historyFile: fileName,
                            historyDate: fileName.split('_')[0] || '',
                            sessionId: '',
                            sessionName: fileName.replace('.json', ''),
                            sessionCreatedAt: '',
                            tiktokUsername: '',
                            orderId: item.id || '',
                            customerName: normalizeOrderCustomerName(customer.nickname || customer.displayName || '', customer.username || customer.tiktokUsername || ''),
                            customerUsername: customerStore.normalizeTikTokUsername(customer.username || customer.tiktokUsername || ''),
                            productName: normalizeDisplayText(item.text || ''),
                            quantity: 1,
                            price: Number(item.price || 0),
                            total: Number(item.price || 0),
                            itemTime: item.time || '',
                            orderCreatedAt: ''
                        });
                    });
                });
            } catch (error) {
                console.error(`Lỗi đọc file history ${fileName} của user ${userDirName}:`, error.message);
            }
        });
    });

    const shared = readSharedLegacyHistoryRows();
    return { rows: [...rows, ...shared.rows], files: files + shared.files };
}

function safeLegacyHistoryFileName(fileName) {
    const name = path.basename(String(fileName || ''));
    const validPatterns = [
        /^\d{4}-\d{2}-\d{2}_[a-zA-Z0-9_.-]+\.json$/i,
        /^session_\d+_[a-zA-Z0-9]+_[a-zA-Z0-9_.-]+\.json$/i,
        /^sess_\d{4}-\d{2}-\d{2}_[a-zA-Z0-9]+_[a-zA-Z0-9_.-]+\.json$/i
    ];
    return validPatterns.some(pattern => pattern.test(name)) ? name : '';
}

function legacyHistoryFileToOrders(fileName, data) {
    const meta = historyMetaFromFile(fileName);
    const dateKey = meta.date || '';
    const orders = [];

    Object.values(data || {}).forEach(customer => {
        const items = Array.isArray(customer?.items) ? customer.items : [];
        items.forEach(item => {
            const itemTime = item.time || '';
            const timestamp = timestampFromParts(dateKey, itemTime);
            orders.push({
                id: item.historyOrderId || `legacy_${fileName}_${item.id || `${customer.username || 'unknown'}_${itemTime}`}`,
                customerName: normalizeOrderCustomerName(customer.nickname || customer.displayName || '', customer.username || customer.tiktokUsername || ''),
                customerUsername: customerStore.normalizeTikTokUsername(customer.username || customer.tiktokUsername || ''),
                profilePictureUrl: customer.profilePictureUrl || '',
                productName: normalizeDisplayText(item.text || ''),
                quantity: 1,
                price: Number(item.price || 0),
                total: Number(item.price || 0),
                note: '',
                time: itemTime,
                createdAt: item.createdAt || (Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '')
            });
        });
    });

    return orders;
}

function readLegacyHistorySession(userId, fileName, options = {}) {
    const scope = options.scope === 'shared' ? 'shared' : 'user';
    const safeFileName = safeLegacyHistoryFileName(fileName);
    if (!safeFileName) return null;
    const targetUserId = scope === 'shared' ? 'shared-admin-legacy' : (options.ownerUserId || userId);
    const includeOwnerScope = Boolean(options.includeOwnerScope);

    const filePath = scope === 'shared'
        ? path.join(HISTORY_ROOT_DIR, safeFileName)
        : path.join(getUserHistoryDir(targetUserId), safeFileName);
    if (!fs.existsSync(filePath)) return null;

    try {
        const stats = fs.statSync(filePath);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        const meta = historyMetaFromFile(safeFileName);
        const orders = legacyHistoryFileToOrders(safeFileName, data);
        const summary = liveSessionStore.calculateSessionSummary(orders);
        const sessionDate = meta.date ? timestampFromParts(meta.date, '00:00:00') : stats.mtime.getTime();
        const createdAt = new Date(sessionDate || stats.mtime.getTime()).toISOString();

        return {
            id: buildLegacySessionId(scope, safeFileName, includeOwnerScope && scope === 'user' ? targetUserId : ''),
            source: 'legacy_history',
            userId: targetUserId,
            ownerUserId: scope === 'user' ? targetUserId : '',
            fileName: scope === 'shared' ? `shared:${safeFileName}` : safeFileName,
            liveName: safeFileName.replace(/\.json$/i, ''),
            tiktokUsername: meta.shop || '',
            startedAt: createdAt,
            endedAt: createdAt,
            createdAt,
            updatedAt: stats.mtime.toISOString(),
            orders,
            summary
        };
    } catch (e) {
        console.error(`Lỗi đọc phiên history ${safeFileName}:`, e.message);
        return null;
    }
}

function readLegacyHistorySessions(userId, options = {}) {
    const includeSharedLegacy = Boolean(options.includeSharedLegacy);
    const includeAllUserLegacy = Boolean(options.includeAllUserLegacy);
    const includeOwnerScope = Boolean(options.includeOwnerScope);
    const historyDir = getUserHistoryDir(userId);
    const userSessions = includeAllUserLegacy
        ? readAllUserLegacyHistorySessions(userId)
        : fs.existsSync(historyDir)
        ? fs.readdirSync(historyDir)
        .filter(f => f.endsWith('.json'))
        .map(fileName => readLegacyHistorySession(userId, fileName, { scope: 'user', includeOwnerScope }))
        .filter(Boolean)
        : [];

    if (!includeSharedLegacy) return userSessions;

    const sharedSessions = fs.existsSync(HISTORY_ROOT_DIR)
        ? fs.readdirSync(HISTORY_ROOT_DIR)
            .filter(fileName => fileName.endsWith('.json'))
            .map(fileName => readLegacyHistorySession(userId, fileName, { scope: 'shared' }))
            .filter(Boolean)
        : [];
    return [...userSessions, ...sharedSessions];
}

function readAllUserLegacyHistorySessions(currentUserId) {
    if (!fs.existsSync(HISTORY_ROOT_DIR)) return [];
    return fs.readdirSync(HISTORY_ROOT_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .flatMap(entry => {
            const ownerUserId = entry.name;
            const historyDir = path.join(HISTORY_ROOT_DIR, ownerUserId);
            return fs.readdirSync(historyDir)
                .filter(fileName => fileName.endsWith('.json'))
                .map(fileName => readLegacyHistorySession(currentUserId, fileName, {
                    scope: 'user',
                    ownerUserId,
                    includeOwnerScope: true
                }))
                .filter(Boolean);
        });
}

function getLegacyHistorySession(userId, sessionId, options = {}) {
    const includeSharedLegacy = Boolean(options.includeSharedLegacy);
    const includeAllUserLegacy = Boolean(options.includeAllUserLegacy);
    const ref = parseLegacySessionRef(sessionId);
    if (ref.scope === 'shared' && !includeSharedLegacy) return null;
    if (ref.ownerUserId && ref.ownerUserId !== userId && !includeAllUserLegacy) return null;
    return readLegacyHistorySession(userId, ref.fileName, {
        scope: ref.scope,
        ownerUserId: ref.ownerUserId,
        includeOwnerScope: Boolean(ref.ownerUserId)
    });
}

function deleteLegacyHistorySession(userId, sessionId, options = {}) {
    const includeSharedLegacy = Boolean(options.includeSharedLegacy);
    const includeAllUserLegacy = Boolean(options.includeAllUserLegacy);
    const ref = parseLegacySessionRef(sessionId);
    if (ref.scope === 'shared' && !includeSharedLegacy) return false;
    if (ref.ownerUserId && ref.ownerUserId !== userId && !includeAllUserLegacy) return false;
    const safeFileName = safeLegacyHistoryFileName(ref.fileName);
    if (!safeFileName) return false;
    const targetUserId = ref.ownerUserId || userId;

    const historyDir = ref.scope === 'shared' ? HISTORY_ROOT_DIR : getUserHistoryDir(targetUserId);
    const filePath = path.join(historyDir, safeFileName);
    const resolvedHistoryDir = path.resolve(historyDir);
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(resolvedHistoryDir + path.sep)) return false;
    if (!fs.existsSync(resolvedFilePath)) return false;

    fs.unlinkSync(resolvedFilePath);
    return true;
}

function mergeVisibleLiveSessionsWithLegacy(currentUser, sessionIds, options = {}) {
    const includeSharedLegacy = Boolean(options.includeSharedLegacy);
    const includeAllUserLegacy = Boolean(options.includeAllUserLegacy);
    const selectedIds = Array.isArray(sessionIds) ? sessionIds : [];
    const userSessions = selectedIds
        .filter(id => !String(id).startsWith('legacy:'))
        .map(id => getVisibleStoredLiveSession(currentUser, id))
        .filter(Boolean);
    const legacySessions = selectedIds
        .filter(id => String(id).startsWith('legacy:'))
        .map(id => getLegacyHistorySession(currentUser.uid, id, { includeSharedLegacy, includeAllUserLegacy }))
        .filter(Boolean);
    const selected = [...userSessions, ...legacySessions];

    if (selected.length === 0) return null;

    const mergedOrders = [];
    const seenOrderIds = new Set();
    selected.forEach(session => {
        (session.orders || []).forEach(order => {
            const key = order.id || `${session.id}_${order.customerUsername}_${order.productName}_${order.total}_${order.time}`;
            if (seenOrderIds.has(key)) return;
            seenOrderIds.add(key);
            mergedOrders.push({ ...order, fromSession: session.liveName });
        });
    });

    const summary = liveSessionStore.calculateSessionSummary(mergedOrders);
    const productSummary = liveSessionStore.calculateProductSummary(mergedOrders);
    const customerMap = {};
    mergedOrders.forEach(order => {
        const customerUsername = customerStore.normalizeTikTokUsername(order.customerUsername || order.tiktokUsername || '');
        const customerName = normalizeOrderCustomerName(order.customerName || order.nickname || '', customerUsername);
        const key = customerUsername || customerName || 'unknown';
        if (!customerMap[key]) {
            customerMap[key] = {
                customerName,
                customerUsername,
                profilePictureUrl: order.profilePictureUrl,
                orders: [],
                total: 0
            };
        }
        customerMap[key].orders.push(order);
        customerMap[key].total += Number(order.total || order.price || 0);
    });

    return {
        selectedSessions: selected.map(s => ({
            id: s.id,
            rawSessionId: s.rawSessionId || s.id,
            ownerUserId: s.ownerUserId || s.userId || currentUser.uid,
            liveName: s.liveName,
            tiktokUsername: s.tiktokUsername,
            startedAt: s.startedAt,
            summary: s.summary,
            source: s.source || 'live_session'
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

function buildExportDataset(scope, currentUser) {
    const includeSharedLegacy = isAdminOrSuperAdmin(currentUser);
    const live = readAllLiveSessionRows();
    const history = scope === 'all'
        ? readAllUserHistoryRows()
        : readLegacyHistoryRows(currentUser.uid, { includeSharedLegacy });
    const allRows = [...live.rows, ...history.rows];

    const sourceRows = scope === 'all'
        ? allRows
        : allRows.filter(r => r.userId === currentUser.uid);
    const rows = sourceRows.map(row => {
        if (row.source !== 'live_session') {
            return { ...row, orderDate: row.historyDate || '' };
        }
        const capture = row.sessionType === 'merged_session'
            ? resolveOrderCapture({ createdAt: row.orderCreatedAt })
            : resolveOrderCapture({
                createdAt: row.orderCreatedAt,
                sessionStartedAt: row.sessionStartedAt,
                sessionEndedAt: row.sessionEndedAt
            });
        return { ...row, orderDate: capture.date };
    });

    const totalRevenue = rows.reduce((sum, r) => sum + Number(r.total || 0), 0);
    const uniqueUsers = new Set(rows.map(r => r.userId).filter(Boolean)).size;
    const uniqueSessions = new Set(rows.map(r => r.sessionId || `${r.source}:${r.sessionName}`)).size;

    return {
        meta: {
            exportedAt: new Date().toISOString(),
            exportedBy: currentUser.email || currentUser.uid,
            scope,
            totalRows: rows.length,
            totalRevenue,
            uniqueUsers,
            uniqueSessions,
            sourceFiles: {
                liveSessionFiles: live.files,
                historyFiles: history.files
            }
        },
        rows
    };
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatDateKey(value) {
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(timestamp)) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(timestamp));
    const byType = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

function parseDateKey(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
}

function dateKeyOffset(dateKey, offsetDays) {
    const parsed = parseDateKey(dateKey);
    if (!parsed) return '';
    parsed.setUTCDate(parsed.getUTCDate() + offsetDays);
    return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}-${pad2(parsed.getUTCDate())}`;
}

function dateKeyDayDifference(start, end) {
    const left = parseDateKey(start);
    const right = parseDateKey(end);
    if (!left || !right) return 0;
    return Math.floor((right.getTime() - left.getTime()) / 86400000);
}

function normalizeOverviewRange(startQuery, endQuery) {
    const todayKey = formatDateKey(new Date());
    let start = parseDateKey(startQuery) ? formatDateKey(parseDateKey(startQuery)) : dateKeyOffset(todayKey, -6);
    let end = parseDateKey(endQuery) ? formatDateKey(parseDateKey(endQuery)) : todayKey;

    if (start > end) [start, end] = [end, start];

    const maxDays = 370;
    if (dateKeyDayDifference(start, end) > maxDays) start = dateKeyOffset(end, -maxDays);

    return { start, end };
}

function historyMetaFromFile(fileName) {
    const name = safeLegacyHistoryFileName(fileName);
    if (!name) return { date: '', shop: '' };

    const datedMatch = name.match(/^(\d{4}-\d{2}-\d{2})_(.+)\.json$/i);
    if (datedMatch) {
        return { date: datedMatch[1], shop: datedMatch[2] };
    }

    const sessMatch = name.match(/^sess_(\d{4}-\d{2}-\d{2})_[a-zA-Z0-9]+_(.+)\.json$/i);
    if (sessMatch) {
        return { date: sessMatch[1], shop: sessMatch[2] };
    }

    const sessionMatch = name.match(/^session_(\d+)_[a-zA-Z0-9]+_(.+)\.json$/i);
    if (sessionMatch) {
        const timestamp = Number(sessionMatch[1]);
        const date = Number.isFinite(timestamp) ? formatDateKey(new Date(timestamp)) : '';
        return { date, shop: sessionMatch[2] };
    }

    return { date: '', shop: '' };
}

function timestampFromParts(dateKey, timeText) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return NaN;
    const time = /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(timeText || ''))
        ? String(timeText).length === 5 ? `${timeText}:00` : String(timeText)
        : '00:00:00';
    const stamp = Date.parse(`${dateKey}T${time}+07:00`);
    return Number.isFinite(stamp) ? stamp : Date.parse(`${dateKey}T00:00:00+07:00`);
}

function dateKeyFromTimestamp(timestamp) {
    return Number.isFinite(timestamp) ? formatDateKey(new Date(timestamp)) : '';
}

function parsedTimestamp(value) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveOrderCapture({ createdAt, sessionStartedAt, sessionEndedAt }) {
    let timestamp = parsedTimestamp(createdAt);
    const startedAt = parsedTimestamp(sessionStartedAt);
    const endedAt = parsedTimestamp(sessionEndedAt);

    if (timestamp === null) timestamp = startedAt;
    if (timestamp === null) return { date: '', timestamp: NaN, dateKnown: false };

    if (startedAt !== null && timestamp < startedAt) timestamp = startedAt;
    if (endedAt !== null && (startedAt === null || endedAt >= startedAt) && timestamp > endedAt) timestamp = endedAt;

    return { date: dateKeyFromTimestamp(timestamp), timestamp, dateKnown: true };
}

function buildLiveSessionDailySummary(session) {
    const daily = new Map();
    (session?.orders || []).forEach(order => {
        const capture = session.type === 'merged_session'
            ? resolveOrderCapture({ createdAt: order.createdAt })
            : resolveOrderCapture({
                createdAt: order.createdAt,
                sessionStartedAt: session.startedAt,
                sessionEndedAt: session.endedAt
            });
        if (!capture.dateKnown) return;
        const current = daily.get(capture.date) || { date: capture.date, orders: 0, revenue: 0 };
        current.orders += 1;
        current.revenue += Number(order.total || order.price || 0);
        daily.set(capture.date, current);
    });
    return [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function currentLiveRows(currentUser) {
    const runtime = getLiveRuntime(currentUser.uid);
    const rows = [];
    Object.values(runtime.confirmedOrders || {}).forEach(customer => {
        const items = Array.isArray(customer?.items) ? customer.items : [];
        items.forEach(item => {
            const capture = resolveOrderCapture({
                createdAt: item.createdAt,
                sessionStartedAt: runtime.currentSessionStartedAt
            });
            rows.push({
                source: 'current_live',
                userId: currentUser.uid,
                date: capture.date,
                timestamp: capture.timestamp,
                dateKnown: capture.dateKnown,
                shop: runtime.currentBroadcasterId || '',
                orderId: String(item.id || ''),
                customer: normalizeOrderCustomerName(customer.nickname || customer.displayName || '', customer.username || ''),
                customerUsername: customerStore.normalizeTikTokUsername(customer.username || ''),
                productName: normalizeDisplayText(item.text || ''),
                quantity: 1,
                value: Number(item.price || 0),
                status: 'done'
            });
        });
    });
    return rows;
}

function liveSessionOverviewRows(currentUser) {
    const indexedRows = liveSessionStore.readIndexedRows(currentUser.uid);
    {
        return indexedRows
            .filter(row => Number(row.total || 0) > 0)
            .map(row => {
                const timestamp = Date.parse(row.createdAt || '');
                return {
                    source: 'live_session', userId: currentUser.uid,
                    date: row.captureDate || '', timestamp: Number.isFinite(timestamp) ? timestamp : NaN,
                    dateKnown: Boolean(row.captureDate), shop: '', orderId: String(row.orderId || ''),
                    eventId: row.eventId || '', requestId: row.requestId || '', sourceMessageId: row.sourceMessageId || '',
                    customer: normalizeOrderCustomerName(row.customerName || '', row.customerUsername || ''),
                    customerUsername: customerStore.normalizeTikTokUsername(row.customerUsername || ''),
                    productName: normalizeDisplayText(row.productName || ''), quantity: Number(row.quantity || 1),
                    value: Number(row.total || row.price || 0), status: row.replay ? 'pending' : 'done'
                };
            });
    }

}

function legacyHistoryOverviewRows(userId, options = {}) {
    return readLegacyHistoryRows(userId, options).rows
        .filter(row => Number(row.total || 0) > 0)
        .map(row => {
            const meta = historyMetaFromFile(row.historyFile);
            const date = row.historyDate || meta.date || '';
            return {
                source: 'legacy_history',
                userId,
                date,
                timestamp: timestampFromParts(date, row.itemTime),
                dateKnown: Boolean(date),
                shop: meta.shop || row.tiktokUsername || '',
                orderId: String(row.orderId || ''),
                customer: normalizeOrderCustomerName(row.customerName || '', row.customerUsername || ''),
                customerUsername: customerStore.normalizeTikTokUsername(row.customerUsername || ''),
                productName: normalizeDisplayText(row.productName || ''),
                quantity: Number(row.quantity || 1),
                value: Number(row.total || row.price || 0),
                status: 'done'
            };
        });
}

function buildOrdersDataset(currentUser, filters = {}) {
    const includeSharedLegacy = isAdminOrSuperAdmin(currentUser);
    const phoneByUsername = new Map();
    customerStore.readUserCustomers(currentUser.uid).forEach(customer => {
        const username = customerStore.normalizeTikTokUsername(customer.tiktokUsername || '');
        if (!username) return;
        const phone = normalizeDisplayText(customer.phone || '');
        phoneByUsername.set(username, phone);
    });

    const allRows = [
        ...currentLiveRows(currentUser),
        ...liveSessionOverviewRows(currentUser),
        ...legacyHistoryOverviewRows(currentUser.uid, { includeSharedLegacy })
    ];

    const parsedStart = parseDateKey(filters.start);
    const parsedEnd = parseDateKey(filters.end);
    const normalizedStart = parsedStart ? formatDateKey(parsedStart) : '';
    const normalizedEnd = parsedEnd ? formatDateKey(parsedEnd) : '';
    const q = String(filters.q || '').toLowerCase();
    const statusFilter = String(filters.status || 'all');
    const shopFilter = customerStore.normalizeTikTokUsername(filters.shop || '');

    // Strict aggregation by stable key (uid, eventId); resends with a different
    // eventId keep raw. No silent drop on (username+orderId) alone.
    const keyOf = (row) => {
        const uid = row.userId || currentUser.uid;
        const eventId = String(row.eventId || '').trim();
        const requestId = String(row.requestId || '').trim();
        const sourceMessageId = String(row.sourceMessageId || '').trim();
        const stableId = eventId || requestId || sourceMessageId;
        return stableId ? `${String(uid)}|${stableId}` : '';
    };
    const buckets = new Map();
    const mergedRows = [];
    for (const row of allRows) {
        const k = keyOf(row);
        if (!k) { mergedRows.push(row); continue; }
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(row);
    }

    let exact = 0, replay = 0, discord = 0;
    for (const rows of buckets.values()) {
        if (rows.length === 1) { mergedRows.push(rows[0]); continue; }
        // Same key, >1 raw row => keep all raw; one exact-dup is counted, the
        // rest are candidates. Without a stable id they stay as candidates.
        mergedRows.push(...rows);
        discord += rows.length - 1;
    }

    const mapped = mergedRows
        .map((row, index) => {
            const timestamp = Number.isFinite(row.timestamp) ? row.timestamp : timestampFromParts(row.date || formatDateKey(new Date()), '00:00:00');
            const customerUsername = customerStore.normalizeTikTokUsername(row.customerUsername || '');
            const phone = phoneByUsername.get(customerUsername) || '';
            const status = normalizeOrdersStatus(row.status);
            const shop = customerStore.normalizeTikTokUsername(row.shop || '');
            const orderId = String(row.orderId || '').trim();
            return {
                id: `${row.source}_${row.date || 'unknown'}_${customerUsername || 'guest'}_${orderId || index}`,
                orderId: orderId || `ORD-${String(index + 1).padStart(4, '0')}`,
                customerName: row.customer || '',
                customerUsername,
                phone,
                shop,
                productName: row.productName || '',
                quantity: Number(row.quantity || 1),
                total: Number(row.value || 0),
                totalCents: Math.round(Number(row.value || 0) * 100),
                status,
                source: row.source || 'live_session',
                date: row.date || '',
                timestamp,
                createdAt: new Date(timestamp).toISOString()
            };
        })
        .filter(order => {
            if (normalizedStart && order.date && order.date < normalizedStart) return false;
            if (normalizedEnd && order.date && order.date > normalizedEnd) return false;
            if (statusFilter !== 'all' && order.status !== statusFilter) return false;
            if (shopFilter && order.shop !== shopFilter) return false;
            if (!q) return true;
            const haystack = [
                order.orderId, order.customerName, order.customerUsername, order.phone,
                order.productName, order.shop
            ].join(' ').toLowerCase();
            return haystack.includes(q);
        })
        .sort((a, b) => b.timestamp - a.timestamp);

    const totals = {
        count: mapped.length,
        revenueCents: mapped.reduce((acc, o) => acc + o.totalCents, 0),
        distinctEventIds: new Set(mapped.map(o => o.orderId || o.customerUsername)).size
    };

    return {
        rows: mapped,
        dedupe: { exact, replay, discord },
        stats: { totals, sourceCount: mergedRows.length }
    };
}

function dedupeOverviewRows(rows) {
    const sourcePriority = { current_live: 0, live_session: 1, legacy_history: 2 };
    const seen = new Set();
    return rows
        .slice()
        .sort((a, b) => (sourcePriority[a.source] ?? 9) - (sourcePriority[b.source] ?? 9))
        .filter(row => {
            const normalizedOrderId = String(row.orderId || '').replace(/^order_/, '');
            const key = normalizedOrderId
                ? `${row.date}|${row.shop}|${row.customerUsername}|${normalizedOrderId}`
                : `${row.date}|${row.shop}|${row.customerUsername}|${row.productName}|${row.value}|${row.timestamp}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

// Rollup đa luồng: gộp 3 nguồn, không hard-drop replay. Trả về {rows, dups}.
//  - cùng khóa + cùng createdMs -> drop 1, đếm dups
//  - cùng khóa, createdMs khác -> giữ 2 dòng, row mới replay:false, cũ replay:true + seq
function dedupeWithReplay(rows) {
    const byKey = new Map();
    for (const r of rows) {
        const key = `${String(r.customerUsername || '').toLowerCase()}|${String(r.orderId || '').trim()}|${String(r.requestId || '').trim()}|${String(r.timestamp || 0)}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(r);
    }
    const out = [];
    let dups = 0;
    for (const [, group] of byKey) {
        group.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        if (group.length === 1) { out.push(group[0]); continue; }
        const firstTs = group[0].timestamp;
        const exact = group.filter((x) => x.timestamp === firstTs);
        if (exact.length > 1) {
            dups += exact.length - 1;
            out.push(exact[0]);
            continue;
        }
        for (let i = 0; i < group.length - 1; i += 1) group[i].replay = true;
        group[group.length - 1].replay = false;
        out.push(group[group.length - 1]);
    }
    return { rows: out, dups };
}

function dateRangeContains(range, dateKey) {
    return dateKey >= range.start && dateKey <= range.end;
}

function buildDailyOverview(rows, range) {
    const dailyMap = {};
    for (let key = range.start; key && key <= range.end; key = dateKeyOffset(key, 1)) {
        dailyMap[key] = { date: key, orders: 0, revenue: 0 };
    }
    rows.forEach(row => {
        if (!dailyMap[row.date]) return;
        dailyMap[row.date].orders += 1;
        dailyMap[row.date].revenue += Number(row.value || 0);
    });
    return Object.values(dailyMap);
}

function buildOverviewDataset(currentUser, range) {
    const includeSharedLegacy = isAdminOrSuperAdmin(currentUser);
    const runtime = getLiveRuntime(currentUser.uid);
    const renderAt = new Date();
    const allRows = [
        ...currentLiveRows(currentUser),
        ...liveSessionOverviewRows(currentUser),
        ...legacyHistoryOverviewRows(currentUser.uid, { includeSharedLegacy })
    ];
    const filtered = allRows.filter(row => row.date && dateRangeContains(range, row.date));
    const { rows: tagged, dups } = dedupeWithReplay(filtered);
    const data = tagged.filter(row => !row.replay);
    const todayKey = formatDateKey(renderAt);
    const comments = dateRangeContains(range, todayKey) && runtime.currentBroadcasterId
        ? (runtime.chatBufferByBroadcaster.get(runtime.currentBroadcasterId) || []).length
        : 0;
    const currentLiveOrderCount = data.filter(row => row.source === 'current_live').length;
    const totalOrders = data.length;
    const totalRevenue = data.reduce((sum, row) => sum + Number(row.value || 0), 0);
    const pendingOrders = data.filter(row => normalizeOrdersStatus(row.status) === 'pending').length;
    const failedOrders = data.filter(row => normalizeOrdersStatus(row.status) === 'failed').length;
    const closeRate = comments > 0 ? Math.min(99.9, (currentLiveOrderCount / comments) * 100) : 0;

    const topCustomerMap = {};
    data.forEach(row => {
        const customerKey = row.customerUsername || row.customer || 'unknown';
        if (!topCustomerMap[customerKey]) {
            topCustomerMap[customerKey] = {
                customer: row.customer || row.customerUsername || 'Không rõ',
                customerUsername: row.customerUsername || '',
                revenue: 0,
                orders: 0
            };
        }
        topCustomerMap[customerKey].orders += 1;
        topCustomerMap[customerKey].revenue += Number(row.value || 0);
    });

    return {
        summary: {
            orders: totalOrders,
            revenue: totalRevenue,
            pendingOrders,
            failedOrders,
            comments,
            activeLive: runtime.currentBroadcasterId ? 1 : 0,
            closeRate,
            dups
        },
        daily: buildDailyOverview(data, range),
        topShops: Object.values(topCustomerMap)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5),
        latestOrders: data
            .slice()
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 8)
            .map(row => ({
                id: row.orderId,
                customer: row.customer,
                shop: row.shop || 'unknown',
                value: row.value,
                status: row.status,
                date: row.date,
                time: new Date(row.timestamp).toLocaleTimeString('vi-VN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'Asia/Ho_Chi_Minh'
                })
            })),
        meta: {
            start: range.start,
            end: range.end,
            sources: ['current_live', 'live_session', 'legacy_history'],
            rows: data.length
        }
    };
}

function normalizeOrdersStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw || raw === 'done' || raw === 'success' || raw === 'completed') return 'done';
    if (['failed', 'cancelled', 'canceled', 'returned', 'refund'].includes(raw)) return 'failed';
    return 'pending';
}


function toCsv(rows) {
    const headers = [
        'source', 'userId', 'historyFile', 'historyDate', 'sessionId', 'sessionName',
        'sessionCreatedAt', 'tiktokUsername', 'orderId', 'customerName', 'customerUsername',
        'productName', 'quantity', 'price', 'total', 'itemTime', 'orderCreatedAt', 'orderDate'
    ];
    const lines = [headers.join(',')];
    rows.forEach(row => {
        lines.push(headers.map(h => escapeCsvValue(row[h] ?? '')).join(','));
    });
    return lines.join('\n');
}

function escapeXml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function toExcelXml(rows) {
    const headers = [
        'source', 'userId', 'historyFile', 'historyDate', 'sessionId', 'sessionName',
        'sessionCreatedAt', 'tiktokUsername', 'orderId', 'customerName', 'customerUsername',
        'productName', 'quantity', 'price', 'total', 'itemTime', 'orderCreatedAt', 'orderDate'
    ];
    const headerCells = headers.map(h => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join('');
    const bodyRows = rows.map(row => {
        const cells = headers.map(h => {
            const value = row[h] ?? '';
            const isNumber = ['quantity', 'price', 'total'].includes(h) && typeof value === 'number' && Number.isFinite(value);
            if (isNumber) return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
            return `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
        }).join('');
        return `<Row>${cells}</Row>`;
    }).join('');

    return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Orders Backup">
  <Table>
   <Row>${headerCells}</Row>
   ${bodyRows}
  </Table>
 </Worksheet>
</Workbook>`;
}

io.on('connection', (socket) => {
    const sessionUser = socket.request.session?.user;
    const userId = sessionUser?.uid;
    const includeSharedLegacy = isAdminOrSuperAdmin(sessionUser);
    if (!userId) {
        socket.disconnect(true);
        return;
    }

    const userRoom = getUserRoom(userId);
    const runtime = getLiveRuntime(userId);
    runtime.sockets.add(socket.id);
    socket.join(userRoom);

    socket.emit('system-config', { shopName, printerInterface, tiktokSignApiKey });

    socket.on('disconnect', () => {
        runtime.sockets.delete(socket.id);
        // Refresh/reconnect must not terminate or recreate the live run.
    });

    socket.on('update-settings', (data) => {
        if (data.shopName !== undefined) {
            shopName = normalizeDisplayText(data.shopName).slice(0, 120);
            saveConfig();
        }
        if (data.printerInterface !== undefined) {
            initPrinter(data.printerInterface);
        }
        if (data.tiktokSignApiKey !== undefined) {
            tiktokSignApiKey = data.tiktokSignApiKey;
            SignConfig.apiKey = tiktokSignApiKey;
            saveConfig();
        }
        socket.emit('system-status', "Đã cập nhật cấu hình hệ thống!");
    });

    socket.on('get-chat-buffer', ({ broadcasterId } = {}) => {
        const id = customerStore.normalizeTikTokUsername(broadcasterId);
        if (!id) return socket.emit('chat-buffer', { broadcasterId: '', comments: [] });
        const comments = runtime.chatBufferByBroadcaster.get(id) || [];
        socket.emit('chat-buffer', { broadcasterId: id, comments });
    });

    let recoveryOffer = null;
    const offerRecovery = (candidates) => {
        const versions = Object.fromEntries(candidates.map(c => [c.session.id, liveSessionStore.recoveryVersion(c.session)]));
        const signature = JSON.stringify([versions, runtime.selectionVersion || 0]);
        if (!recoveryOffer || recoveryOffer.signature !== signature) recoveryOffer = { id: generateRuntimeSessionId(), signature, versions, selectionVersion: runtime.selectionVersion || 0 };
        socket.emit('recovery-options', { offerId: recoveryOffer.id, sessions: candidates.map(c => ({ id: c.session.id, liveName: c.session.liveName, broadcasterId: c.session.tiktokUsername, startedAt: c.session.startedAt, lastActivityAt: c.lastActivityAt, stale: c.stale, ambiguous: c.ambiguous, summary: c.session.summary })) });
    };
    const recoverRuntime = () => {
        if (runtime.currentSessionId) return;
        const candidates = liveSessionStore.recoveryCandidates(userId);
        runtime.recoveryRequired = candidates.length > 1 || candidates.some(c => c.stale || c.ambiguous);
        if (candidates.length === 1 && !runtime.recoveryRequired) {
            const { session, segment } = candidates[0];
            runtime.currentSessionId = session.id;
            runtime.currentSessionStartedAt = segment.startedAt;
            runtime.currentBroadcasterId = session.tiktokUsername;
            runtime.confirmedOrders = rebuildConfirmedOrders(segment.orders);
            runtime.connectionState = 'disconnected';
            runtime.selectionVersion = (runtime.selectionVersion || 0) + 1;
        }
        if (runtime.recoveryRequired) offerRecovery(candidates);
    };
    const sendLiveState = () => {
        recoverRuntime();
        socket.emit('live-state', {
            sessionId: runtime.currentSessionId,
            segmentStartedAt: runtime.currentSessionStartedAt,
            recoveryRequired: Boolean(runtime.recoveryRequired),
            broadcasterId: runtime.currentBroadcasterId,
            connected: runtime.connectionState === 'connected',
            connecting: runtime.connectionState === 'connecting'
        });
        socket.emit('all-confirmed-orders', runtime.confirmedOrders);
    };
    const queued = handler => (...args) => liveSessionStore.serialize(userId, () => handler(...args)).catch(error => {
        const acknowledge = args.at(-1);
        if (typeof acknowledge === 'function') acknowledge({ ok: false, error: error.message, reloadRecovery: true });
        socket.emit('status', { connected: false, error: error.message, broadcasterId: runtime.currentBroadcasterId });
    });
    socket.on('get-live-state', queued(sendLiveState));
    socket.on('get-recovery-options', queued(() => {
        sendLiveState();
        if (!runtime.currentSessionId && !runtime.recoveryRequired) offerRecovery(liveSessionStore.recoveryCandidates(userId));
    }));
    queued(sendLiveState)();

    const endLive = (payload = {}) => {
        const expectedSessionId = payload.sessionId || runtime.currentSessionId;
        return queued(async () => {
        if (!runtime.currentSessionId) return;
        if (runtime.currentSessionId !== expectedSessionId) throw new Error('Phiên cần kết thúc đã thay đổi');
        let committed = false;
        try {
            const session = await liveSessionStore.updateLiveSession(userId, runtime.currentSessionId, {
                orders: sanitizeConfirmedOrders(runtime.confirmedOrders), segmentStartedAt: runtime.currentSessionStartedAt, endedAt: new Date().toISOString()
            });
            committed = true;
            liveSessionStore.requestIndexUpdate(userId, true);
            const connection = runtime.tiktokConnection;
            runtime.tiktokConnection = null;
            runtime.currentSessionId = null;
            runtime.selectionVersion = (runtime.selectionVersion || 0) + 1;
            runtime.currentSessionStartedAt = null;
            runtime.currentBroadcasterId = '';
            runtime.connectionState = 'idle';
            runtime.confirmedOrders = {};
            if (connection) { try { connection.disconnect(); } catch (e) {} }
            emitToUser(userId, 'all-confirmed-orders', {});
            emitToUser(userId, 'status', { connected: false, broadcasterId: '', error: '' });
            emitToUser(userId, 'session-ended', { saved: true, session });
            emitToUser(userId, 'live-state', { sessionId: null, broadcasterId: '', connected: false });
        } catch (error) {
            if (committed) console.error('Phiên đã commit kết thúc, lỗi phát trạng thái:', error.message);
            else socket.emit('session-ended', { saved: false, error: error.message });
        }
        })();
    };

    socket.on('start-live', queued(async (payload, acknowledge) => {
        const reply = data => { if (typeof acknowledge === 'function') acknowledge(data); };
        const recoveryIntent = payload?.recoveryConfirmed === true;
        const rejectStart = error => {
            reply({ ok: false, error: error.message, reloadRecovery: true });
            socket.emit('status', { connected: runtime.connectionState === 'connected', error: error.message, broadcasterId: runtime.currentBroadcasterId });
        };
        let recovery, recoveryMeta;
        if (recoveryIntent) {
            recoveryMeta = liveSessionStore.operationMeta('recovery-start', payload, payload.recoveryOfferId || '');
            if (!recoveryMeta.requestId || !payload.recoveryOfferId) return rejectStart(new Error('Thiếu mã yêu cầu recovery. Hãy tải lại lựa chọn.'));
            if (await liveSessionStore.isDuplicate(userId, recoveryMeta)) {
                reply({ ok: true, duplicate: true });
                return sendLiveState();
            }
            if (!recoveryOffer || recoveryOffer.id !== payload.recoveryOfferId || recoveryOffer.selectionVersion !== (runtime.selectionVersion || 0) || runtime.currentSessionId) return rejectStart(new Error('Phiên đã được chọn hoặc lựa chọn recovery đã cũ. Hãy tải lại trạng thái.'));
            recovery = { confirmed: true, versions: recoveryOffer.versions };
        } else if (payload?.closeSessionIds?.length) return rejectStart(new Error('Đóng phiên cũ cần xác nhận recovery'));
        // payload co the la string (backward compatible) hoac object { uniqueId, resumeSessionId }
        const rawId = typeof payload === 'string' ? payload : payload?.uniqueId;
        // undefined = chua quyet dinh, null = tao moi, string = resume session cu
        const resumeSessionId = (typeof payload === 'object' && payload !== null)
            ? payload.resumeSessionId
            : undefined;

        const broadcasterId = customerStore.normalizeTikTokUsername(rawId);
        if (!broadcasterId) {
            return rejectStart(new Error('TikTok ID không hợp lệ'));
        }

        if (runtime.currentSessionId && runtime.currentBroadcasterId !== broadcasterId) {
            return socket.emit('status', { connected: runtime.connectionState === 'connected', error: 'Hãy kết thúc phiên hiện tại trước khi đổi chủ live', broadcasterId: runtime.currentBroadcasterId });
        }
        if (runtime.currentSessionId && ((resumeSessionId && resumeSessionId !== runtime.currentSessionId) || payload?.closeSessionIds?.length)) {
            return socket.emit('status', { connected: runtime.connectionState === 'connected', error: 'Phiên đã được chọn ở cửa sổ khác. Hãy tải lại trạng thái trước khi tiếp tục.', broadcasterId: runtime.currentBroadcasterId });
        }
        if (runtime.tiktokConnection) return sendLiveState();
        if (runtime.recoveryRequired && !payload?.recoveryConfirmed) return sendLiveState();

        // Ask even when the last run was explicitly ended.
        if (!runtime.currentSessionId && resumeSessionId === undefined) {
            let allSessions;
            try { allSessions = liveSessionStore.readUserSessions(userId); } catch (error) {
                return socket.emit('status', { connected: false, error: error.message, broadcasterId });
            }
            const lastSession = allSessions.find(s =>
                s.tiktokUsername === broadcasterId && s.type === 'live_session'
            );
            if (lastSession) {
                return socket.emit('ask-resume-session', {
                    broadcasterId,
                    session: {
                        id: lastSession.id,
                        liveName: lastSession.liveName,
                        startedAt: lastSession.startedAt,
                        endedAt: lastSession.endedAt,
                        summary: lastSession.summary || { totalOrders: 0, totalRevenue: 0 }
                    }
                });
            }
        }

        const now = new Date();
        const candidates = liveSessionStore.recoveryCandidates(userId);
        const closeSessionIds = payload?.closeSessionIds === undefined ? [] : payload.closeSessionIds;
        if (!Array.isArray(closeSessionIds)) return rejectStart(new Error('Danh sách phiên cần đóng không hợp lệ'));
        if (!runtime.currentSessionId && candidates.length && !resumeSessionId && !closeSessionIds.length) {
            runtime.recoveryRequired = true;
            return sendLiveState();
        }
        if (runtime.recoveryRequired && !payload?.recoveryConfirmed) return sendLiveState();

        if (!runtime.currentSessionId) {
            try {
                const session = await liveSessionStore.startLiveSession(userId, {
                    broadcasterId, resumeSessionId, closeSessionIds, recovery, meta: recoveryMeta,
                    startedAt: now.toISOString(), liveName: formatLiveName(broadcasterId, now)
                });
                runtime.confirmedOrders = rebuildConfirmedOrders(session.currentSegmentOrders || []);
                runtime.currentSessionId = session.id;
                runtime.currentSessionStartedAt = session.currentSegmentStartedAt || session.startedAt;
                runtime.recoveryRequired = false;
                runtime.selectionVersion = (runtime.selectionVersion || 0) + 1;
            } catch (error) {
                return rejectStart(error);
            }
        }

        runtime.currentBroadcasterId = broadcasterId;
        runtime.recoveryRequired = false;
        reply({ ok: true, sessionId: runtime.currentSessionId });
        runtime.processedMsgIds.clear();
        emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);

        const userConnection = new WebcastPushConnection(broadcasterId);
        runtime.tiktokConnection = userConnection;
        runtime.connectionState = 'connecting';
        emitToUser(userId, 'live-state', { sessionId: runtime.currentSessionId, segmentStartedAt: runtime.currentSessionStartedAt, broadcasterId, connected: false, connecting: true });
        userConnection.on('streamEnd', () => {
            if (runtime.tiktokConnection === userConnection && !shuttingDown) endLive();
        });
        userConnection.on('disconnected', () => {
            if (runtime.tiktokConnection !== userConnection) return;
            runtime.tiktokConnection = null;
            runtime.connectionState = 'disconnected';
            emitToUser(userId, 'status', { connected: false, broadcasterId, error: 'Mất kết nối. Bấm Bắt đầu Live để kết nối lại phiên hiện tại.' });
        });

        userConnection.connect().then(state => {
            if (runtime.tiktokConnection !== userConnection) return;
            runtime.connectionState = 'connected';
            emitToUser(userId, 'status', { connected: true, roomId: state.roomId, broadcasterId });
        }).catch(err => {
            if (runtime.tiktokConnection !== userConnection) return;
            runtime.tiktokConnection = null;
            runtime.connectionState = 'disconnected';
            console.error(`TikTok Connection Error [${userId}]:`, err);
            let errorMessage = "Lỗi không xác định";

            if (err && (err.name === 'SignatureRateLimitError' || (err.message && err.message.includes('rate_limit')))) {
                errorMessage = "Đại ca ơi, TikTok nó chặn rồi (Rate Limit)! Đợi xíu tầm 1-2 phút rồi thử lại nhé. Hoặc Đại ca nạp API Key của EulerStream vào phần cài đặt cho nó mượt!";
            } else if (err && err.message && err.message.includes('Unexpected server response: 200')) {
                errorMessage = "Kết nối bị từ chối (200). Đại ca thử lại phát nữa xem, hoặc kiểm tra xem ID TikTok đúng chưa nhé!";
            } else {
                errorMessage = (err && err.message) ? err.message : (err ? err.toString() : "Lỗi kết nối TikTok");
            }

            emitToUser(userId, 'status', { connected: false, error: errorMessage, broadcasterId });
        });

        userConnection.on('chat', (data) => {
            if (runtime.tiktokConnection !== userConnection) return;
            if (data.msgId != null && String(data.msgId)) {
                const messageId = String(data.msgId);
                if (runtime.processedMsgIds.has(messageId)) return;
                runtime.processedMsgIds.add(messageId);
                setTimeout(() => {
                    if (runtime.tiktokConnection === userConnection) runtime.processedMsgIds.delete(messageId);
                }, 120000);
            }

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
            if (currentBuffer.length > CHAT_BUFFER_LIMIT) {
                currentBuffer.splice(0, currentBuffer.length - CHAT_BUFFER_LIMIT);
            }
            runtime.chatBufferByBroadcaster.set(broadcasterId, currentBuffer);

            emitToUser(userId, 'raw-chat', chatPayload);
        });
    }));

    socket.on('end-live', endLive);

    const onOrderMutation = (event, handler) => socket.on(event, (payload = {}, acknowledge) => {
        const expectedSessionId = payload.sessionId;
        let committed = false;
        const reply = result => { if (typeof acknowledge === 'function') acknowledge(result); };
        return liveSessionStore.serialize(userId, async () => {
            const meta = liveSessionStore.operationMeta(event, payload, expectedSessionId);
            if (!meta.requestId || !expectedSessionId) throw new Error('Thiếu requestId hoặc sessionId; vui lòng tải lại trang');
            if (await liveSessionStore.isDuplicate(userId, meta)) { committed = true; return reply({ ok: true, duplicate: true }); }
            if (runtime.recoveryRequired || !runtime.currentSessionId || runtime.currentSessionId !== expectedSessionId || payload.segmentStartedAt !== runtime.currentSessionStartedAt) throw new Error('Phiên live đã thay đổi. Vui lòng tải lại dữ liệu.');
            const draft = { ...runtime, confirmedOrders: JSON.parse(JSON.stringify(runtime.confirmedOrders)) };
            const result = handler(draft, payload);
            if (result?.duplicate) {
                await liveSessionStore.recordReceipt(userId, meta);
                committed = true;
                return reply({ ok: true, duplicate: true });
            }
            await saveSessionDataForUser(userId, draft, meta);
            committed = true;
            runtime.confirmedOrders = draft.confirmedOrders;
            reply({ ok: true });
            emitToUser(userId, 'all-confirmed-orders', runtime.confirmedOrders);
            if (result?.item) {
                emitToUser(userId, 'order-confirmed', runtime.confirmedOrders[result.username]);
                try { printBill(result.item, runtime.confirmedOrders[result.username], userId, currentReceiptContext(userId, runtime)); }
                catch (error) { console.error('Đơn đã lưu, lỗi in:', error.message); }
            }
        }).catch(error => {
            if (committed) { console.error('Đơn đã commit, lỗi phản hồi:', error.message); return; }
            reply({ ok: false, error: error.message });
            socket.emit('system-status', 'Không thể lưu đơn: ' + error.message);
        });
    });
    onOrderMutation('confirm-item', (draft, data) => {
        const username = customerStore.normalizeTikTokUsername(data.uniqueId || data.username || '');
        if (!username) throw new Error('Khách hàng không hợp lệ');
        const sourceMessageId = typeof data.sourceMessageId === 'string' ? data.sourceMessageId : '';
        const sourceBroadcasterId = customerStore.normalizeTikTokUsername(data.sourceBroadcasterId || '');
        if (sourceMessageId && sourceBroadcasterId !== draft.currentBroadcasterId) throw new Error('Bình luận thuộc chủ live khác');
        const existing = Object.values(draft.confirmedOrders).flatMap(c => c.items || []).find(item =>
            item.requestId === data.requestId || (sourceMessageId && item.sourceMessageId === sourceMessageId && item.sourceBroadcasterId === sourceBroadcasterId));
        if (existing) return { duplicate: true };
        const price = Number(data.price);
        if (!Number.isSafeInteger(price) || price <= 0) throw new Error('Giá không hợp lệ');
        if (!Object.hasOwn(draft.confirmedOrders, username)) Object.defineProperty(draft.confirmedOrders, username, { enumerable: true, writable: true, value: { username, nickname: cleanDisplayText(data.nickname || data.displayName || '') || displayFallbackFromUsername(username) || username, profilePictureUrl: normalizeDisplayText(data.profilePictureUrl || ''), items: [], total: 0 } });
        const item = { id: data.requestId, text: normalizeDisplayText(data.comment || ''), price, time: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }), createdAt: new Date().toISOString(), requestId: data.requestId, sourceMessageId, sourceBroadcasterId };
        draft.confirmedOrders[username].items.push(item);
        draft.confirmedOrders[username].total += price;
        return { item, username };
    });
    onOrderMutation('replace-confirmed-orders', (draft, payload) => {
        if (customerStore.normalizeTikTokUsername(payload.broadcasterId || '') !== draft.currentBroadcasterId) throw new Error('Chủ live đã thay đổi');
        draft.confirmedOrders = sanitizeConfirmedOrders(payload.orders || {});
    });
    onOrderMutation('delete-customer', (draft, { username }) => { delete draft.confirmedOrders[customerStore.normalizeTikTokUsername(username)]; });
    onOrderMutation('delete-item', (draft, { username, itemId }) => {
        const key = customerStore.normalizeTikTokUsername(username);
        const customer = draft.confirmedOrders[key];
        if (!customer) return;
        customer.items = customer.items.filter(item => String(item.id) !== String(itemId));
        customer.total = customer.items.reduce((sum, item) => sum + Number(item.price), 0);
        if (!customer.items.length) delete draft.confirmedOrders[key];
    });
    const editItem = (draft, { username, itemId, text, price, newPrice }) => {
        const customer = draft.confirmedOrders[customerStore.normalizeTikTokUsername(username)];
        const item = customer?.items.find(i => String(i.id) === String(itemId));
        if (!item) throw new Error('Không tìm thấy đơn');
        const amount = Number(price ?? newPrice);
        if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Giá không hợp lệ');
        item.price = amount;
        if (text !== undefined) item.text = normalizeDisplayText(text);
        customer.total = customer.items.reduce((sum, i) => sum + Number(i.price), 0);
    };
    onOrderMutation('edit-item', editItem);
    onOrderMutation('edit-item-price', editItem);

    socket.on('reprint-item', ({ username, itemId }) => {
        const normalizedUsername = customerStore.normalizeTikTokUsername(username);
        if (runtime.confirmedOrders[normalizedUsername]) {
            const item = runtime.confirmedOrders[normalizedUsername].items.find(i => i.id === itemId);
            if (item) printBill(item, runtime.confirmedOrders[normalizedUsername], userId, currentReceiptContext(userId, runtime));
        }
    });

    socket.on('reprint-total', (username) => {
        const normalizedUsername = customerStore.normalizeTikTokUsername(username);
        if (runtime.confirmedOrders[normalizedUsername]) {
            printDetailedBill(runtime.confirmedOrders[normalizedUsername], userId, currentReceiptContext(userId, runtime));
        }
    });

    socket.on('get-history-list', () => {
        const historyDir = getUserHistoryDir(userId);
        const userFiles = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter(f => f.endsWith('.json')) : [];
        const sharedFiles = includeSharedLegacy && fs.existsSync(HISTORY_ROOT_DIR)
            ? fs.readdirSync(HISTORY_ROOT_DIR).filter(f => f.endsWith('.json')).filter(f => safeLegacyHistoryFileName(f))
            : [];

        const historyList = userFiles.map(f => {
            const stats = fs.statSync(path.join(historyDir, f));
            return { fileName: f, mtime: stats.mtime };
        });

        sharedFiles.forEach(f => {
            const stats = fs.statSync(path.join(HISTORY_ROOT_DIR, f));
            historyList.push({ fileName: `shared:${f}`, mtime: stats.mtime });
        });

        historyList.sort((a, b) => b.mtime - a.mtime);
        socket.emit('history-list', historyList);
    });

    socket.on('load-history-file', (fileName) => {
        const rawFileName = String(fileName || '');
        const isSharedFile = rawFileName.startsWith('shared:');
        if (isSharedFile && !includeSharedLegacy) return;
        const targetName = isSharedFile ? rawFileName.replace(/^shared:/, '') : rawFileName;
        const safeFileName = safeLegacyHistoryFileName(targetName);
        if (!safeFileName) return;
        const historyDir = isSharedFile ? HISTORY_ROOT_DIR : getUserHistoryDir(userId);
        const filePath = path.join(historyDir, safeFileName);
        if (!fs.existsSync(filePath)) return;
        try {
            // Compatibility read only. Edits use the ownership/version-checked history API.
            const orders = sanitizeConfirmedOrders(JSON.parse(fs.readFileSync(filePath, 'utf8')));
            socket.emit('history-data', { fileName: isSharedFile ? `shared:${safeFileName}` : safeFileName, data: orders });
        } catch (error) {
            socket.emit('system-status', `Không thể đọc lịch sử: ${error.message}`);
        }
    });
});

let stopNotifications;
let stopDispatch;
const PORT = process.env.PORT || 3000;
liveSessionStore.initialize().then(() => server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
    quoteQueue.recoverZaloSending();
    stopNotifications = n8nNotifications.start();
    stopDispatch = n8nZaloDispatch.start();
    zaloAutoReply.start();
})).catch(error => { console.error('Live store startup failed:', error.message); process.exit(1); });

async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => { console.error('Shutdown deadline exceeded'); process.exit(1); }, 25000);
    try {
        zaloAutoReply.stop();
        await liveSessionStore.drain();
        for (const runtime of liveRuntimeByUser.values()) {
            try { runtime.tiktokConnection?.disconnect(); } catch (_) { /* continue closing */ }
        }
        await Promise.all([
            stopNotifications?.(), stopDispatch?.(),
            new Promise(resolve => io.close(resolve))
        ]);
        sessionStore?.close();
        clearTimeout(deadline);
        process.exit(0);
    } catch (error) {
        console.error('Shutdown failed:', error.message);
        process.exit(1);
    }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('uncaughtException', error => { console.error('Uncaught exception:', error); process.exit(1); });
