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
const adminRoutes = require('./routes/admin');

// DEV ONLY: Bật để bỏ qua đăng nhập Firebase trong môi trường local/dev.
// Cần đặt VITE_DEV_SKIP_AUTH=false khi phát hành production.
const DEV_SKIP_AUTH = String(process.env.VITE_DEV_SKIP_AUTH || 'false').toLowerCase() === 'true';
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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set secure: true if using HTTPS
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
        return res.redirect('/');
    }
    if (DEV_SKIP_AUTH) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
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

        req.session.user = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            name: decodedToken.name || '',
            picture: decodedToken.picture || '',
            provider: decodedToken.firebase?.sign_in_provider || '',
            role: decodedToken.role || 'user',
            permissions: decodedToken.permissions || []
        };
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
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

const requireLogin = (req, res, next) => {
    if (req.path === '/login' || req.path === '/sessionLogin' || req.path === '/api/me') return next();
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

// GET /api/live-sessions — Lấy danh sách phiên live của user
app.get('/api/live-sessions', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const sessions = liveSessionStore.readUserSessions(userId);
        // Trả về danh sách không kèm orders chi tiết (nhẹ hơn)
        const list = sessions.map(s => ({
            id: s.id,
            liveName: s.liveName,
            tiktokUsername: s.tiktokUsername,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            createdAt: s.createdAt,
            summary: s.summary
        }));
        res.json({ sessions: list });
    } catch (error) {
        console.error('Lỗi lấy danh sách phiên live:', error);
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
        const userId = req.session.user.uid;
        const session = liveSessionStore.getLiveSessionById(userId, req.params.sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Không tìm thấy phiên live' });
        }
        res.json({ session });
    } catch (error) {
        console.error('Lỗi lấy chi tiết phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// DELETE /api/live-sessions/:sessionId — Xóa phiên live
app.delete('/api/live-sessions/:sessionId', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const deleted = liveSessionStore.deleteLiveSession(userId, req.params.sessionId);
        if (!deleted) {
            return res.status(404).json({ error: 'Không tìm thấy phiên live' });
        }
        console.log(`>>> Đã xóa phiên live ${req.params.sessionId} của user ${userId}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Lỗi xóa phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// POST /api/live-sessions/merge-summary — Gộp nhiều phiên
app.post('/api/live-sessions/merge-summary', requireApiAuth, (req, res) => {
    try {
        const userId = req.session.user.uid;
        const { sessionIds } = req.body;

        if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
            return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 phiên' });
        }

        const result = liveSessionStore.mergeLiveSessions(userId, sessionIds);
        if (!result) {
            return res.status(404).json({ error: 'Không tìm thấy phiên live nào' });
        }

        res.json(result);
    } catch (error) {
        console.error('Lỗi gộp phiên live:', error);
        res.status(500).json({ error: 'Lỗi server' });
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
            <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f3f4f6;">
            <div style="text-align:center;"><h1 style="color:#ef4444;">⛔ Không có quyền truy cập</h1>
            <p>Tài khoản của bạn không có quyền vào trang Admin.</p>
            <a href="/" style="color:#3b82f6;">← Quay về trang chính</a></div></body></html>`);
    }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use('/api/admin', adminRoutes);

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

const HISTORY_DIR = path.join(__dirname, 'history');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const LIVE_SESSIONS_DIR = path.join(__dirname, 'data', 'live-sessions');

let tiktokConnection = null;
let confirmedOrders = {}; 
let printerInterface = 'tcp://192.168.1.9'; 
let tiktokSignApiKey = '';
let currentBroadcasterId = null;
let printer = null;
const processedMsgIds = new Set(); // Bộ lọc tin nhắn trùng lặp
const chatBufferByBroadcaster = new Map(); // { broadcasterId -> [chatItem...] }
const CHAT_BUFFER_LIMIT = 300;

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

function getSessionFileName(broadcasterId) {
    const date = new Date().toISOString().split('T')[0];
    return path.join(HISTORY_DIR, `${date}_${broadcasterId}.json`);
}

function saveSessionData() {
    if (!currentBroadcasterId) return;
    const fileName = getSessionFileName(currentBroadcasterId);
    fs.writeFileSync(fileName, JSON.stringify(confirmedOrders, null, 2));
}

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

async function printBill(item, order) {
    if (!printer) return;
    try {
        console.log(`>>> Đang đẩy lệnh in: ${order.nickname} - ${item.text}`);
        
        printer.clear();
        printer.alignCenter();
        
        // TÊN KHÁCH HÀNG & ID (TO VỪA & ĐẬM)
        printer.setTextDoubleHeight();
        printer.setTextDoubleWidth();
        printer.bold(true);
        printer.println(removeVietnameseTones(`${order.nickname} - ${order.username}`));
        
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
        io.emit('printer-error', "Máy in phản hồi chậm hoặc rớt mạng. Hãy kiểm tra Wi-Fi máy in!");
    }
}

async function printDetailedBill(order) {
    if (!printer) return;
    try {
        console.log(`>>> Đang in bill chi tiết cho khách: ${order.nickname}`);
        
        printer.clear();
        printer.alignCenter();
        printer.setTextNormal();
        printer.println("HOA DON TONG HOP");
        printer.println("--------------------------------");

        // THÔNG TIN KHÁCH
        printer.alignLeft();
        printer.setTextDoubleHeight();
        printer.bold(true);
        printer.println(`${order.nickname}`);
        
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
        io.emit('printer-error', "Lỗi in bill chi tiết!");
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
                        customerName: order.customerName || '',
                        customerUsername: order.customerUsername || '',
                        productName: order.productName || order.text || '',
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

function readLegacyHistoryRows() {
    if (!fs.existsSync(HISTORY_DIR)) return { rows: [], files: 0 };
    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
    const rows = [];

    files.forEach(fileName => {
        const fullPath = path.join(HISTORY_DIR, fileName);
        try {
            const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            const users = Object.values(parsed || {});
            users.forEach(customer => {
                const items = Array.isArray(customer?.items) ? customer.items : [];
                if (items.length === 0) return;
                items.forEach(item => {
                    rows.push({
                        source: 'legacy_history',
                        userId: '',
                        historyFile: fileName,
                        historyDate: fileName.split('_')[0] || '',
                        sessionId: '',
                        sessionName: fileName.replace('.json', ''),
                        sessionCreatedAt: '',
                        tiktokUsername: '',
                        orderId: item.id || '',
                        customerName: customer.nickname || '',
                        customerUsername: customer.username || '',
                        productName: item.text || '',
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

    return { rows, files: files.length };
}

function buildExportDataset(scope, currentUser) {
    const live = readAllLiveSessionRows();
    const history = readLegacyHistoryRows();
    const allRows = [...live.rows, ...history.rows];

    const rows = scope === 'all'
        ? allRows
        : allRows.filter(r => r.userId === currentUser.uid || r.source === 'legacy_history');

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

io.on('connection', (socket) => {
    socket.emit('system-config', { printerInterface, tiktokSignApiKey });

    socket.on('update-settings', (data) => {
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
        const id = (broadcasterId || '').trim();
        if (!id) return socket.emit('chat-buffer', { broadcasterId: '', comments: [] });
        const comments = chatBufferByBroadcaster.get(id) || [];
        socket.emit('chat-buffer', { broadcasterId: id, comments });
    });

    socket.on('start-live', (uniqueId) => {
        if (tiktokConnection) {
            try { tiktokConnection.disconnect(); } catch(e) {}
        }
        currentBroadcasterId = uniqueId;
        const fileName = getSessionFileName(uniqueId);
        if (fs.existsSync(fileName)) {
            confirmedOrders = JSON.parse(fs.readFileSync(fileName));
        } else {
            confirmedOrders = {};
        }
        socket.emit('all-confirmed-orders', confirmedOrders);
        
        tiktokConnection = new WebcastPushConnection(uniqueId);
        tiktokConnection.connect().then(state => {
            socket.emit('status', { connected: true, roomId: state.roomId, broadcasterId: uniqueId });
        }).catch(err => {
            console.error('TikTok Connection Error:', err);
            let errorMessage = "Lỗi không xác định";
            
            if (err && (err.name === 'SignatureRateLimitError' || (err.message && err.message.includes('rate_limit')))) {
                errorMessage = "Đại ca ơi, TikTok nó chặn rồi (Rate Limit)! Đợi xíu tầm 1-2 phút rồi thử lại nhé. Hoặc Đại ca nạp API Key của EulerStream vào phần cài đặt cho nó mượt!";
            } else if (err && err.message && err.message.includes('Unexpected server response: 200')) {
                errorMessage = "Kết nối bị từ chối (200). Đại ca thử lại phát nữa xem, hoặc kiểm tra xem ID TikTok đúng chưa nhé!";
            } else {
                errorMessage = (err && err.message) ? err.message : (err ? err.toString() : "Lỗi kết nối TikTok");
            }
            
            socket.emit('status', { connected: false, error: errorMessage, broadcasterId: uniqueId });
        });
        tiktokConnection.on('chat', (data) => {
            // Lọc tin nhắn trùng lặp
            if (processedMsgIds.has(data.msgId)) return;
            processedMsgIds.add(data.msgId);
            setTimeout(() => processedMsgIds.delete(data.msgId), 120000); // Lưu 2 phút cho chắc

            const chatPayload = {
                ...data,
                broadcasterId: uniqueId,
                msgId: data.msgId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                suggestedPrice: parsePrice(data.comment),
                timestamp: Date.now()
            };

            const currentBuffer = chatBufferByBroadcaster.get(uniqueId) || [];
            currentBuffer.push(chatPayload);
            if (currentBuffer.length > CHAT_BUFFER_LIMIT) {
                currentBuffer.splice(0, currentBuffer.length - CHAT_BUFFER_LIMIT);
            }
            chatBufferByBroadcaster.set(uniqueId, currentBuffer);

            io.emit('raw-chat', chatPayload);
        });
    });

    socket.on('confirm-item', (data) => {
        const { uniqueId, nickname, profilePictureUrl, comment, price } = data;
        if (!confirmedOrders[uniqueId]) {
            confirmedOrders[uniqueId] = { username: uniqueId, nickname, profilePictureUrl, items: [], total: 0 };
        }
        const newItem = { id: Date.now() + Math.random(), text: comment, price, time: new Date().toLocaleTimeString('vi-VN') };
        confirmedOrders[uniqueId].items.push(newItem);
        confirmedOrders[uniqueId].total += price;
        saveSessionData();
        io.emit('order-confirmed', confirmedOrders[uniqueId]);
        printBill(newItem, confirmedOrders[uniqueId]);
    });

    socket.on('delete-customer', (username) => {
        if (confirmedOrders[username]) {
            delete confirmedOrders[username];
            saveSessionData();
            io.emit('all-confirmed-orders', confirmedOrders);
        }
    });

    socket.on('delete-item', ({ username, itemId }) => {
        if (confirmedOrders[username]) {
            const index = confirmedOrders[username].items.findIndex(i => i.id === itemId);
            if (index > -1) {
                confirmedOrders[username].total -= confirmedOrders[username].items[index].price;
                confirmedOrders[username].items.splice(index, 1);
                if (confirmedOrders[username].items.length === 0) delete confirmedOrders[username];
                saveSessionData();
                io.emit('all-confirmed-orders', confirmedOrders);
            }
        }
    });

    socket.on('edit-item-price', ({ username, itemId, newPrice }) => {
        if (confirmedOrders[username]) {
            const item = confirmedOrders[username].items.find(i => i.id === itemId);
            if (item) {
                confirmedOrders[username].total = confirmedOrders[username].total - item.price + newPrice;
                item.price = newPrice;
                saveSessionData();
                io.emit('all-confirmed-orders', confirmedOrders[username]);
            }
        }
    });

    // --- CHỨC NĂNG IN LẠI ---
    socket.on('reprint-item', ({ username, itemId }) => {
        if (confirmedOrders[username]) {
            const item = confirmedOrders[username].items.find(i => i.id === itemId);
            if (item) printBill(item, confirmedOrders[username]);
        }
    });

    socket.on('reprint-total', (username) => {
        if (confirmedOrders[username]) {
            printDetailedBill(confirmedOrders[username]);
        }
    });

    socket.on('get-history-list', () => {
        if (!fs.existsSync(HISTORY_DIR)) return socket.emit('history-list', []);
        const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
        const historyList = files.map(f => {
            const stats = fs.statSync(path.join(HISTORY_DIR, f));
            return { fileName: f, mtime: stats.mtime };
        }).sort((a, b) => b.mtime - a.mtime);
        socket.emit('history-list', historyList);
    });

    socket.on('load-history-file', (fileName) => {
        const filePath = path.join(HISTORY_DIR, fileName);
        if (fs.existsSync(filePath)) {
            confirmedOrders = JSON.parse(fs.readFileSync(filePath));
            const match = fileName.match(/^\d{4}-\d{2}-\d{2}_(.+)\.json$/);
            if (match) currentBroadcasterId = match[1];
            socket.emit('history-data', { fileName, data: confirmedOrders });
        }
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
});
