const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require("node-thermal-printer");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const HISTORY_DIR = path.join(__dirname, 'history');
const CONFIG_FILE = path.join(__dirname, 'config.json');

let tiktokConnection = null;
let confirmedOrders = {}; 
let printerInterface = 'tcp://192.168.1.9'; 
let currentBroadcasterId = null;
let printer = null;
const processedMsgIds = new Set(); // Bộ lọc tin nhắn trùng lặp

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE));
        printerInterface = config.printerInterface || printerInterface;
    } catch(e) {}
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
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ printerInterface }));
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

io.on('connection', (socket) => {
    socket.emit('printer-config', printerInterface);

    socket.on('update-printer', (newInterface) => {
        initPrinter(newInterface);
        socket.emit('printer-status', "Đã lưu IP máy in: " + newInterface);
    });

    socket.on('start-live', (uniqueId) => {
        if (tiktokConnection) tiktokConnection.disconnect();
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
            socket.emit('status', { connected: true, roomId: state.roomId });
        }).catch(err => {
            console.error('TikTok Connection Error:', err);
            socket.emit('status', { connected: false, error: (err && err.message) ? err.message : (err ? err.toString() : "Lỗi không xác định") });
        });
        tiktokConnection.on('chat', (data) => {
            // Lọc tin nhắn trùng lặp
            if (processedMsgIds.has(data.msgId)) return;
            processedMsgIds.add(data.msgId);
            setTimeout(() => processedMsgIds.delete(data.msgId), 120000); // Lưu 2 phút cho chắc

            io.emit('raw-chat', { ...data, suggestedPrice: parsePrice(data.comment) });
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
