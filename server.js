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
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const liveSessionStore = require('./utils/liveSessionStore');
const customerStore = require('./utils/customerStore');
const orderExcelExporter = require('./utils/orderExcelExporter');
const { cleanDisplayText, normalizeDisplayName, normalizeDisplayText } = require('./utils/displayName');
const adminRoutes = require('./routes/admin');
const debtRoutes = require('./routes/debts');

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
    serviceAccount = require('./firebase-service-account.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin initialized.");
} catch (e) {
    console.warn("Could not load firebase-service-account.json. Firebase Auth will fail.");
}

const app = express();

// SECURITY: Helmet helps secure Express apps by setting various HTTP headers
app.use(helmet({
    contentSecurityPolicy: false, // Tắt CSP nếu bro có dùng nhiều inline scripts hoặc external resources linh tinh
}));

// SECURITY: Rate Limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // limit each IP to 200 requests per windowMs
    message: { error: 'Quá nhiều yêu cầu từ IP này, vui lòng thử lại sau 15 phút' }
});
app.use('/api/', limiter);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// SECURITY: SESSION_SECRET is required in .env
if (!process.env.SESSION_SECRET) {
    console.error('❌ FATAL: SESSION_SECRET must be set in .env file');
    process.exit(1);
}

const sessionMiddleware = session({
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
            resetLiveRuntime(userId);
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
            summary: s.summary
        }));
        const legacyList = readLegacyHistorySessions(userId, {
            includeSharedLegacy,
            includeAllUserLegacy: isAdminOrSuperAdmin(user),
            includeOwnerScope: isAdminOrSuperAdmin(user)
        });
        const combinedList = [...list, ...legacyList].sort((a, b) => {
            const left = Date.parse(a.createdAt || a.startedAt || 0) || 0;
            const right = Date.parse(b.createdAt || b.startedAt || 0) || 0;
            return right - left;
        });
        res.json({ sessions: combinedList });
    } catch (error) {
        console.error('Lỗi lấy danh sách phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// POST /api/live-sessions/merged — Lưu kết quả gộp thành 1 phiên mới
app.post('/api/live-sessions/merged', requireApiAuth, (req, res) => {
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
        const liveName = `Phiên gộp ${now.toLocaleDateString('vi-VN')} ${now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
        const newSession = liveSessionStore.createLiveSession(user.uid, {
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
app.post('/api/live-sessions', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const { liveName, tiktokUsername, startedAt, endedAt, orders } = req.body;

        if (!orders || (Array.isArray(orders) && orders.length === 0) ||
            (typeof orders === 'object' && !Array.isArray(orders) && Object.keys(orders).length === 0)) {
            return res.status(400).json({ error: 'Không có đơn hàng để lưu' });
        }

        const newSession = liveSessionStore.createLiveSession(userId, {
            liveName,
            tiktokUsername,
            startedAt,
            endedAt,
            orders
        });

        console.log(`>>> Đã lưu phiên live "${newSession.liveName}" cho user ${userId} (${newSession.summary.totalOrders} đơn)`);
        res.json({ success: true, session: newSession });
    } catch (error) {
        console.error('Lỗi tạo phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
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

        res.json({ session, orders, comments: [] }); // comments: [] - chưa lưu chi tiết
    } catch (error) {
        console.error('Lỗi lấy chi tiết phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// DELETE /api/live-sessions/:sessionId — Xóa phiên live
app.delete('/api/live-sessions/:sessionId', requireApiAuth, (req, res) => {
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

        const deleted = deleteVisibleStoredLiveSession(user, req.params.sessionId);
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
        const sessions = liveSessionStore.readUserSessions(userId);
        const legacyList = readLegacyHistorySessions(userId, {
            includeSharedLegacy: isAdminOrSuperAdmin(req.session.user),
            includeAllUserLegacy: isAdminOrSuperAdmin(req.session.user)
        });
        const allSessions = [...sessions, ...legacyList];
        const candidates = new Map();

        allSessions.forEach(session => {
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
app.use('/api/debts', debtRoutes);
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
const io = new Server(server, { cors: { origin: "*" } });

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

function generateSessionId(broadcasterId) {
    const date = new Date().toISOString().split('T')[0];
    const rand = Math.random().toString(36).slice(2, 8);
    return `sess_${date}_${rand}`;
}

function getSessionFileName(userId, broadcasterId, sessionId) {
    const safeBroadcasterId = customerStore.normalizeTikTokUsername(broadcasterId) || 'unknown';
    if (sessionId) {
        return path.join(getUserHistoryDir(userId), `${sessionId}_${safeBroadcasterId}.json`);
    }
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    // Đường dẫn file của hôm nay
    const todayFile = path.join(getUserHistoryDir(userId), `${todayStr}_${safeBroadcasterId}.json`);
    
    // Nếu hiện tại là sáng sớm (từ 0h đến 6h sáng)
    if (now.getHours() < 6) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const yesterdayFile = path.join(getUserHistoryDir(userId), `${yesterdayStr}_${safeBroadcasterId}.json`);
        
        // Nếu file hôm nay chưa tồn tại mà file hôm qua đã có dữ liệu, dùng tiếp file hôm qua
        if (!fs.existsSync(todayFile) && fs.existsSync(yesterdayFile)) {
            console.log(`>>> Live xuyên đêm phát hiện: Dùng tiếp file phiên live hôm qua: ${yesterdayStr}`);
            return yesterdayFile;
        }
    }
    
    return todayFile;
}

function createEmptyLiveRuntime(userId) {
    return {
        userId,
        tiktokConnection: null,
        confirmedOrders: {},
        currentBroadcasterId: '',
        sessionId: null,
        sessionStartedAt: null,
        gracePeriodTimer: null,
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
    if (runtime.gracePeriodTimer) {
        clearTimeout(runtime.gracePeriodTimer);
    }
    if (runtime.tiktokConnection) {
        try { runtime.tiktokConnection.disconnect(); } catch (e) {}
    }
    runtime.tiktokConnection = null;
    runtime.confirmedOrders = {};
    runtime.currentBroadcasterId = '';
    runtime.sessionId = null;
    runtime.sessionStartedAt = null;
    runtime.gracePeriodTimer = null;
    runtime.processedMsgIds.clear();
    runtime.chatBufferByBroadcaster.clear();
    runtime.sockets.clear();
    liveRuntimeByUser.delete(userId);
}

function saveSessionDataForUser(userId) {
    const runtime = getLiveRuntime(userId);
    if (!runtime.currentBroadcasterId) return;
    const fileName = getSessionFileName(userId, runtime.currentBroadcasterId, runtime.sessionId);
    runtime.confirmedOrders = sanitizeConfirmedOrders(runtime.confirmedOrders);
    fs.writeFileSync(fileName, JSON.stringify(runtime.confirmedOrders, null, 2));
}

function internalSaveLiveSession(userId, runtime) {
    const now = new Date();
    const broadcasterId = runtime.currentBroadcasterId;
    if (!broadcasterId) return;

    // Chuyển đổi confirmedOrders sang format orders[]
    const orders = Object.values(runtime.confirmedOrders || {}).flatMap(customer =>
        (customer.items || []).map(item => ({
            id: `order_${item.id || Date.now()}`,
            customerName: customer.nickname || customer.username,
            customerUsername: customer.username,
            profilePictureUrl: customer.profilePictureUrl || '',
            productName: item.text || '',
            quantity: 1,
            price: item.price || 0,
            total: item.price || 0,
            note: '',
            time: item.time || '',
            createdAt: now.toISOString()
        }))
    );

    if (orders.length === 0) return;

    const liveName = `Live @${broadcasterId} ${now.toLocaleDateString('vi-VN')} (tự động)`;
    const sessionData = {
        id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId,
        liveName,
        tiktokUsername: broadcasterId,
        startedAt: runtime.sessionStartedAt || now.toISOString(),
        endedAt: now.toISOString(),
        createdAt: now.toISOString(),
        orders,
        summary: {
            totalOrders: orders.length,
            totalQuantity: orders.length,
            totalRevenue: orders.reduce((s, o) => s + (o.price || 0), 0)
        }
    };

    const sessionsFile = path.join(DATA_DIR, 'live-sessions', `${safeStorageId(userId)}.json`);
    let existing = { sessions: [] };
    if (fs.existsSync(sessionsFile)) {
        try { existing = JSON.parse(fs.readFileSync(sessionsFile)); } catch(e) {}
    }
    existing.sessions = [sessionData, ...(existing.sessions || [])];
    fs.mkdirSync(path.dirname(sessionsFile), { recursive: true });
    fs.writeFileSync(sessionsFile, JSON.stringify(existing, null, 2));
    console.log(`>>> Auto-saved live session for user ${userId}: ${liveName}`);
}

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE));
        printerInterface = config.printerInterface || printerInterface;
        tiktokSignApiKey = config.tiktokSignApiKey || '';
        if (tiktokSignApiKey) {
            SignConfig.apiKey = tiktokSignApiKey;
        }
    } catch(e) {}
}

function saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ printerInterface, tiktokSignApiKey }, null, 2));
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
    if (!str) return '';
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g,"a"); 
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g,"e"); 
    str = str.replace(/ì|í|ị|ỉ|ĩ/g,"i"); 
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g,"o"); 
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g,"u"); 
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g,"y"); 
    str = str.replace(/đ/g,"d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
    return str;
}

async function printBill(item, order, userId) {
    if (!printer) return;
    try {
        const displayName = normalizeOrderCustomerName(order.nickname, order.username);
        console.log(`>>> Đang đẩy lệnh in: ${displayName} - ${item.text}`);
        
        printer.clear();
        printer.alignCenter();
        
        // TÊN KHÁCH HÀNG & ID (TO VỪA & ĐẬM)
        printer.setTextDoubleHeight();
        printer.setTextDoubleWidth();
        printer.bold(true);
        printer.println(removeVietnameseTones(`${displayName} - ${order.username}`));
        
        // TIME (BÌNH THƯỜNG)
        printer.setTextNormal();
        printer.bold(false);
        const date = new Date().toLocaleDateString('vi-VN', {day: '2-digit', month: '2-digit', year: 'numeric'});
        printer.println(`${date} ${item.time}`);
        
        printer.println("--------------------------------");

        // NỘI DUNG CHỐT & GIÁ (TO NHẤT ĐỂ DỄ NHÌN)
        printer.alignCenter();
        printer.setTextQuadArea();
        printer.bold(true);
        
        // Nội dung món hàng
        printer.println(removeVietnameseTones(item.text));
        
        // Giá
        printer.println(new Intl.NumberFormat('vi-VN').format(item.price));
        
        printer.setTextNormal();
        printer.bold(false);
        printer.println("--------------------------------");

        // FOOTER
        printer.alignCenter();
        printer.bold(true);
        printer.println("LH: 0828642688_@anhthuhcm1");
        printer.bold(false);
        printer.println(removeVietnameseTones("Cảm ơn cục zàng đã ủng hộ nha"));
        
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

async function printDetailedBill(order, userId) {
    if (!printer) return;
    try {
        const displayName = normalizeOrderCustomerName(order.nickname, order.username);
        console.log(`>>> Đang in bill chi tiết cho khách: ${displayName}`);
        
        printer.clear();
        printer.alignCenter();
        printer.setTextNormal();
        printer.println("HOA DON TONG HOP");
        printer.println("--------------------------------");

        // THÔNG TIN KHÁCH
        printer.alignLeft();
        printer.setTextDoubleHeight();
        printer.bold(true);
        printer.println(`${displayName}`);
        
        printer.setTextNormal();
        printer.bold(false);
        printer.println(`ID: @${order.username}`);
        printer.println("--------------------------------");

        // LIÊT KÊ CÁC MÓN
        order.items.forEach((item, index) => {
            printer.alignLeft();
            printer.bold(true);
            printer.println(`${index + 1}. ${item.text}`);
            printer.bold(false);
            printer.alignRight();
            printer.println(`${new Intl.NumberFormat('vi-VN').format(item.price)} D  (${item.time})`);
            printer.println(""); // Dòng trống giữa các món
        });

        printer.alignCenter();
        printer.println("--------------------------------");

        // TỔNG CỘNG (SIÊU TO)
        printer.setTextDoubleHeight();
        printer.setTextDoubleWidth();
        printer.bold(true);
        printer.println("TONG CONG:");
        printer.println(`${new Intl.NumberFormat('vi-VN').format(order.total)} D`);
        
        printer.setTextNormal();
        printer.println("--------------------------------");
        printer.alignCenter();
        printer.println(removeVietnameseTones("Cảm ơn cục zàng đã ủng hộ nha"));
        
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
    if (!text) return 0;
    // Chuẩn hóa: xóa dấu chấm phân cách hàng ngàn phổ biến ở VN (ví dụ: 100.000 -> 100000)
    // Nhưng cẩn thận với số thập phân, thường trong chốt đơn ít dùng thập phân.
    let cleanText = text.replace(/(\d+)\.(\d{3})\b/g, '$1$2'); 
    
    const regexWithUnit = /(\d+(?:[.,]\d+)?)\s*(k|ngàn|n|đ|vnd|vnđ)/gi;
    let match = regexWithUnit.exec(cleanText);
    if (match) {
        let value = parseFloat(match[1].replace(/,/g, '.')); // Chuyển dấu phẩy thành chấm nếu có
        let unit = match[2].toLowerCase();
        if (['k', 'n', 'ngàn'].includes(unit)) value *= 1000;
        return value;
    }

    // Nếu không có đơn vị, tìm số cuối cùng (thường là giá)
    const regexPureNumber = /\b(\d+)\b/g;
    let pureMatch; 
    let lastNumber = 0;
    while ((pureMatch = regexPureNumber.exec(cleanText)) !== null) { 
        lastNumber = parseFloat(pureMatch[1]); 
    }
    
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
                        tiktokUsername: session.tiktokUsername || '',
                        orderId: '',
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
                        tiktokUsername: session.tiktokUsername || '',
                        orderId: order.id || '',
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

    if (!includeSharedLegacy) {
        return { rows, files: files.length };
    }

    const shared = readSharedLegacyHistoryRows();
    return {
        rows: [...rows, ...shared.rows],
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
    if (!/^\d{4}-\d{2}-\d{2}_[^/\\]+\.json$/i.test(name)) return '';
    return name;
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
                id: `legacy_${fileName}_${item.id || `${customer.username || 'unknown'}_${itemTime}`}`,
                customerName: normalizeOrderCustomerName(customer.nickname || customer.displayName || '', customer.username || customer.tiktokUsername || ''),
                customerUsername: customerStore.normalizeTikTokUsername(customer.username || customer.tiktokUsername || ''),
                profilePictureUrl: customer.profilePictureUrl || '',
                productName: normalizeDisplayText(item.text || ''),
                quantity: 1,
                price: Number(item.price || 0),
                total: Number(item.price || 0),
                note: '',
                time: itemTime,
                createdAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : ''
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

    const rows = scope === 'all'
        ? allRows
        : allRows.filter(r => r.userId === currentUser.uid);

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

function formatDateKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function normalizeOverviewRange(startQuery, endQuery) {
    const today = new Date();
    const vietnamOffsetMinutes = 7 * 60;

    function toVietnamStart(date) {
        const d = new Date(date);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        const ms = d.getTime() + vietnamOffsetMinutes * 60 * 1000;
        const start = new Date(ms);
        start.setHours(0, 0, 0, 0);
        return start;
    }

    const defaultStartDate = toVietnamStart(new Date());
    defaultStartDate.setDate(defaultStartDate.getDate() - 6);
    const defaultStart = defaultStartDate;

    let start = parseDateKey(startQuery) || defaultStart;
    let end = parseDateKey(endQuery) || toVietnamStart(new Date());
    start = toVietnamStart(start);
    end = toVietnamStart(end);

    if (start > end) {
        const tmp = start;
        start = end;
        end = tmp;
    }

    const maxDays = 370;
    const diffDays = Math.floor((end - start) / 86400000);
    if (diffDays > maxDays) {
        start = new Date(end);
        start.setDate(start.getDate() - maxDays);
    }

    return {
        start: formatDateKey(start),
        end: formatDateKey(end),
        startDate: start,
        endDate: end
    };
}

function historyMetaFromFile(fileName) {
    const match = String(fileName || '').match(/^(\d{4}-\d{2}-\d{2})_(.+)\.json$/i);
    if (!match) return { date: '', shop: '' };
    return {
        date: match[1],
        shop: match[2].replace(/\.json$/i, '')
    };
}

function timestampFromParts(dateKey, timeText) {
    const time = /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(timeText || ''))
        ? String(timeText).length === 5 ? `${timeText}:00` : String(timeText)
        : '00:00:00';
    const stamp = Date.parse(`${dateKey}T${time}+07:00`);
    return Number.isFinite(stamp) ? stamp : Date.parse(`${dateKey}T00:00:00+07:00`);
}

function dateKeyFromTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return formatDateKey(date);
}

function currentLiveRows(currentUser) {
    const runtime = getLiveRuntime(currentUser.uid);
    const todayKey = formatDateKey(new Date());
    const rows = [];
    Object.values(runtime.confirmedOrders || {}).forEach(customer => {
        const items = Array.isArray(customer?.items) ? customer.items : [];
        items.forEach(item => {
            const timestamp = timestampFromParts(todayKey, item.time);
            rows.push({
                source: 'current_live',
                userId: currentUser.uid,
                date: todayKey,
                timestamp,
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
    return readAllLiveSessionRows().rows
        .filter(row => row.source === 'live_session' && row.userId === currentUser.uid && Number(row.total || 0) > 0)
        .map(row => {
            const rawTimestamp = Date.parse(row.orderCreatedAt || row.sessionCreatedAt || '');
            const date = Number.isFinite(rawTimestamp)
                ? dateKeyFromTimestamp(rawTimestamp)
                : formatDateKey(new Date());
            return {
                source: 'live_session',
                userId: row.userId,
                date,
                timestamp: Number.isFinite(rawTimestamp) ? rawTimestamp : timestampFromParts(date, row.itemTime),
                shop: row.tiktokUsername || '',
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

function dateRangeContains(range, dateKey) {
    return dateKey >= range.start && dateKey <= range.end;
}

function buildDailyOverview(rows, range) {
    const dailyMap = {};
    const cursor = new Date(range.startDate);
    while (cursor <= range.endDate) {
        const key = formatDateKey(cursor);
        dailyMap[key] = { date: key, orders: 0, revenue: 0 };
        cursor.setDate(cursor.getDate() + 1);
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
    const allRows = dedupeOverviewRows([
        ...currentLiveRows(currentUser),
        ...liveSessionOverviewRows(currentUser),
        ...legacyHistoryOverviewRows(currentUser.uid, { includeSharedLegacy })
    ]);
    const rows = allRows.filter(row => row.date && dateRangeContains(range, row.date));
    const todayKey = formatDateKey(new Date());
    const comments = dateRangeContains(range, todayKey) && runtime.currentBroadcasterId
        ? (runtime.chatBufferByBroadcaster.get(runtime.currentBroadcasterId) || []).length
        : 0;
    const currentLiveOrderCount = rows.filter(row => row.source === 'current_live').length;
    const totalOrders = rows.length;
    const totalRevenue = rows.reduce((sum, row) => sum + Number(row.value || 0), 0);
    const pendingOrders = rows.filter(row => normalizeOrdersStatus(row.status) === 'pending').length;
    const failedOrders = rows.filter(row => normalizeOrdersStatus(row.status) === 'failed').length;
    const closeRate = comments > 0 ? Math.min(99.9, (currentLiveOrderCount / comments) * 100) : 0;

    const topCustomerMap = {};
    const hourlyMap = {};
    const productMap = {};

    rows.forEach((row) => {
        // Top customers
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

        // Top products
        const productKey = String(row.productName || row.product || 'unknown').trim();
        if (!productMap[productKey]) {
            productMap[productKey] = { name: productKey, qty: 0, revenue: 0 };
        }
        productMap[productKey].qty += Number(row.quantity || 1);
        productMap[productKey].revenue += Number(row.value || 0);

        // Hourly stats
        let hour = null;
        if (row.timestamp) {
            const d = new Date(row.timestamp);
            if (!isNaN(d.getTime())) {
                hour = d.getUTCHours() + 7;
                if (hour >= 24) hour -= 24;
            }
        } else if (row.time) {
            const match = row.time.match(/^(\d{1,2}):/);
            if (match) hour = parseInt(match[1], 10);
        }

        if (hour !== null) {
            if (!hourlyMap[hour]) {
                hourlyMap[hour] = { hour, revenue: 0, orders: 0 };
            }
            hourlyMap[hour].revenue += Number(row.value || 0);
            hourlyMap[hour].orders += 1;
        }
    });

    // Build hourly array (24h)
    const hourly = [];
    for (let h = 0; h < 24; h++) {
        if (hourlyMap[h]) {
            hourly.push(hourlyMap[h]);
        }
    }

    // Build top products array
    const topProducts = Object.values(productMap)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);

    return {
        summary: {
            orders: totalOrders,
            revenue: totalRevenue,
            pendingOrders,
            failedOrders,
            comments,
            activeLive: runtime.currentBroadcasterId ? 1 : 0,
            closeRate
        },
        daily: buildDailyOverview(rows, range),
        hourly,
        topShops: Object.values(topCustomerMap)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 5),
        latestOrders: rows
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
            rows: rows.length
        }
    };
}

function normalizeOrdersStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw || raw === 'done' || raw === 'success' || raw === 'completed') return 'done';
    if (['failed', 'cancelled', 'canceled', 'returned', 'refund'].includes(raw)) return 'failed';
    return 'pending';
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

    const rows = dedupeOverviewRows([
        ...currentLiveRows(currentUser),
        ...liveSessionOverviewRows(currentUser),
        ...legacyHistoryOverviewRows(currentUser.uid, { includeSharedLegacy })
    ]);

    const parsedStart = parseDateKey(filters.start);
    const parsedEnd = parseDateKey(filters.end);
    const normalizedStart = parsedStart ? formatDateKey(parsedStart) : '';
    const normalizedEnd = parsedEnd ? formatDateKey(parsedEnd) : '';
    const q = String(filters.q || '').toLowerCase();
    const statusFilter = String(filters.status || 'all');
    const shopFilter = customerStore.normalizeTikTokUsername(filters.shop || '');

    const mapped = rows
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
                order.orderId,
                order.customerName,
                order.customerUsername,
                order.phone,
                order.productName,
                order.shop
            ].join(' ').toLowerCase();
            return haystack.includes(q);
        })
        .sort((a, b) => b.timestamp - a.timestamp);

    const shops = Array.from(
        new Set(
            mapped
                .map(order => order.shop)
                .filter(Boolean)
        )
    ).sort();

    const summary = {
        totalOrders: mapped.length,
        totalCod: mapped.reduce((sum, order) => sum + Number(order.total || 0), 0),
        successOrders: mapped.filter(order => order.status === 'done').length,
        failedOrders: mapped.filter(order => order.status === 'failed').length
    };

    return {
        filters: {
            status: statusFilter,
            shop: shopFilter,
            start: normalizedStart,
            end: normalizedEnd,
            q: filters.q || ''
        },
        options: {
            shops
        },
        summary,
        orders: mapped
    };
}

function toCsv(rows) {
    const headers = [
        'source', 'userId', 'historyFile', 'historyDate', 'sessionId', 'sessionName',
        'sessionCreatedAt', 'tiktokUsername', 'orderId', 'customerName', 'customerUsername',
        'productName', 'quantity', 'price', 'total', 'itemTime', 'orderCreatedAt'
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
        'productName', 'quantity', 'price', 'total', 'itemTime', 'orderCreatedAt'
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

const { getDb, migrateFromJson } = require('./utils/db');
const { setupLiveHandler } = require('./sockets/liveHandler');

// Initialize DB and Migrate
getDb();
migrateFromJson();

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
    console.log(`Database initialized and data migrated.`);
});

// Setup Live Handler (Socket.io)
const liveContext = {
    printBill,
    printDetailedBill,
    emitToUser,
    getUserRoom,
    saveSessionDataForUser,
    sanitizeConfirmedOrders,
    parsePrice,
    displayFallbackFromUsername,
    customerStore,
    initPrinter,
    saveConfig,
    getSessionFileName,
    safeStorageId,
    safeLegacyHistoryFileName,
    HISTORY_ROOT_DIR,
    printerInterface,
    tiktokSignApiKey,
    generateSessionId,
    internalSaveLiveSession
};
setupLiveHandler(io, liveContext);
